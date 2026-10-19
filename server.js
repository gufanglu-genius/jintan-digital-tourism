/* 金沙文枢·遗韵新生 — 统一服务端
 * 静态托管 + 三大 AI 能力代理（对话流式 / 文生图 / 数字人语音）
 * 算法沿用前身项目验证过的端点，仅做整合。
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = __dirname;
const PUB = path.join(ROOT, 'public');

// ---- 极简 .env 读取（不引入 dotenv 依赖） ----
(function loadEnv() {
  const p = path.join(ROOT, '.env');
  if (!fs.existsSync(p)) return;
  fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  });
})();

const KEY = process.env.QWEN_API_KEY || '';
const BASE = process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com';
const CHAT_MODEL = process.env.QWEN_CHAT_MODEL || 'qwen-plus';
const IMAGE_MODEL = process.env.QWEN_IMAGE_MODEL || 'wanx2.1-t2i-fast';
const PORT = process.env.PORT || 8787;

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(PUB));
app.use('/vendor/leaflet', express.static(path.join(ROOT, 'node_modules/leaflet/dist')));
app.use('/generated', express.static(path.join(ROOT, 'generated')));
app.use('/tts_out', express.static(path.join(ROOT, 'tts_out')));

function loadJSON(rel) {
  const p = path.join(PUB, 'data', rel);
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

app.get('/api/health', (_req, res) => res.json({ ok: true, hasKey: !!KEY }));

// ---------- 1. 文人人格对话（流式 SSE） ----------
app.post('/api/chat/stream', async (req, res) => {
  try {
    const { personaId, message, history = [] } = req.body || {};
    if (!message) return res.status(400).json({ error: '缺少 message' });
    const personas = loadJSON('personas.json');
    const persona = personas && personas.personas && personas.personas.find((p) => p.id === personaId);
    const system = persona
      ? persona.systemPrompt
      : '你是金坛文旅数字向导，用有文化底蕴又贴近Z世代的语言回答。';

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const messages = [
      { role: 'system', content: system },
      ...history.slice(-10).map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: message },
    ];

    const upstream = await fetch(`${BASE}/compatible-mode/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model: CHAT_MODEL, messages, stream: true, temperature: 0.8 }),
    });

    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text().catch(() => '');
      res.write(`data: ${JSON.stringify({ error: `上游 ${upstream.status}`, detail: errText.slice(0, 300) })}\n\n`);
      return res.end();
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (payload === '[DONE]') { res.write('data: [DONE]\n\n'); continue; }
        try {
          const j = JSON.parse(payload);
          const delta = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
          if (delta) res.write(`data: ${JSON.stringify({ delta })}\n\n`);
        } catch { /* 忽略半包 */ }
      }
    }
    res.end();
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: String(e && e.message || e) })}\n\n`);
    res.end();
  }
});

// ---------- 2. 文生图（DashScope 任务流，沿用前身项目验证过的调用） ----------
app.post('/api/generate-image', async (req, res) => {
  try {
    const { prompt, n = 1 } = req.body || {};
    if (!prompt) return res.status(400).json({ error: '缺少 prompt' });
    const r = await fetch(`${BASE}/api/v1/services/aigc/text2image/image-synthesis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}`, 'X-DashScope-Async': 'enable' },
      body: JSON.stringify({ model: IMAGE_MODEL, input: { prompt, n: String(n) }, parameters: { size: '1024*1024', n: Number(n) } }),
    });
    const data = await r.json();
    const taskId = data.output && data.output.task_id;
    if (!taskId) return res.status(502).json({ error: '任务创建失败', detail: data });
    res.json({ taskId });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

app.get('/api/task/:taskId', async (req, res) => {
  try {
    // taskId 直接拼进上游 URL（带 Bearer）：必须白名单化，
    // 否则 %2e%2e%2f 这类编码穿越能打到 DashScope 域下任意路径
    const taskId = String(req.params.taskId || '');
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(taskId)) {
      return res.status(400).json({ error: '非法 taskId' });
    }
    const r = await fetch(`${BASE}/api/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${KEY}` },
    });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

// ---------- 3. 数字人语音（edge-tts + 口型时间线） ----------
const TTS_OUT = path.join(ROOT, 'tts_out');
const TTS_CACHE_V = 2; // 缓存格式版本：v2 = 带 intensity/i 的口型时间线

function tidOf(raw) {
  const t = String(raw || '').replace(/[^A-Za-z0-9_-]/g, '');
  return t || 't' + Math.random().toString(36).slice(2, 10);
}

function voiceOf(raw) {
  const v = String(raw || '');
  return /^[A-Za-z-]+$/.test(v) ? v : 'zh-CN-XiaoyiNeural';
}

// 读 v2 缓存：版本/语音/文本/口型/音频全部对得上才命中。
// （此前不比对 text：改稿后仍返回旧音频，字幕和语音对不上；
//   也让同 id 的投毒请求永久占坑。文本不符 → 未命中，按现文本重合成并覆盖，自愈。）
function readCache(id, voice, text) {
  try {
    const p = path.join(TTS_OUT, `${id}.json`);
    if (!fs.existsSync(p)) return null;
    const c = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!c || c.v !== TTS_CACHE_V || c.voice !== voice) return null;
    if (c.text !== text) return null;
    if (!Array.isArray(c.visemes) || !c.visemes.length) return null;
    if (!fs.existsSync(path.join(TTS_OUT, `${id}.mp3`))) return null;
    return { audioUrl: c.audioUrl, visemes: c.visemes };
  } catch { return null; }
}

// 原子写缓存（tmp + rename，避免半截 JSON 被并发读到）
function writeCache(id, voice, text, result) {
  try {
    const p = path.join(TTS_OUT, `${id}.json`);
    const tmp = p + '.part';
    fs.writeFileSync(tmp, JSON.stringify({
      v: TTS_CACHE_V, voice, text,
      audioUrl: result.audioUrl, visemes: result.visemes,
    }));
    fs.renameSync(tmp, p);
  } catch { /* 缓存失败不影响本次响应 */ }
}

let ttsRunning = 0; // 在跑的 python3 进程数（并发闸）
const TTS_MAX = 4;

// 跑一次 python 管线；onDone(result|null, detail) —— 保证只回调一次
function runTts(id, voice, text, onDone) {
  const helper = path.join(ROOT, 'tts_viseme.py');
  if (!fs.existsSync(helper)) return onDone(null, 'tts_viseme.py 未就绪');
  try { fs.mkdirSync(TTS_OUT, { recursive: true }); } catch { /* 目录已存在 */ }

  ttsRunning++;
  let settled = false;
  const done = (result, detail) => {
    if (settled) return; // error 与 close 可能双触发，只认第一次
    settled = true;
    ttsRunning--;
    onDone(result, detail);
  };

  const py = spawn('python3', [helper, '--text', text, '--voice', voice, '--id', id], { cwd: ROOT });
  let out = '';
  py.stdout.on('data', (d) => (out += d));
  py.stderr.on('data', (d) => (out += d));
  // 不挂 error 监听：python3 不在 PATH（ENOENT）时 'error' 触发且没有 close，
  // 整个 Node 进程被 unhandled error 带走——比赛现场直接全站下线
  py.on('error', (e) => done(null, 'python3 启动失败：' + (e && e.message || e)));
  py.on('close', (code) => {
    if (code !== 0) return done(null, out.slice(0, 500));
    try {
      const result = JSON.parse(out.trim().split('\n').pop());
      writeCache(id, voice, text, result);
      done(result, '');
    } catch {
      done(null, out.slice(0, 500));
    }
  });
}

// 同 id 单飞：同文请求搭同一班车（预烘+用户首点并发 = 只跑一个进程）；
// 异文请求排队等上一班落地——python 写的是同一个 <id>.part，绝不能并发写。
const ttsFlights = new Map(); // tid → { text, promise }
function ttsOnce(tid, v, text) {
  const cur = ttsFlights.get(tid);
  if (cur && cur.text === text) return cur.promise;
  const run = () => new Promise((resolve) => {
    runTts(tid, v, text, (result, detail) => resolve({ result, detail }));
  });
  const promise = cur ? cur.promise.then(run, run) : run();
  const entry = { text, promise };
  ttsFlights.set(tid, entry);
  const drop = () => { if (ttsFlights.get(tid) === entry) ttsFlights.delete(tid); };
  promise.then(drop, drop);
  return promise;
}

app.post('/api/tts', (req, res) => {
  const { id, text, voice } = req.body || {};
  if (!text) return res.status(400).json({ error: '缺少 text' });
  // 正文走 argv（不是 stdin）：不限长的话 E2BIG 能把进程打崩
  if (typeof text !== 'string' || text.length > 20000) {
    return res.status(400).json({ error: 'text 过长（上限 20000 字）' });
  }
  const tid = tidOf(id);
  const v = voiceOf(voice);

  const hit = readCache(tid, v, text);
  if (hit) return res.json(hit); // 热缓存：秒回

  // 并发闸：能搭车就搭车；必须开新进程且已满员 → 429
  const cur = ttsFlights.get(tid);
  const joining = !!cur && cur.text === text;
  if (!joining && ttsRunning >= TTS_MAX) {
    return res.status(429).json({ error: '合成排队中，请稍后再试' });
  }

  ttsOnce(tid, v, text).then(({ result, detail }) => {
    if (res.writableEnded) return;
    if (!result) return res.status(500).json({ error: 'TTS 失败', detail });
    res.json(result); // { audioUrl, visemes }
  });
});

// 启动预烘：tts.json 三条讲解词缺啥烘啥（失败无害，点播时仍会按需合成）
function prebakeTts() {
  const data = loadJSON('tts.json');
  const scripts = (data && data.scripts) || [];
  if (!scripts.length) return;
  for (const s of scripts) {
    if (!s || !s.id || !s.text) continue;
    const tid = tidOf(s.id);
    const v = voiceOf(s.voice);
    if (readCache(tid, v, s.text)) { console.log(`  ✓ 预烘 ${tid}（已有缓存）`); continue; }
    ttsOnce(tid, v, s.text).then(({ result, detail }) => { // 走单飞：预烘+紧随的首点只跑一个进程
      if (result) console.log(`  ✓ 预烘 ${tid} 完成（${result.visemes.length} 段口型）`);
      else console.log(`  ⚠ 预烘 ${tid} 失败：${detail}（点播时会按需合成）`);
    });
  }
}

app.listen(PORT, () => {
  console.log(`\n  金沙文枢 · 遗韵新生`);
  console.log(`  http://localhost:${PORT}\n`);
  prebakeTts();
});
