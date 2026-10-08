/* ============================================================
   模块 04b · 数字人讲解（共创台右栏）
   - 讲解词 chips（tts.json scripts：id/title/text）
   - 点选 → POST /api/tts {text} → {audioUrl, visemes[]}
   - 程序化 SVG 皮影纸人：纸色脸 · 墨线五官 · riso 头饰
   - 口型时间线：audio 播放同时按 start/end/intensity 切 shape
   - 可重播 / 停止（AbortController 式停表）；成功结果按 id 缓存
   - TTS 报错/501 → 逐字字幕 + 静态形象 + 「语音服务未就绪」，不崩
   - 导出：export function initHuman(container, data)
     container=#humanCard  data=tts.json
   ============================================================ */

/* ---------------- 小工具 ---------------- */
const esc = (s) =>
  String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

const pad2 = (n) => String(n).padStart(2, '0');

const reduced = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/* 口型集合（与 pipeline.py 一致：A–H + X 静音） */
const SHAPES = ['X', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const normShape = (s) => {
  const u = String(s == null ? '' : s).trim().toUpperCase();
  if (SHAPES.indexOf(u) >= 0) return u;
  if (u === '' || u === 'SIL' || u === 'REST' || u === 'PAUSE') return 'X';
  return 'X'; // 未知口型 → 闭唇，绝不抛错
};

/* ---------------- 数据清洗（坏数据剔除，不抛错） ---------------- */
function normalizeScripts(data) {
  let arr = [];
  if (Array.isArray(data)) arr = data;
  else if (data && Array.isArray(data.scripts)) arr = data.scripts;

  const out = [];
  const seen = new Set();
  for (const s of arr) {
    if (!s || typeof s !== 'object') continue;
    const text = typeof s.text === 'string' ? s.text.trim() : '';
    if (!text) continue;
    let id = typeof s.id === 'string' && s.id.trim() ? s.id.trim() : '';
    if (!id || seen.has(id)) id = (id || 'script') + '-' + out.length;
    seen.add(id);
    out.push({
      id,
      title: typeof s.title === 'string' && s.title.trim() ? s.title.trim() : id,
      text,
      durationHint: typeof s.durationHint === 'string' ? s.durationHint : '',
    });
  }
  return out;
}

/* ============================================================
   initHuman(container, data)
   ============================================================ */
export function initHuman(container, data) {
  if (!container || !container.dataset) return;

  /* 幂等：重复 init 先停掉上一轮（音频/时钟/请求） */
  if (typeof container.__humanOff === 'function') {
    try {
      container.__humanOff();
    } catch {
      /* 上轮异常也要继续 */
    }
    container.__humanOff = null;
  }

  container.dataset.module = 'human';

  const scripts = normalizeScripts(data);
  const stage = container.querySelector('#humanStage');
  const picks = container.querySelector('#humanPicks');
  const logEl = container.querySelector('#humanLog');

  /* —— 容器缺件：不崩，只标状态 —— */
  if (!stage || !picks || !logEl) {
    container.dataset.status = 'incomplete';
    if (logEl) logEl.textContent = '舞台未就绪…';
    container.__humanOff = function () {};
    return;
  }

  /* ============ 空数据：讲稿待录… ============ */
  if (!scripts.length) {
    container.dataset.status = 'empty';
    stage.innerHTML = `
      <div class="hu-empty">
        <span class="tape" style="top:-13px; right:10%; transform:rotate(4deg);"></span>
        <span class="kicker">STAGE · 皮影戏台</span>
        <p class="hu-empty-title">讲稿待录…</p>
        <p class="hu-empty-sub">讲稿入库后，纸人将在这里开腔。</p>
        <div class="halftone hu-empty-bar" aria-hidden="true"></div>
      </div>`;
    picks.innerHTML = '<p class="hu-picks-empty mono">暂无讲解词</p>';
    logEl.textContent = '· 待录';
    container.__humanOff = function () {};
    return;
  }

  container.dataset.status = 'ready';

  /* ============ 状态 ============ */
  const st = {
    dead: false,
    active: null,        // 当前讲解词
    mode: 'idle',        // idle | loading | playing | fallback | done
    cache: new Map(),    // id → {audioUrl, visemes}
    audio: null,         // HTMLAudioElement
    raf: 0,              // 口型时钟
    abort: null,         // AbortController（进行中的 TTS 请求）
    run: 0,              // 停表代数：+1 即作废旧时间线
    fallbackTimer: 0,    // 逐字字幕定时器
    logCount: 0,
  };

  /* ============ 舞台骨架：贴在纸上的皮影戏台 ============ */
  stage.innerHTML = `
    <div class="hu-theater">
      <span class="tape" style="top:-13px; left:7%; transform:rotate(-5deg);"></span>
      <span class="tape" style="top:-13px; right:7%; transform:rotate(4deg);"></span>
      <div class="hu-valance" aria-hidden="true">
        <span class="hu-valance-l halftone"></span>
        <span class="hu-valance-c mono">SHADOW&nbsp;STAGE</span>
        <span class="hu-valance-r halftone"></span>
      </div>
      <div class="hu-screen">
        <svg class="hu-avatar" viewBox="0 0 240 250" role="img" aria-label="皮影纸人讲解员">
          <!-- 控制杆（皮影） -->
          <line class="hu-rod" x1="24" y1="248" x2="88" y2="196"></line>
          <line class="hu-rod" x1="216" y1="248" x2="152" y2="196"></line>
          <!-- riso 错位：脸的粉版 -->
          <ellipse class="hu-face-ghost" cx="122" cy="126" rx="58" ry="66"></ellipse>
          <!-- 脸（纸色） -->
          <ellipse class="hu-face" cx="120" cy="124" rx="58" ry="66"></ellipse>
          <!-- 脖肩（拼贴纸片） -->
          <path class="hu-collar" d="M64 246 L78 194 Q120 178 162 194 L176 246 Z"></path>
          <path class="hu-collar-line" d="M96 194 L120 216 L144 194"></path>
          <!-- 头饰：riso 套印冠带 -->
          <g class="hu-crown">
            <path class="hu-crown-ghost" d="M62 96 Q120 40 178 96 L172 74 Q120 20 68 74 Z"></path>
            <path class="hu-crown-main" d="M60 94 Q120 38 180 94 L174 72 Q120 18 66 72 Z"></path>
            <rect class="hu-crown-band" x="58" y="92" width="124" height="13"></rect>
            <circle class="hu-crown-jewel" cx="120" cy="58" r="9"></circle>
            <line class="hu-tassel" x1="184" y1="96" x2="198" y2="140"></line>
            <circle class="hu-tassel-tip" cx="199" cy="145" r="6"></circle>
          </g>
          <!-- 眉 -->
          <path class="hu-brow" d="M78 108 Q90 101 102 107"></path>
          <path class="hu-brow" d="M138 107 Q150 101 162 108"></path>
          <!-- 眼（眨眼由 CSS 停格动画驱动） -->
          <g class="hu-eye">
            <ellipse class="hu-eye-white" cx="90" cy="124" rx="13" ry="10"></ellipse>
            <circle class="hu-pupil" cx="92" cy="125" r="5"></circle>
            <circle class="hu-glint" cx="94" cy="122" r="1.6"></circle>
          </g>
          <g class="hu-eye">
            <ellipse class="hu-eye-white" cx="150" cy="124" rx="13" ry="10"></ellipse>
            <circle class="hu-pupil" cx="148" cy="125" r="5"></circle>
            <circle class="hu-glint" cx="150" cy="122" r="1.6"></circle>
          </g>
          <!-- 鼻（墨线） -->
          <path class="hu-nose" d="M118 130 Q124 144 114 150"></path>
          <!-- 腮红（riso 粉贴片） -->
          <ellipse class="hu-cheek" cx="74" cy="148" rx="11" ry="6"></ellipse>
          <ellipse class="hu-cheek" cx="166" cy="148" rx="11" ry="6"></ellipse>
          <!-- 口型组：按 viseme 切换可见 -->
          <g class="hu-mouth" transform="translate(120, 168)">
            <path class="hu-mp" data-shape="X" d="M-15 0 Q0 5 15 0"></path>
            <path class="hu-mp" data-shape="G" d="M-15 0 Q0 5 15 0"></path>
            <path class="hu-mp" data-shape="C" d="M-15 -1 Q0 8 15 -1"></path>
            <path class="hu-mp" data-shape="D" d="M-18 0 L18 0"></path>
            <path class="hu-mp" data-shape="F" d="M-14 0 L14 0 M-10 0 L-10 4 M-4 0 L-4 4 M2 0 L2 4 M8 0 L8 4"></path>
            <path class="hu-mp" data-shape="H" d="M-9 -3 Q0 7 9 -3 M0 2 Q3 5 6 3"></path>
            <ellipse class="hu-mp hu-mp-fill" data-shape="A" cx="0" cy="3" rx="14" ry="15"></ellipse>
            <ellipse class="hu-mp hu-mp-fill" data-shape="B" cx="0" cy="2" rx="15" ry="9"></ellipse>
            <ellipse class="hu-mp hu-mp-fill" data-shape="E" cx="0" cy="2" rx="8" ry="11"></ellipse>
          </g>
        </svg>
        <div class="hu-scrim halftone" aria-hidden="true"></div>
      </div>
      <!-- 字幕条：打字机 mono -->
      <div class="hu-sub" aria-live="polite"><span class="hu-sub-text mono"></span></div>
      <!-- 走带 -->
      <div class="hu-transport">
        <span class="hu-progress" aria-hidden="true"><i class="hu-progress-bar"></i></span>
        <div class="hu-btns">
          <button type="button" class="btn" data-hu="replay" disabled>重播</button>
          <button type="button" class="btn ghost" data-hu="stop" disabled>停止</button>
        </div>
        <span class="hu-elapsed mono">00:00</span>
      </div>
    </div>`;

  /* ============ 讲解词 chips ============ */
  picks.innerHTML = `
    <span class="kicker">讲解词 · SCRIPTS</span>
    <div class="hu-chips" role="group" aria-label="选择讲解词">
      ${scripts
        .map(
          (s, i) => `
        <button type="button" class="hu-chip" data-hu-id="${esc(s.id)}" style="--hi:${i}"
          aria-pressed="false">
          <span class="hu-chip-no mono">${pad2(i + 1)}</span>
          <span class="hu-chip-main">
            <span class="hu-chip-title">${esc(s.title)}</span>
            <span class="hu-chip-meta mono">${esc(s.durationHint || s.id)}</span>
          </span>
        </button>`
        )
        .join('')}
    </div>`;

  const chipBox = picks.querySelector('.hu-chips');
  const subText = stage.querySelector('.hu-sub-text');
  const progBar = stage.querySelector('.hu-progress-bar');
  const elapsedEl = stage.querySelector('.hu-elapsed');
  const btnReplay = stage.querySelector('[data-hu="replay"]');
  const btnStop = stage.querySelector('[data-hu="stop"]');
  const mouthEls = {};
  stage.querySelectorAll('.hu-mp').forEach((el) => {
    mouthEls[el.dataset.shape] = el;
  });

  /* ============ 状态日志（打字机小票） ============ */
  try {
    logEl.setAttribute('aria-live', 'polite');
  } catch {
    /* 垫片环境无 setAttribute 也不影响 */
  }
  function log(text, kind) {
    const line = document.createElement('div');
    line.className = 'hu-line' + (kind ? ' hu-line-' + kind : '');
    line.textContent = '· ' + text;
    logEl.appendChild(line);
    while (logEl.children.length > 5) logEl.removeChild(logEl.firstChild);
    logEl.scrollTop = logEl.scrollHeight;
  }

  /* ============ 形象：口型切换（移植 playVisemeTimeline 的 setMouthShape） ============ */
  let currentShape = '';
  function setMouthShape(shape, intensity) {
    const key = normShape(shape);
    const amp = Number.isFinite(intensity) ? Math.max(0.2, Math.min(1, intensity)) : 1;
    if (key !== currentShape) {
      currentShape = key;
      for (const k of Object.keys(mouthEls)) {
        const el = mouthEls[k];
        const on = k === key;
        el.style.display = on ? '' : 'none';
        el.style.opacity = on ? String(0.55 + 0.45 * amp) : '0';
      }
      const mouth = stage.querySelector('.hu-mouth');
      if (mouth) {
        // intensity 驱动开合幅度（scaleY），减弱动效时只切形状
        const sy = reduced() ? 1 : 0.72 + 0.4 * amp;
        mouth.setAttribute('transform', `translate(120, 168) scale(1, ${sy.toFixed(3)})`);
      }
    } else if (key !== 'X' && key !== 'G') {
      const el = mouthEls[key];
      if (el) el.style.opacity = String(0.55 + 0.45 * amp);
    }
  }

  function resetMouth() {
    currentShape = '';
    setMouthShape('X', 1);
    const mouth = stage.querySelector('.hu-mouth');
    if (mouth) mouth.setAttribute('transform', 'translate(120, 168)');
  }

  resetMouth();

  /* ============ 字幕：打字机逐字 ============ */
  let subTimer = 0;
  function setSubtitle(text, chars) {
    if (!subText) return;
    const n = Math.max(0, Math.min(text.length, chars));
    subText.textContent = text.slice(0, n);
  }

  function typeSubtitle(text, ms) {
    window.clearInterval(subTimer);
    if (!subText) return;
    if (reduced()) {
      subText.textContent = text;
      return;
    }
    subText.textContent = '';
    const per = Math.max(24, Math.min(90, ms / Math.max(1, text.length)));
    let i = 0;
    subTimer = window.setInterval(() => {
      if (st.dead) {
        window.clearInterval(subTimer);
        return;
      }
      i++;
      subText.textContent = text.slice(0, i);
      if (i >= text.length) window.clearInterval(subTimer);
    }, per);
  }

  /* ============ 走带 ============ */
  function setProgress(ratio) {
    const r = Math.max(0, Math.min(1, ratio || 0));
    if (progBar) progBar.style.transform = `scaleX(${r.toFixed(4)})`;
    if (elapsedEl && st.audio && Number.isFinite(st.audio.duration) && st.audio.duration > 0) {
      const cur = r * st.audio.duration;
      elapsedEl.textContent =
        pad2(Math.floor(cur / 60)) + ':' + pad2(Math.floor(cur % 60));
    }
  }

  /* ============ 停止（AbortController 式停表） ============ */
  function stopAll(why) {
    st.run++; // 作废所有旧时间线
    if (st.abort) {
      try {
        st.abort.abort();
      } catch {
        /* 已结束 */
      }
      st.abort = null;
    }
    if (st.raf) {
      cancelAnimationFrame(st.raf);
      st.raf = 0;
    }
    window.clearInterval(subTimer);
    window.clearTimeout(st.fallbackTimer);
    if (st.audio) {
      try {
        st.audio.pause();
      } catch {
        /* 音频已释放 */
      }
      st.audio = null;
    }
    resetMouth();
    if (btnReplay) btnReplay.disabled = !st.cache.has(st.active && st.active.id);
    if (btnStop) btnStop.disabled = true;
    stage.classList.remove('is-playing', 'is-loading');
    setProgress(0);
    if (why) log(why);
  }

  /* ============ 口型时间线（移植 playVisemeTimeline） ============ */
  function playVisemeTimeline(visemes, text, myRun, startedAt) {
    let line = Array.isArray(visemes) ? visemes : [];
    if (!line.length) {
      // 无口型数据：按字数估一条静音时间线（字幕/进度照走，不崩）
      const est = Math.max(2000, (text ? text.length : 40) * 160);
      line = [{ shape: 'X', start: 0, end: est, intensity: 1 }];
    }
    visemes = line;
    const last = visemes[visemes.length - 1];
    const horizon = Math.max(last.end, 1);

    /* 时钟：优先音频播放头；音频未就绪/被拦时用墙钟（首帧锁定，不漂移） */
    let wallBase = startedAt == null ? performance.now() : startedAt;
    let audioMs = -1;

    const tick = () => {
      if (st.dead || myRun !== st.run) return; // 停表后不再推进

      let elapsed;
      const a = st.audio;
      const usingAudio = !!(a && a.readyState >= 2 && !a.paused);
      // 音频只要还活着（未 paused/未 ended），就交给 ended 收表，墙钟不抢收
      const audioAlive = !!(a && !a.paused && !a.ended);
      if (usingAudio) {
        elapsed = a.currentTime * 1000;
        audioMs = elapsed;
      } else {
        if (audioMs >= 0) {
          wallBase = performance.now() - audioMs; // 从音频时钟无缝接回墙钟
          audioMs = -1;
        }
        elapsed = performance.now() - wallBase;
      }

      // 墙钟走到头（音频被拦/失败）才收表；音频在播则交给 ended 收表
      if (!audioAlive && elapsed >= horizon + 260) {
        finishPlayback();
        return;
      }

      let active = null;
      for (const v of visemes) {
        if (elapsed >= v.start && elapsed < v.end) {
          active = v;
          break;
        }
      }
      if (active) setMouthShape(active.shape, active.intensity);
      else setMouthShape('X', 1);

      if (text) setSubtitle(text, Math.round((elapsed / horizon) * text.length));
      setProgress(elapsed / horizon);

      st.raf = requestAnimationFrame(tick);
    };

    st.raf = requestAnimationFrame(tick);
  }

  function finishPlayback() {
    if (st.raf) cancelAnimationFrame(st.raf);
    st.raf = 0;
    resetMouth();
    setProgress(1);
    stage.classList.remove('is-playing');
    if (btnStop) btnStop.disabled = true;
    if (btnReplay) btnReplay.disabled = false;
    st.mode = 'done';
    log('讲毕 · ' + (st.active ? st.active.title : ''));
  }

  /* ============ 播放（缓存命中直接开腔） ============ */
  function playScript(script, hit) {
    st.run++;
    const myRun = st.run;
    if (st.raf) cancelAnimationFrame(st.raf);
    window.clearInterval(subTimer);
    if (st.audio) {
      try {
        st.audio.pause();
      } catch {
        /* noop */
      }
    }

    const audio = new Audio(hit.audioUrl);
    audio.preload = 'auto';
    st.audio = audio;

    stage.classList.add('is-playing');
    stage.classList.remove('is-loading');
    if (btnReplay) btnReplay.disabled = false;
    if (btnStop) btnStop.disabled = false;
    st.mode = 'playing';
    container.dataset.status = 'ready';
    log('开腔 · ' + script.title);

    let started = false;
    const start = () => {
      // 时间线已收表（走完/降级/被停）→ 迟到的 canplay 不再开声
      if (started || st.dead || myRun !== st.run || st.mode !== 'playing') return;
      started = true;
      const p = audio.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          /* 自动播放被拦：时间线照走（墙钟驱动），字幕口型不停 */
          if (st.dead || myRun !== st.run) return;
          log('自动播放受限，已改为无声走带');
        });
      }
    };

    audio.addEventListener('canplay', start, { once: true });
    audio.addEventListener('error', () => {
      if (st.dead || myRun !== st.run) return;
      log('音频加载失败，转逐字字幕', 'warn');
      fallbackShow(script);
    }, { once: true });
    // 元数据迟迟不来也开表（墙钟兜底）
    window.setTimeout(start, 900);

    audio.addEventListener('ended', () => {
      if (st.dead || myRun !== st.run) return;
      finishPlayback();
    });

    const visemes = hit.visemes || [];
    playVisemeTimeline(visemes, script.text, myRun, null);
  }

  /* ============ 降级：语音服务未就绪 → 逐字字幕 + 静态形象 ============ */
  function fallbackShow(script) {
    stopAll();
    st.mode = 'fallback';
    stage.classList.remove('is-playing');
    if (btnReplay) btnReplay.disabled = true;
    if (btnStop) btnStop.disabled = true;
    resetMouth();
    log('语音服务未就绪', 'warn');
    if (subText) subText.textContent = '';
    typeSubtitle(script.text, Math.min(14000, Math.max(4000, script.text.length * 90)));
    container.dataset.status = 'fallback';
  }

  /* ============ 请求 /api/tts ============ */
  async function request(script) {
    if (window.__BACKEND__ && window.__BACKEND__.srv === false) {
      fallbackShow(script); /* 无后端：直接逐字字幕，不打必败请求 */
      return;
    }
    stopAll();
    st.mode = 'loading';
    stage.classList.add('is-loading');
    log('合成中 · ' + script.title);
    if (subText) subText.textContent = '…正在合成语音…';

    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    st.abort = ctl;
    const myRun = st.run;

    try {
      const r = await fetch('api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: script.text }),
        signal: ctl ? ctl.signal : undefined,
      });
      const j = await r.json().catch(() => null);
      if (st.dead || myRun !== st.run) return; // 已被停止/替换
      stage.classList.remove('is-loading');
      if (!r.ok || !j || j.error || !j.audioUrl) {
        fallbackShow(script);
        return;
      }
      const hit = {
        audioUrl: j.audioUrl,
        visemes: Array.isArray(j.visemes)
          ? j.visemes.filter(
              (v) => v && Number.isFinite(v.start) && Number.isFinite(v.end)
            )
          : [],
      };
      st.cache.set(script.id, hit);
      if (btnReplay) btnReplay.disabled = false;
      playScript(script, hit);
    } catch (e) {
      if (st.dead || myRun !== st.run) return;
      stage.classList.remove('is-loading');
      if (e && e.name === 'AbortError') return; // 主动停止，不报错
      fallbackShow(script);
    } finally {
      if (st.abort === ctl) st.abort = null;
    }
  }

  /* ============ 选择讲解词（autoplay=false 只选中不请求） ============ */
  function select(id, autoplay) {
    const script = scripts.find((s) => s.id === id);
    if (!script) return;
    st.active = script;
    container.dataset.status = 'ready';
    chipBox.querySelectorAll('.hu-chip').forEach((b) => {
      const on = b.dataset.huId === id;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if (autoplay === false) {
      // 静置预览：静态形象 + 全文，不发请求
      if (subText) subText.textContent = script.text;
      return;
    }
    const hit = st.cache.get(id);
    if (hit) {
      stopAll();
      playScript(script, hit);
    } else {
      request(script);
    }
  }

  /* ============ 事件（委托，重渲染不丢） ============ */
  function onClick(e) {
    const t = e.target;
    if (!t || !t.closest) return;
    const chip = t.closest('.hu-chip');
    if (chip && picks.contains(chip)) {
      select(chip.dataset.huId);
      return;
    }
    const act = t.closest('[data-hu]');
    if (act && stage.contains(act)) {
      if (act.disabled) return;
      if (act.dataset.hu === 'replay' && st.active) {
        const hit = st.cache.get(st.active.id);
        if (hit) {
          stopAll();
          playScript(st.active, hit);
        } else {
          request(st.active);
        }
      } else if (act.dataset.hu === 'stop') {
        stopAll('已停');
        if (st.active && st.mode !== 'fallback' && subText) {
          subText.textContent = st.active.text; // 停表 → 全文回显
        }
      }
    }
  }

  container.addEventListener('click', onClick);

  /* ============ 启动：选中第一段（静置预览，不自动联网） ============ */
  if (elapsedEl) elapsedEl.textContent = '00:00';
  log('就绪 · 共 ' + scripts.length + ' 段讲稿，点选开腔');
  select(scripts[0].id, false);

  /* ============ 卸载（幂等） ============ */
  container.__humanOff = function () {
    st.dead = true;
    stopAll();
    window.clearInterval(subTimer);
    window.clearTimeout(st.fallbackTimer);
    container.removeEventListener('click', onClick);
    stage.innerHTML = '';
    picks.innerHTML = '';
    logEl.textContent = '';
    stage.classList.remove('is-playing', 'is-loading');
    container.dataset.status = '';
    container.dataset.module = '';
  };
}
