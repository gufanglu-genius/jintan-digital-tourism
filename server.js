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
    const r = await fetch(`${BASE}/api/v1/tasks/${req.params.taskId}`, {
      headers: { Authorization: `Bearer ${KEY}` },
    });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

// ---------- 3. 数字人语音（edge-tts + 口型时间线） ----------
app.post('/api/tts', (req, res) => {
  const { text, voice = 'zh-CN-XiaoyiNeural' } = req.body || {};
  if (!text) return res.status(400).json({ error: '缺少 text' });
  const helper = path.join(ROOT, 'tts_viseme.py');
  if (!fs.existsSync(helper)) return res.status(501).json({ error: 'tts_viseme.py 未就绪' });

  fs.mkdirSync(path.join(ROOT, 'tts_out'), { recursive: true });
  const id = 't' + Math.random().toString(36).slice(2, 10);
  const py = spawn('python3', [helper, '--text', text, '--voice', voice, '--id', id], { cwd: ROOT });
  let out = '';
  py.stdout.on('data', (d) => (out += d));
  py.stderr.on('data', (d) => (out += d));
  py.on('close', (code) => {
    if (code !== 0) return res.status(500).json({ error: 'TTS 失败', detail: out.slice(0, 500) });
    try {
      const result = JSON.parse(out.trim().split('\n').pop());
      res.json(result); // { audioUrl, visemes }
    } catch {
      res.status(500).json({ error: 'TTS 输出解析失败', detail: out.slice(0, 500) });
    }
  });
});

app.listen(PORT, () => {
  console.log(`\n  金沙文枢 · 遗韵新生`);
  console.log(`  http://localhost:${PORT}\n`);
});
