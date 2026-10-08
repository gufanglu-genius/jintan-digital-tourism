/* ============================================================
   模块 02 · 对话便签（文人智能体）
   - 人设 chips（courtesy / title / domain）
   - SSE 流式朗读，落笔光标 + 可停笔（AbortController）
   - 分人设本地存档：shuxu.chat.<personaId>，最近 10 条随请求发送
   - 视觉：对方 = 手写便签条，我方 = 另一侧纸条（mono 小字），
     署名行 = --font-serif 斜体
   ============================================================ */

const KEY_PREFIX = 'shuxu.chat.';
const KEY_ACTIVE = 'shuxu.chat.activeId';
const HISTORY_LIMIT = 10;

/* 每个容器一份会话：重复 initChat 先销毁旧会话（幂等） */
const SESSIONS = new WeakMap();

/* ---------- 本地存档（分桶） ---------- */
function bucketOf(id) {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + id);
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list.filter(
      (m) =>
        m &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string'
    );
  } catch {
    return [];
  }
}

function saveBucket(id, list) {
  try {
    localStorage.setItem(KEY_PREFIX + id, JSON.stringify(list.slice(-60)));
  } catch {
    /* 无痕 / 配额：静默降级为只读会话 */
  }
}

function readActive() {
  try {
    return localStorage.getItem(KEY_ACTIVE) || '';
  } catch {
    return '';
  }
}

function writeActive(id) {
  try {
    localStorage.setItem(KEY_ACTIVE, id);
  } catch {
    /* 忽略 */
  }
}

/* ---------- SSE 行解析：返回 done / error:xxx / 空 ---------- */
function parseData(payload, onDelta) {
  if (payload === '[DONE]') return 'done';
  let j;
  try {
    j = JSON.parse(payload);
  } catch {
    return '';
  }
  if (j && j.error) return 'error:' + String(j.error);
  if (j && typeof j.delta === 'string' && j.delta) onDelta(j.delta);
  return '';
}

/* ============================================================
   initChat(container, data)
   container = #chatShell，data = personas.json
   ============================================================ */
export function initChat(container, data) {
  if (!container) return;

  const prev = SESSIONS.get(container);
  if (prev && typeof prev.destroy === 'function') prev.destroy();

  const row = container.querySelector('.chat-personas');
  const log = container.querySelector('.chat-log');
  const form =
    container.querySelector('#chatForm') || container.querySelector('.chat-input');
  const input =
    container.querySelector('#chatText') || (form ? form.querySelector('input') : null);
  const main = container.querySelector('.chat-main');
  if (!row || !log || !form || !input || !main) return;

  const personas =
    data && Array.isArray(data.personas) ? data.personas.slice() : [];
  const sendBtn =
    form.querySelector('button[type="submit"]') || form.querySelector('button');

  const idOf = (p, i) =>
    p && p.id !== undefined && p.id !== null && p.id !== ''
      ? String(p.id)
      : String(i);
  const indexOfId = (id) =>
    personas.findIndex((p, i) => idOf(p, i) === String(id));

  const state = {
    activeId: '',
    msgs: [],
    generating: false,
    ctrl: null,
    seq: 0,
    composing: false,
  };

  const session = {
    destroyed: false,
    destroy() {
      this.destroyed = true;
      if (state.ctrl) {
        try {
          state.ctrl.abort();
        } catch {
          /* noop */
        }
      }
      state.ctrl = null;
    },
  };
  SESSIONS.set(container, session);

  container.dataset.module = 'chat';
  container.dataset.status = 'ready';

  /* ---------- 落笔状态条（对方正在落笔… + 停止） ---------- */
  let status = main.querySelector('.chat-status');
  if (!status) {
    status = document.createElement('div');
    status.className = 'chat-status';
    status.hidden = true;
    const dot = document.createElement('i');
    dot.className = 'chat-dot';
    dot.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'chat-status-text';
    label.textContent = '对方正在落笔…';
    const stop = document.createElement('button');
    stop.type = 'button';
    stop.className = 'btn ghost chat-stop';
    stop.textContent = '停止';
    status.append(dot, label, stop);
    if (form.parentNode) form.parentNode.insertBefore(status, form);
    else main.appendChild(status);
  }
  status.hidden = true;
  const stopBtn = status.querySelector('.chat-stop');
  if (stopBtn) {
    stopBtn.onclick = () => {
      if (state.ctrl) {
        try {
          state.ctrl.abort();
        } catch {
          /* noop */
        }
      }
    };
  }

  /* ---------- 元素工厂 ---------- */
  const cur = () =>
    personas.find((p, i) => idOf(p, i) === state.activeId) || null;

  function noteEl(side, text) {
    const art = document.createElement('article');
    const mine = side === 'me';
    art.className = mine ? 'note me' : 'note them';

    let metaText = '';
    if (mine) metaText = '我';
    else {
      const p = cur();
      metaText = (p && (p.courtesy || p.name)) || '';
    }
    if (metaText) {
      const meta = document.createElement('span');
      meta.className = 'note-meta mono';
      meta.textContent = metaText;
      art.appendChild(meta);
    }

    const body = document.createElement('p');
    body.className = 'note-body';
    body.textContent = text || '';
    art.appendChild(body);
    return art;
  }

  function attachSign(art, p) {
    if (!p || !p.signoff) return;
    const sign = document.createElement('span');
    sign.className = 'note-sign';
    sign.textContent = p.signoff;
    art.appendChild(sign);
  }

  function errorEl(msg) {
    const art = document.createElement('article');
    art.className = 'note error';
    const meta = document.createElement('span');
    meta.className = 'note-meta mono';
    meta.textContent = 'ERROR';
    const body = document.createElement('p');
    body.className = 'note-body';
    body.textContent = msg || '';
    art.append(meta, body);
    return art;
  }

  function openingNote(p) {
    const art = noteEl('them', p.openingLine || '');
    art.classList.add('opening');
    const tape = document.createElement('span');
    tape.className = 'tape';
    tape.style.cssText = 'top:-13px; left:14%; transform:rotate(-5deg);';
    art.appendChild(tape);
    attachSign(art, p);
    return art;
  }

  function toBottom(force) {
    const gap = log.scrollHeight - log.scrollTop - log.clientHeight;
    if (force || gap < 96) log.scrollTop = log.scrollHeight;
  }

  /* ---------- 渲染：人设 chips ---------- */
  function renderChips() {
    row.replaceChildren();
    row.hidden = personas.length === 0;
    personas.forEach((p, i) => {
      const id = idOf(p, i);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip' + (id === state.activeId ? ' is-active' : '');
      btn.dataset.id = id;
      btn.style.setProperty('--chip-i', String(i));
      btn.setAttribute('aria-pressed', id === state.activeId ? 'true' : 'false');

      const label = p.courtesy || p.name || p.title;
      const name = document.createElement('span');
      name.className = 'chip-name';
      name.textContent =
        label !== undefined && label !== null && String(label).trim() !== ''
          ? String(label)
          : id;

      const meta = document.createElement('span');
      meta.className = 'chip-meta mono';
      meta.textContent = [p.title, p.domain].filter(Boolean).join(' · ');

      btn.appendChild(name);
      if (meta.textContent) btn.appendChild(meta);
      btn.onclick = () => selectPersona(id);
      row.appendChild(btn);
    });
  }

  /* ---------- 渲染：消息流 ---------- */
  function renderLog() {
    log.replaceChildren();

    if (!personas.length) {
      const box = document.createElement('div');
      box.className = 'chat-empty';
      const rule = document.createElement('span');
      rule.className = 'chat-empty-rule halftone';
      const hint = document.createElement('p');
      hint.className = 'kicker';
      hint.textContent = 'PERSONA CHAT — 一人管一行';
      box.append(rule, hint);
      log.appendChild(box);
      return;
    }

    const p = cur();
    if (!p) return;
    if (p.openingLine) log.appendChild(openingNote(p));
    for (const m of state.msgs) {
      if (!m || typeof m.content !== 'string') continue;
      if (m.role === 'user') {
        log.appendChild(noteEl('me', m.content));
      } else if (m.role === 'assistant') {
        const art = noteEl('them', m.content);
        attachSign(art, p);
        log.appendChild(art);
      }
    }
    toBottom(true);
  }

  /* ---------- 发送态 ---------- */
  function updateSend() {
    if (!sendBtn) return;
    const ok =
      !state.generating && !!state.activeId && !!input.value.trim();
    sendBtn.disabled = !ok;
  }

  function setGenerating(on) {
    state.generating = on;
    status.hidden = !on;
    updateSend();
  }

  /* ---------- 切换人设 ---------- */
  function selectPersona(id) {
    if (indexOfId(id) < 0) return;
    if (state.activeId === String(id)) return;

    if (state.ctrl) {
      try {
        state.ctrl.abort();
      } catch {
        /* noop */
      }
      state.ctrl = null;
    }
    if (state.generating) {
      state.seq += 1; /* 旧流收尾不再干预 UI */
      state.generating = false;
      status.hidden = true;
    }

    state.activeId = String(id);
    state.msgs = bucketOf(state.activeId);
    writeActive(state.activeId);
    renderChips();
    renderLog();
    updateSend();
  }

  /* ---------- 发送 + 流式 ---------- */
  async function send(text) {
    const p = cur();
    if (!p || state.generating) return;

    const pid = state.activeId;
    const bucket = state.msgs;
    const mySeq = ++state.seq;

    log.appendChild(noteEl('me', text));
    bucket.push({ role: 'user', content: text });
    saveBucket(pid, bucket);
    toBottom(true);

    /* 当前消息单独发送，历史只取此前最近 10 条 */
    const history = bucket.slice(0, -1).slice(-HISTORY_LIMIT);

    const ctrl = new AbortController();
    state.ctrl = ctrl;
    setGenerating(true);

    const reply = noteEl('them', '');
    const body = reply.querySelector('.note-body');
    if (body) body.classList.add('streaming');
    log.appendChild(reply);
    toBottom(true);

    let acc = '';
    let errText = '';

    try {
      const res = await fetch('api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personaId: pid, message: text, history }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        let msg = 'HTTP ' + res.status;
        try {
          const j = await res.json();
          if (j && j.error) msg = String(j.error);
        } catch {
          /* 保持 HTTP 状态 */
        }
        throw new Error(msg);
      }

      const onDelta = (d) => {
        acc += d;
        if (body) body.textContent = acc;
        toBottom();
      };

      if (res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        let ended = false;
        while (!ended) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop();
          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith('data:')) continue;
            const r = parseData(t.slice(5).trim(), onDelta);
            if (r === 'done') {
              ended = true;
              break;
            }
            if (r.startsWith('error:')) throw new Error(r.slice(6));
          }
        }
      } else {
        /* 无流式读取能力：整段兜底 */
        const raw = await res.text();
        for (const line of String(raw).split('\n')) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          const r = parseData(t.slice(5).trim(), onDelta);
          if (r.startsWith('error:')) throw new Error(r.slice(6));
        }
      }
    } catch (e) {
      if (!e || e.name !== 'AbortError') errText = (e && e.message) || String(e);
    } finally {
      if (body) body.classList.remove('streaming');
      if (acc) {
        bucket.push({ role: 'assistant', content: acc });
        saveBucket(pid, bucket);
        if (!session.destroyed) attachSign(reply, p);
      } else {
        reply.remove();
      }
      if (errText && !session.destroyed && state.activeId === pid) {
        log.appendChild(errorEl(errText));
        toBottom(true);
      }
      if (!session.destroyed && state.seq === mySeq) {
        state.ctrl = null;
        setGenerating(false);
      }
      if (!session.destroyed) toBottom(true);
    }
  }

  /* ---------- 表单绑定（on* 赋值，重复 init 幂等） ---------- */
  form.onsubmit = (e) => {
    e.preventDefault();
    if (state.composing) return;
    const text = input.value.trim();
    if (!text || state.generating || !state.activeId) return;
    input.value = '';
    updateSend();
    send(text).catch(() => {});
  };
  input.oninput = () => updateSend();
  input.onkeydown = (e) => {
    if (e.key === 'Enter' && (e.isComposing || state.composing)) e.preventDefault();
  };
  input.oncompositionstart = () => {
    state.composing = true;
  };
  input.oncompositionend = () => {
    state.composing = false;
  };

  /* ---------- 首启：恢复上次人设，否则取第一位 ---------- */
  renderChips();
  if (personas.length) {
    const saved = readActive();
    const start = indexOfId(saved) >= 0 ? saved : idOf(personas[0], 0);
    state.activeId = '';
    selectPersona(start);
  } else {
    renderLog();
    updateSend();
  }
}
