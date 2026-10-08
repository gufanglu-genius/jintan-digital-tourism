/* ============================================================
   研学任务卡 — 逐题翻页的田野调查表单
   形态：任务卡=田野表单 · 题干=情境文案 · 选项=可点纸条
   作答：对 → 盖「通关」章 + 解说展开；错 → riso 错位抖动 + 解说指正
   数据：window.__PLAY_DATA__.quiz.questions（q/options/answer/explain/topic）
   状态：sessionStorage["shuxu.quiz"]，刷新续答
   ============================================================ */

const KEY = 'shuxu.quiz';
const VER = 1;
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

/* ---------------- 工具 ---------------- */
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

const pad = (n) => String(n).padStart(2, '0');

const reduced = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* 数据清洗：不合规的题直接剔除，绝不让坏数据抛错 */
function normalize(src) {
  if (!Array.isArray(src)) return [];
  const out = [];
  for (const item of src) {
    if (!item || typeof item.q !== 'string' || !Array.isArray(item.options) || item.options.length < 2) continue;
    const answer = Number(item.answer);
    if (!Number.isInteger(answer) || answer < 0 || answer >= item.options.length) continue;
    out.push({
      q: item.q,
      options: item.options.map((o) => String(o)),
      answer,
      explain: typeof item.explain === 'string' ? item.explain : '',
      topic: typeof item.topic === 'string' && item.topic.trim() ? item.topic : '综合',
    });
  }
  return out;
}

function bankFrom(data) {
  if (Array.isArray(data)) return normalize(data);
  if (data && Array.isArray(data.questions)) return normalize(data.questions);
  const w = typeof window !== 'undefined' ? window.__PLAY_DATA__ : null;
  if (w && w.quiz) return normalize(w.quiz.questions);
  return [];
}

/* ---------------- 会话状态 ---------------- */
function freshState(n) {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = order[i];
    order[i] = order[j];
    order[j] = t;
  }
  return { v: VER, sig: n, order, picks: {}, cur: 0, done: false };
}

function readState(questions) {
  const n = questions.length;
  let raw = null;
  try {
    raw = sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    if (!s || s.v !== VER || s.sig !== n || !Array.isArray(s.order) || s.order.length !== n) return null;
    if (s.order.some((x) => !Number.isInteger(x) || x < 0 || x >= n)) return null;
    const picks = {};
    const src = s.picks && typeof s.picks === 'object' ? s.picks : {};
    for (const k of Object.keys(src)) {
      const pos = Number(k);
      const val = Number(src[k]);
      if (!Number.isInteger(pos) || pos < 0 || pos >= n) continue;
      const optCount = questions[s.order[pos]].options.length;
      if (!Number.isInteger(val) || val < 0 || val >= optCount) continue;
      picks[pos] = val;
    }
    const cur = Number.isInteger(s.cur) ? Math.min(Math.max(s.cur, 0), n - 1) : 0;
    return { v: VER, sig: n, order: s.order.slice(), picks, cur, done: !!s.done };
  } catch {
    return null;
  }
}

function writeState(s) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 隐私模式下静默降级：本次会话仍可用 */
  }
}

/* ---------------- 模块入口 ---------------- */
export function initQuiz(pane, data) {
  if (!pane) return;
  if (typeof pane.__quizOff === 'function') pane.__quizOff();

  const questions = bankFrom(data);

  /* —— 空题库：印制中，不报错 —— */
  if (!questions.length) {
    pane.dataset.module = 'quiz';
    pane.dataset.status = 'empty';
    pane.innerHTML = `
      <div class="quiz-card quiz-empty" tabindex="-1">
        <span class="tape" style="top:-13px; right:11%; transform:rotate(4deg);"></span>
        <span class="kicker">FIELD SURVEY · 研学任务卡</span>
        <p class="quiz-empty-title">任务卡印制中…</p>
        <p class="kicker">QUESTIONNAIRE — 排版付印中</p>
        <div class="halftone quiz-empty-bar" aria-hidden="true"></div>
      </div>`;
    pane.__quizOff = function () {};
    return;
  }

  const n = questions.length;
  const state = readState(questions) || freshState(n);
  writeState(state);

  let pending = null;      // 已勾选、尚未「提交」的纸条
  let swapTimer = 0;
  let shakeTimer = 0;

  pane.dataset.module = 'quiz';
  pane.dataset.status = 'ready';

  pane.innerHTML = `
    <section class="quiz" aria-label="研学任务卡">
      <div class="quiz-head">
        <div class="quiz-id">
          <span class="kicker">RESEARCH TASK · 研学任务卡</span>
          <div class="quiz-progress mono" id="quizProg"><span class="now">01</span><span class="total">/ ${pad(n)}</span></div>
        </div>
        <div class="quiz-topics" aria-label="题目进度分组"></div>
      </div>
      <div class="quiz-stage" id="quizStage"></div>
      <p class="quiz-hint mono">键盘 · 数字键选答　Enter 提交 / 下一题　← 返回</p>
    </section>`;

  const stage = pane.querySelector('#quizStage');
  const topicsEl = pane.querySelector('.quiz-topics');
  const progEl = pane.querySelector('#quizProg');
  const hintEl = pane.querySelector('.quiz-hint');

  const curQ = () => questions[state.order[state.cur]];

  /* —— 顶部：编号 + 主题分组点 —— */
  function renderHead() {
    const now = state.done ? n : state.cur + 1;
    progEl.querySelector('.now').textContent = pad(now);
    progEl.setAttribute('aria-label', `进度：第 ${now} 题，共 ${n} 题`);

    /* 按出现顺序给主题分组 */
    const groups = [];
    state.order.forEach((qi, pos) => {
      const topic = questions[qi].topic;
      let g = groups.find((x) => x.topic === topic);
      if (!g) groups.push((g = { topic, pos: [] }));
      g.pos.push(pos);
    });

    topicsEl.innerHTML = groups
      .map((g) => {
        const dots = g.pos
          .map((pos) => {
            const picked = state.picks[pos];
            let st = 'pend';
            let label = '未作答';
            if (picked !== undefined) {
              const ok = picked === questions[state.order[pos]].answer;
              st = ok ? 'right' : 'wrong';
              label = ok ? '正确' : '错误';
            } else if (!state.done && pos === state.cur) {
              st = 'cur';
              label = '当前';
            }
            const jump = !state.done && pos <= state.cur;
            return `<button type="button" class="quiz-dot" data-dot="${pos}" data-state="${st}"${
              jump ? '' : ' disabled'
            } aria-label="第 ${pos + 1} 题 ${esc(g.topic)} · ${label}" title="第 ${pos + 1} 题 · ${esc(g.topic)}"></button>`;
          })
          .join('');
        return `<div class="quiz-tgroup"><span class="quiz-tlabel mono">${esc(g.topic)}</span><span class="quiz-tdots">${dots}</span></div>`;
      })
      .join('');
  }

  /* —— 任务卡（田野调查表单） —— */
  function cardHTML() {
    const q = curQ();
    const picked = state.picks[state.cur];
    const answered = picked !== undefined;
    const right = answered && picked === q.answer;
    const isLast = state.cur === n - 1;
    const stateLabel = answered ? (right ? '已答对' : '已作答') : '作答中';

    const opts = q.options
      .map((text, i) => {
        let cls = 'quiz-opt';
        let tag = '';
        if (answered) {
          if (i === q.answer) {
            cls += ' is-answer';
            tag = '<span class="tag tag-ok">答案</span>';
          }
          if (i === picked && i !== q.answer) {
            cls += ' is-picked-wrong';
            tag = '<span class="tag tag-no">已选</span>';
          }
        }
        const key = i < LETTERS.length ? LETTERS[i] : String(i + 1);
        const pressed = answered ? String(i === picked) : 'false';
        return `<li><button type="button" class="${cls}" data-opt="${i}" aria-pressed="${pressed}"${
          answered ? ' disabled' : ''
        }><span class="key" aria-hidden="true">${key}</span><span class="txt">${esc(text)}</span>${tag}</button></li>`;
      })
      .join('');

    const fb = answered
      ? `<div class="quiz-feedback ${right ? 'is-right' : 'is-wrong'}" role="status">${
          right ? '<span class="stamp">通关</span>' : ''
        }<span class="fb-label mono">${right ? '答对了 · PASS' : '答错了 · CHECK'}</span>${
          q.explain ? `<p>${esc(q.explain)}</p>` : ''
        }</div>`
      : '';

    const primary = answered
      ? `<button type="button" class="btn primary" data-act="next">${isLast ? '查看成绩' : '下一题'}</button>`
      : `<button type="button" class="btn primary" data-act="submit" disabled>提交</button>`;

    return `
      <article class="quiz-card" tabindex="-1">
        <span class="tape" style="top:-13px; right:9%; transform:rotate(-4deg);"></span>
        <div class="quiz-meta mono">
          <span>NO. ${pad(state.cur + 1)} / ${pad(n)}</span>
          <span>TOPIC · ${esc(q.topic)}</span>
          <span class="quiz-state">${stateLabel}</span>
        </div>
        <span class="kicker">题干 · SCENARIO</span>
        <h3 class="quiz-stem">${esc(q.q)}</h3>
        <span class="kicker">选项 · OPTIONS</span>
        <ul class="quiz-opts">${opts}</ul>
        ${fb}
        <div class="quiz-actions">
          <button type="button" class="btn ghost" data-act="back"${
            state.cur === 0 ? ' disabled' : ''
          }>返回</button>
          ${primary}
        </div>
      </article>`;
  }

  /* —— 结束页：得分 · 按主题掌握格 · 重新抽题 —— */
  function doneHTML() {
    let score = 0;
    const groups = [];
    state.order.forEach((qi, pos) => {
      const q = questions[qi];
      const ok = state.picks[pos] === q.answer;
      if (ok) score++;
      let g = groups.find((x) => x.topic === q.topic);
      if (!g) groups.push((g = { topic: q.topic, ok: 0, total: 0, boxes: '' }));
      g.total++;
      if (ok) g.ok++;
      g.boxes += `<span class="mbox ${ok ? 'ok' : 'no'}" title="第 ${pos + 1} 题"></span>`;
    });

    const rows = groups
      .map(
        (g) => `
        <div class="mrow">
          <span class="mname mono">${esc(g.topic)}</span>
          <span class="mboxes">${g.boxes}</span>
          <span class="mfrac mono">${g.ok}/${g.total}</span>
        </div>`
      )
      .join('');

    return `
      <article class="quiz-card quiz-result" tabindex="-1">
        <span class="tape" style="top:-13px; left:10%; transform:rotate(5deg);"></span>
        <div class="quiz-meta mono">
          <span>REPORT</span>
          <span>研学成绩单</span>
          <span class="quiz-state">完卷</span>
        </div>
        <div class="quiz-result-grid">
          <div class="quiz-score">
            <div class="halftone score-patch" aria-hidden="true"></div>
            <span class="kicker">得分 · SCORE</span>
            <div class="score-line">
              <span class="score-num mono riso">${score}</span>
              <span class="score-den mono">/ ${n}</span>
            </div>
            <span class="stamp quiz-done-stamp">完卷</span>
          </div>
          <div class="quiz-mastery">
            <span class="kicker">按主题掌握格 · MASTERY</span>
            ${rows}
            <div class="mlegend mono"><i class="mbox ok"></i>已掌握<i class="mbox no"></i>需巩固</div>
          </div>
        </div>
        <div class="quiz-actions">
          <span class="quiz-score-note mono">共 ${n} 题 · 每次重新抽题顺序不同</span>
          <button type="button" class="btn primary" data-act="restart">重新抽题</button>
        </div>
      </article>`;
  }

  /* —— 舞台渲染 —— */
  function renderStage(mode, ok) {
    stage.innerHTML = state.done ? doneHTML() : cardHTML();
    const card = stage.firstElementChild;
    if (!card) return;
    if (mode === 'enter' && !reduced()) card.classList.add('is-enter');
    if (mode === 'answer' && ok === false && !reduced()) {
      card.classList.add('is-shake');
      window.clearTimeout(shakeTimer);
      shakeTimer = window.setTimeout(() => card.classList.remove('is-shake'), 560);
    }
    hintEl.hidden = !!state.done;
  }

  function focusCard() {
    const card = stage.firstElementChild;
    if (card && typeof card.focus === 'function') {
      try {
        card.focus({ preventScroll: true });
      } catch {
        card.focus();
      }
    }
  }

  /* —— 换题（翻页） —— */
  function swapTo(pos) {
    if (pos < 0 || pos >= n) return;
    pending = null;
    const apply = () => {
      state.cur = pos;
      writeState(state);
      renderHead();
      renderStage('enter');
      focusCard();
    };
    const card = stage.firstElementChild;
    window.clearTimeout(swapTimer);
    if (!card || reduced()) {
      apply();
      return;
    }
    card.classList.add('is-leaving');
    swapTimer = window.setTimeout(apply, 160);
  }

  function go(delta) {
    const target = state.cur + delta;
    if (target < 0 || target >= n) return;
    if (delta > 0 && state.picks[state.cur] === undefined) return;
    swapTo(target);
  }

  function advance() {
    if (state.picks[state.cur] === undefined) return;
    if (state.cur >= n - 1) {
      state.done = true;
      pending = null;
      writeState(state);
      renderHead();
      renderStage('enter');
      focusCard();
      return;
    }
    go(1);
  }

  /* —— 勾选纸条（两步：勾选 → 提交） —— */
  function selectOpt(i) {
    if (state.done || state.picks[state.cur] !== undefined) return;
    const q = curQ();
    if (!Number.isInteger(i) || i < 0 || i >= q.options.length) return;
    pending = pending === i ? null : i;
    const opts = stage.querySelectorAll('.quiz-opt');
    opts.forEach((el, idx) => {
      const on = idx === pending;
      el.classList.toggle('is-sel', on);
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const sub = stage.querySelector('[data-act="submit"]');
    if (sub) sub.disabled = pending === null;
  }

  function submit() {
    if (state.done || state.picks[state.cur] !== undefined || pending === null) return;
    const q = curQ();
    const picked = pending;
    pending = null;
    state.picks[state.cur] = picked;
    writeState(state);
    const ok = picked === q.answer;
    renderHead();
    renderStage('answer', ok);
    const btn = stage.querySelector('[data-act="next"]');
    if (btn && typeof btn.focus === 'function') {
      try {
        btn.focus({ preventScroll: true });
      } catch {
        btn.focus();
      }
    }
  }

  function restart() {
    const s = freshState(n);
    state.order = s.order;
    state.picks = s.picks;
    state.cur = 0;
    state.done = false;
    pending = null;
    writeState(state);
    renderHead();
    renderStage('enter');
    focusCard();
  }

  /* —— 点击（事件委托，重渲染不丢监听） —— */
  function onClick(e) {
    const opt = e.target.closest ? e.target.closest('[data-opt]') : null;
    if (opt) {
      selectOpt(Number(opt.dataset.opt));
      return;
    }
    const dot = e.target.closest ? e.target.closest('[data-dot]') : null;
    if (dot && !dot.disabled) {
      const pos = Number(dot.dataset.dot);
      if (pos !== state.cur && !state.done) swapTo(pos);
      return;
    }
    const act = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!act || act.disabled) return;
    const name = act.dataset.act;
    if (name === 'submit') submit();
    else if (name === 'next') advance();
    else if (name === 'back') go(-1);
    else if (name === 'restart') restart();
  }

  /* —— 键盘：数字选答 / Enter 提交·前进 / ← 返回 ——
     焦点在按钮上时按按钮语义执行并 preventDefault，
     既避免浏览器合成 click 双触发，也让行为在任何焦点下确定 —— */
  function onKey(e) {
    if (pane.hidden || state.done) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]')) return;

    /* 只在焦点位于卡片内或页面默认位置时接管按键 */
    const ae = document.activeElement;
    const inPane = !ae || ae === document.body || (ae !== pane && pane.contains(ae)) || ae === pane;
    if (!inPane) return;

    if (/^[1-9]$/.test(e.key)) {
      const i = Number(e.key) - 1;
      if (state.picks[state.cur] === undefined && i < curQ().options.length) {
        e.preventDefault();
        selectOpt(i);
      }
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      const unanswered = state.picks[state.cur] === undefined;

      if (ae && ae.tagName === 'BUTTON' && pane.contains(ae)) {
        if (ae.dataset.opt !== undefined) {
          if (!unanswered) return;
          const i = Number(ae.dataset.opt);
          if (pending === i) submit();
          else selectOpt(i);
          return;
        }
        if (ae.disabled) return;
        const act = ae.dataset.act;
        if (act === 'submit') submit();
        else if (act === 'next') advance();
        else if (act === 'back') go(-1);
        else if (act === 'restart') restart();
        return;
      }

      if (unanswered) submit();
      else advance();
      return;
    }

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      go(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (state.picks[state.cur] !== undefined) advance();
    }
  }

  pane.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);

  pane.__quizOff = function () {
    window.clearTimeout(swapTimer);
    window.clearTimeout(shakeTimer);
    pane.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKey);
  };

  renderHead();
  renderStage('enter');
}
