/* ============================================================
   非遗华容道 — 4×4 照片剪片拼图（金坛数字文旅平台）
   算法沿用前身项目 nh-huarongdao：随机游走洗牌 / isSolved / IDA* 求解
   界面按 Lo-Fi 手账规范重写：纸面裁切、胶带、印章、Riso 套印、硬偏移阴影
   导出：export function initHuarongdao(container, data) —— 幂等
   ============================================================ */

const SIZE = 4;
const SHUFFLE = 120;          // 洗牌步数（随机游走，保证可解）
const AUTO_MS = 300;          // 自动完成每步间隔
const HINT_BUDGET = 1300;     // 提示求解时间预算（ms）
const SOLVE_BUDGET = 2600;    // 自动完成求解时间预算（ms）
const LS_KEY = 'jsws-hrd-v1';

/* 前身项目图片（已压缩进 public/assets/hrd/），数据缺新图时兜底 */
const OLD_IMGS = [
  'assets/hrd/luanzhenxiu.jpg',
  'assets/hrd/damagao.jpg',
  'assets/hrd/shubi.jpg',
  'assets/hrd/liuqingzhuke.jpg',
];

/* 数据文件为空时的兜底关卡：内容逐字取自前身项目 nh-huarongdao 的真实关卡资料 */
const FALLBACK = [
  {
    level: '乱针绣', title: '绣心护体', artifact: '',
    winText: '乱针绣由常州武进人杨守玉于1930年代独创。她将西洋绘画的色彩理论与中国传统刺绣技艺融合，以长短交叉、分层加色的针法打破传统刺绣“密接其针、排比其线”的规则，形成“以针为笔、以线为色”的独特艺术风格。乱针绣作品远观如油画般色彩斑斓，近看则针法细腻、层次分明，被誉为中国刺绣艺术的一大突破，2007年列入江苏省非物质文化遗产名录。',
  },
  {
    level: '大麻糕', title: '麻糕充饥', artifact: '',
    winText: '大麻糕是常州武进地区的传统名点，始于清咸丰年间，至今已有百余年历史。以面粉、芝麻、猪油、白糖为主要原料，经揉面、包馅、压模、烘烤等工序制成。成品色泽金黄、香甜酥脆、入口即化，是常州人逢年过节、走亲访友的必备糕点。大麻糕制作技艺于2009年列入常州市非物质文化遗产名录，承载着武进人世代相传的味觉记忆。',
  },
  {
    level: '梳篦', title: '梳篦理绪', artifact: '',
    winText: '常州梳篦制作始于东晋，距今已有一千六百余年历史。以黄杨木为料，经选料、开片、拉花、刻花等七十余道工序精制而成。梳篦齿密而不挂发，篦发去垢而不伤头皮，兼具实用与观赏价值。常州梳篦在明清时期被列为贡品，有“宫梳名篦”之美誉。其制作技艺于2008年列入国家级非物质文化遗产名录，是中国传统手工艺的瑰宝。',
  },
  {
    level: '留青竹刻', title: '竹刻铭记', artifact: '',
    winText: '留青竹刻始于唐代，兴盛于明清，是常州武进的传统竹刻艺术。其技法独特——利用竹皮青筠的厚薄变化表现画面层次，铲去花纹以外的竹皮，留下青筠作为图案，故名“留青”。作品刀法细腻、层次分明、意境深远，集书画、雕刻于一体。常州留青竹刻于2008年列入国家级非物质文化遗产名录，代表了中国竹刻艺术的最高水平。',
  },
];

/* ---------------- 小工具 ---------------- */
const $ = (sel, root) => root.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function reduceMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function tokenColors() {
  const css = getComputedStyle(document.documentElement);
  const pick = (n) => (css.getPropertyValue(n) || '').trim();
  const list = [pick('--riso-pink'), pick('--riso-cyan'), pick('--riso-red'), pick('--paper'), pick('--paper-card')];
  return list.filter(Boolean);
}

function loadProgress() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; }
}
function saveProgress(p) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch { /* 隐私模式忽略 */ }
}

/* ---------------- 关卡数据 ---------------- */
function isNumeric(v) {
  return typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v.trim()));
}

function normLevel(raw, i) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  const lvRaw = src.level;
  const tiRaw = src.title;
  let name = '';
  let sub = '';
  if (typeof lvRaw === 'string' && lvRaw && !isNumeric(lvRaw)) {
    name = lvRaw;
    if (typeof tiRaw === 'string' && tiRaw) sub = tiRaw;
  } else if (typeof tiRaw === 'string' && tiRaw) {
    name = tiRaw;
  } else if (lvRaw !== undefined && isNumeric(lvRaw)) {
    name = `第 ${lvRaw} 关`;
  } else {
    name = `第 ${i + 1} 关`;
  }
  return {
    index: i,
    name,
    sub,
    artifact: typeof src.artifact === 'string' ? src.artifact : '',
    winText: typeof src.winText === 'string' ? src.winText : '',
    imagePrompt: typeof src.imagePrompt === 'string' ? src.imagePrompt : '',
    image: OLD_IMGS[i % OLD_IMGS.length],
    fromFallback: true,
    key: `${i}|${name}`,
  };
}

function pickLevels(data) {
  const g = (typeof window !== 'undefined' && window.__PLAY_DATA__ && window.__PLAY_DATA__.games) || null;
  let arr = null;
  if (g && Array.isArray(g.huarongdao) && g.huarongdao.length) arr = g.huarongdao;
  else if (Array.isArray(data) && data.length) arr = data;
  else if (data && Array.isArray(data.huarongdao) && data.huarongdao.length) arr = data.huarongdao;
  else arr = FALLBACK;
  return arr.map(normLevel);
}

function probe(url) {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => res(true);
    im.onerror = () => res(false);
    im.src = url;
  });
}

function candidates(lv) {
  const out = [];
  const push = (u) => { if (u && out.indexOf(u) < 0) out.push(u); };
  // 正式关卡图优先（lvN.jpg 已随包发布），命中即停，避免探测死路径刷 404
  push(`assets/hrd/lv${lv.index + 1}.jpg`);
  push(`assets/hrd/lv${lv.index + 1}.png`);
  push(`assets/hrd/level-${lv.index + 1}.jpg`);
  push(`assets/hrd/level-${lv.index + 1}.png`);
  const slugs = [lv.name, lv.sub, lv.artifact]
    .filter((s) => typeof s === 'string' && s && !isNumeric(s));
  slugs.forEach((s) => {
    const enc = encodeURIComponent(s);
    push(`assets/hrd/${enc}.jpg`);
    push(`assets/hrd/${enc}.png`);
  });
  OLD_IMGS.forEach((u) => push(u));
  return out;
}

async function resolveImages(levels) {
  let changed = false;
  await Promise.all(levels.map(async (lv) => {
    for (const u of candidates(lv)) {
      if (await probe(u)) {
        if (u !== lv.image) { lv.image = u; changed = true; }
        lv.fromFallback = OLD_IMGS.indexOf(u) >= 0;
        return;
      }
    }
    lv.fromFallback = true;
  }));
  return changed;
}

/* ---------------- 拼图算法 ---------------- */
function makeBoard() {
  const b = [];
  for (let i = 0; i < SIZE * SIZE - 1; i++) b.push(i + 1);
  b.push(0);
  let empty = SIZE * SIZE - 1;
  let noGo = -1;
  const nb = (idx) => {
    const r = idx >> 2, c = idx & 3, out = [];
    if (r > 0) out.push(idx - 4);
    if (r < 3) out.push(idx + 4);
    if (c > 0) out.push(idx - 1);
    if (c < 3) out.push(idx + 1);
    return out;
  };
  for (let i = 0; i < SHUFFLE; i++) {
    let cand = nb(empty).filter((x) => x !== noGo);
    if (!cand.length) cand = nb(empty);
    const from = cand[(Math.random() * cand.length) | 0];
    b[empty] = b[from];
    b[from] = 0;
    noGo = empty;
    empty = from;
  }
  if (isSolvedArr(b)) { // 极小概率：再走一步打散
    const from = nb(b.indexOf(0))[0];
    const e = b.indexOf(0);
    b[e] = b[from];
    b[from] = 0;
  }
  return b;
}

function isSolvedArr(b) {
  for (let i = 0; i < SIZE * SIZE - 1; i++) if (b[i] !== i + 1) return false;
  return b[SIZE * SIZE - 1] === 0;
}

/* IDA* 求解（曼哈顿启发，带节点/时间预算，返回“要移动的格子下标”序列） */
function solveBoard(start, empty0, budgetMs) {
  const s = start.slice();
  let empty = empty0;
  const path = [];
  let nodes = 0;
  const t0 = Date.now();
  let aborted = false;

  function h(b) {
    let d = 0;
    for (let i = 0; i < SIZE * SIZE - 1; i++) {
      const v = b[i];
      if (v === 0 || v === i + 1) continue;
      const tr = (v - 1) >> 2, tc = (v - 1) & 3;
      d += Math.abs((i >> 2) - tr) + Math.abs((i & 3) - tc);
    }
    return d;
  }

  function isGoal(b) {
    for (let i = 0; i < SIZE * SIZE - 1; i++) if (b[i] !== i + 1) return false;
    return b[SIZE * SIZE - 1] === 0;
  }

  function search(g, bound, prev) {
    nodes++;
    if ((nodes & 2047) === 0 && Date.now() - t0 > budgetMs) { aborted = true; return -2; }
    const f = g + h(s);
    if (f > bound) return f;
    if (isGoal(s)) return -1;
    let min = Infinity;
    const er = empty >> 2, ec = empty & 3;
    const nr = [er - 1, er + 1, er, er];
    const nc = [ec, ec, ec - 1, ec + 1];
    for (let d = 0; d < 4; d++) {
      if (nr[d] < 0 || nr[d] > 3 || nc[d] < 0 || nc[d] > 3) continue;
      const from = nr[d] * 4 + nc[d];
      if (from === prev) continue;
      const e = empty;
      s[e] = s[from];
      s[from] = 0;
      empty = from;
      path.push(from);
      const t = search(g + 1, bound, e);
      if (t === -1) return -1;
      if (t === -2) return -2;
      path.pop();
      s[from] = s[e];
      s[e] = 0;
      empty = e;
      if (t < min) min = t;
    }
    return min;
  }

  let bound = h(s);
  for (let iter = 0; iter < 500; iter++) {
    path.length = 0;
    const t = search(0, bound, -1);
    if (t === -1) return path.slice();
    if (aborted || t === -2 || t === Infinity) return null;
    if (typeof t !== 'number' || t <= bound) return null;
    bound = t;
  }
  return null;
}

/* ============================================================
   模块主体
   ============================================================ */
export function initHuarongdao(container, data) {
  if (!container) return;
  if (container.dataset.hrdReady === '1') return; // 幂等：重复调用不再重建
  container.dataset.hrdReady = '1';
  container.dataset.module = 'huarongdao';
  container.dataset.status = 'ready';
  boot(container, data);
}

function boot(container, data) {
  const S = {
    levels: pickLevels(data),
    state: 'menu',       // menu | levels | play | win
    lv: null,
    cur: -1,
    board: [],
    initial: [],
    empty: 15,
    moves: 0,
    hints: 0,
    autoUsed: false,
    won: false,
    elapsedMs: 0,
    startedAt: 0,
    timerId: null,
    auto: false,
    autoSol: null,
    autoIdx: 0,
    autoId: null,
    winTimer: null,
    busy: false,
    hintLock: false,
    tileEls: {},
    els: {},
    progress: loadProgress(),
  };

  container.classList.add('hrd');
  container.innerHTML = '';
  const root = el('<div class="hrd-root"></div>');
  container.appendChild(root);
  S.els.root = root;

  /* ---------- 渲染：状态切换 ---------- */
  function setState(name, focus) {
    S.state = name;
    container.dataset.state = name;
    render(focus);
  }

  function render(focus) {
    clearWin();
    stopTimer();
    root.innerHTML = '';
    if (S.state === 'menu') root.appendChild(renderMenu());
    else if (S.state === 'levels') root.appendChild(renderLevels());
    else if (S.state === 'play') root.appendChild(renderPlay());
    if (focus) {
      const s = $('.hrd-state', root);
      if (s) { try { s.focus({ preventScroll: true }); } catch { s.focus(); } }
    }
  }

  /* ---------- 菜单 ---------- */
  function renderMenu() {
    const strip = S.levels.map((lv, i) => `
      <button type="button" class="hrd-strip-item" data-go="${i}" style="--i:${i}" aria-label="关卡 ${i + 1}　${lv.name}">
        <img src="${lv.image}" alt="" loading="lazy">
        <span class="hrd-strip-no mono">${String(i + 1).padStart(2, '0')}</span>
      </button>`).join('');

    const node = el(`
      <div class="hrd-state hrd-menu" tabindex="-1">
        <div class="hrd-menu-text">
          <span class="tape" style="top:-14px; left:4%; transform:rotate(-6deg);"></span>
          <p class="kicker">SLIDING PUZZLE · 4×4</p>
          <h3 class="hrd-menu-title">非遗华容道</h3>
          <p class="lede">十六片照片剪片散在纸面上。把它们滑回原位，每归位一件，就揭开一段技艺的来历。</p>
          <div class="hrd-menu-cta">
            <button type="button" class="btn primary" data-act="start">开始拼图</button>
            <span class="kicker hrd-menu-note">4 关 · 可提示 · 可自动完成</span>
          </div>
        </div>
        <div class="hrd-menu-side">
          <p class="kicker">CONTACT SHEET — 关卡印样</p>
          <div class="hrd-strip hrd-stagger">${strip}</div>
        </div>
      </div>`);

    node.addEventListener('click', (e) => {
      const go = e.target.closest('[data-go]');
      if (go) { startLevel(Number(go.dataset.go)); return; }
      if (e.target.closest('[data-act="start"]')) setState('levels', true);
    });
    return node;
  }

  /* ---------- 关卡选择 ---------- */
  function renderLevels() {
    const cards = S.levels.map((lv, i) => {
      const p = S.progress[lv.key];
      const stars = p && p.stars ? p.stars : 0;
      const starHtml = stars
        ? `<span class="hrd-lv-stars mono" aria-label="最佳 ${stars} 星">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>`
        : '<span class="hrd-lv-stars mono hrd-lv-none">— — —</span>';
      return `
      <button type="button" class="hrd-lv" data-go="${i}" style="--i:${i}" aria-label="进入关卡 ${i + 1}　${lv.name}">
        <span class="hrd-lv-thumb"><img src="${lv.image}" alt="" loading="lazy"></span>
        <span class="hrd-lv-no mono">${String(i + 1).padStart(2, '0')}</span>
        ${p ? '<span class="stamp hrd-lv-done">通关</span>' : ''}
        <span class="hrd-lv-body">
          <span class="hrd-lv-name">${lv.name}</span>
          ${lv.sub ? `<span class="hrd-lv-sub">${lv.sub}</span>` : ''}
          ${lv.artifact ? `<span class="hrd-lv-art mono">${lv.artifact}</span>` : ''}
        </span>
        ${starHtml}
      </button>`;
    }).join('');

    const node = el(`
      <div class="hrd-state hrd-levels-wrap" tabindex="-1">
        <div class="hrd-sub-top">
          <button type="button" class="btn ghost" data-act="back">← 返回</button>
          <div>
            <p class="kicker">SELECT — 关卡选择</p>
            <h3 class="hrd-sub-title">四帧影像，四道裁切</h3>
          </div>
        </div>
        <div class="hrd-levels hrd-stagger">${cards}</div>
      </div>`);

    node.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="back"]')) { setState('menu', true); return; }
      const go = e.target.closest('[data-go]');
      if (go) startLevel(Number(go.dataset.go));
    });
    return node;
  }

  /* ---------- 对局 ---------- */
  function renderPlay() {
    const lv = S.lv;
    const showArt = !!lv.artifact;
    const showGen = !!(lv.imagePrompt && lv.fromFallback);
    const node = el(`
      <div class="hrd-state hrd-play" tabindex="-1">
        <div class="hrd-play-top">
          <button type="button" class="btn ghost" data-act="back">← 返回</button>
          <div class="hrd-play-title">
            <p class="kicker">LEVEL ${String(S.cur + 1).padStart(2, '0')} / ${String(S.levels.length).padStart(2, '0')}</p>
            <h3>${lv.name}</h3>
            ${lv.sub ? `<p class="hrd-play-sub">${lv.sub}</p>` : ''}
          </div>
          ${showArt ? `<span class="stamp hrd-art">${lv.artifact}</span>` : ''}
        </div>

        <div class="hrd-play-grid">
          <div class="hrd-board-col">
            <div class="hrd-board-wrap">
              <span class="hrd-crop tl"></span><span class="hrd-crop tr"></span>
              <span class="hrd-crop bl"></span><span class="hrd-crop br"></span>
              <span class="tape" style="top:-13px; right:8%; transform:rotate(5deg);"></span>
              <div class="hrd-board halftone" role="group" aria-label="拼图盘：点选与空格相邻的剪片"></div>
            </div>
            <p class="hrd-caption mono">点选空格相邻的剪片滑入空位，或用方向键推动</p>
          </div>

          <aside class="hrd-side">
            <div class="hrd-stats">
              <div class="hrd-stat"><span class="k">步数</span><i class="lead"></i><span class="v mono" data-st="moves">0</span></div>
              <div class="hrd-stat"><span class="k">用时</span><i class="lead"></i><span class="v mono" data-st="time">00:00</span></div>
              <div class="hrd-stat"><span class="k">最佳</span><i class="lead"></i><span class="v mono" data-st="best">— — —</span></div>
            </div>
            <div class="hrd-actions">
              <button type="button" class="btn primary" data-act="hint">提示</button>
              <button type="button" class="btn" data-act="auto">自动完成</button>
              <button type="button" class="btn ghost" data-act="restart">重开</button>
              ${showGen ? '<button type="button" class="btn ghost" data-act="gen">生成配图</button>' : ''}
            </div>
            <p class="hrd-side-note kicker">拖动、提示与自动完成均由 IDA* 在本地推演，不联网。</p>
            <div class="hrd-sr" aria-live="polite" data-st="sr"></div>
          </aside>
        </div>
      </div>`);

    S.els.play = node;
    S.els.moves = $('[data-st="moves"]', node);
    S.els.time = $('[data-st="time"]', node);
    S.els.best = $('[data-st="best"]', node);
    S.els.sr = $('[data-st="sr"]', node);
    S.els.hint = $('[data-act="hint"]', node);
    S.els.auto = $('[data-act="auto"]', node);
    S.els.restart = $('[data-act="restart"]', node);

    buildBoard($('.hrd-board', node));
    paintStats();
    updateMovable();

    node.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]');
      if (act) {
        const a = act.dataset.act;
        if (a === 'back') { stopAuto(); setState('levels', true); }
        else if (a === 'hint') doHint();
        else if (a === 'auto') toggleAuto();
        else if (a === 'restart') restart();
        else if (a === 'gen') genImage();
        return;
      }
      const tile = e.target.closest('.hrd-tile');
      if (tile && tile.classList.contains('movable')) manualMove(Number(tile.dataset.idx));
    });
    return node;
  }

  function buildBoard(boardEl) {
    S.els.board = boardEl;
    S.tileEls = {};
    boardEl.innerHTML = '';
    for (let v = 1; v < SIZE * SIZE; v++) {
      const home = v - 1;
      const hr = home >> 2, hc = home & 3;
      const t = el('<div class="hrd-tile" role="button" aria-label=""></div>');
      t.dataset.v = String(v);
      t.style.backgroundImage = 'none';
      const face = el('<span class="hrd-tile-face"></span>');
      face.style.backgroundImage = `url("${S.lv.image}")`;
      face.style.backgroundPosition = `${(hc * 100) / 3}% ${(hr * 100) / 3}%`;
      const no = el(`<span class="hrd-tile-no mono">${v}</span>`);
      t.appendChild(face);
      t.appendChild(no);
      boardEl.appendChild(t);
      S.tileEls[v] = t;
    }
    const emp = el('<div class="hrd-empty"><span class="hrd-empty-cell halftone">空</span></div>');
    boardEl.appendChild(emp);
    S.els.emptyMark = emp;
    // 按初始盘面摆位
    for (let i = 0; i < S.board.length; i++) {
      const v = S.board[i];
      if (v) placeTile(v, i);
    }
    placeEmpty(S.empty);
  }

  function placeTile(v, idx) {
    const t = S.tileEls[v];
    if (!t) return;
    t.style.left = `${(idx & 3) * 25}%`;
    t.style.top = `${(idx >> 2) * 25}%`;
    t.dataset.idx = String(idx);
    t.setAttribute('aria-label', `第 ${v} 片`);
  }

  function placeEmpty(idx) {
    const m = S.els.emptyMark;
    if (!m) return;
    m.style.left = `${(idx & 3) * 25}%`;
    m.style.top = `${(idx >> 2) * 25}%`;
  }

  function updateMovable() {
    const e = S.empty;
    const er = e >> 2, ec = e & 3;
    Object.keys(S.tileEls).forEach((k) => {
      const t = S.tileEls[k];
      const idx = Number(t.dataset.idx);
      if (Number.isNaN(idx)) return;
      const r = idx >> 2, c = idx & 3;
      const adj = Math.abs(r - er) + Math.abs(c - ec) === 1;
      t.classList.toggle('movable', adj);
      if (adj) {
        let arw = '';
        if (er < r) arw = '↑';
        else if (er > r) arw = '↓';
        else if (ec < c) arw = '←';
        else arw = '→';
        t.dataset.arw = arw;
      } else {
        delete t.dataset.arw;
      }
    });
  }

  function applyMove(from) {
    const e = S.empty;
    if (from === e || from < 0 || from > 15) return false;
    const er = e >> 2, ec = e & 3;
    const fr = from >> 2, fc = from & 3;
    if (Math.abs(fr - er) + Math.abs(fc - ec) !== 1) return false;
    const v = S.board[from];
    S.board[e] = v;
    S.board[from] = 0;
    S.empty = from;
    placeTile(v, e);
    placeEmpty(from);
    S.moves++;
    paintStats();
    updateMovable();
    return true;
  }

  function manualMove(from) {
    if (S.state !== 'play' || S.auto || S.busy || S.won) return;
    if (!applyMove(from)) return;
    if (isSolvedArr(S.board)) scheduleWin();
  }

  function paintStats() {
    if (S.els.moves) S.els.moves.textContent = String(S.moves);
    if (S.els.time) S.els.time.textContent = fmtTime(S.elapsedMs);
    if (S.els.best) {
      const p = S.progress[S.lv.key];
      S.els.best.innerHTML = p && p.stars
        ? `<span class="hrd-star-on">${'★'.repeat(p.stars)}</span>${'☆'.repeat(3 - p.stars)}`
        : '— — —';
    }
  }

  function fmtTime(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  function startTimer() {
    stopTimer(true);
    S.startedAt = Date.now() - S.elapsedMs;
    S.timerId = setInterval(() => {
      S.elapsedMs = Date.now() - S.startedAt;
      if (S.els.time) S.els.time.textContent = fmtTime(S.elapsedMs);
    }, 500);
  }

  function stopTimer(keep) {
    if (S.timerId) { clearInterval(S.timerId); S.timerId = null; }
    if (!keep && S.startedAt) {
      S.elapsedMs = Date.now() - S.startedAt;
      S.startedAt = 0;
    }
    if (S.els.time) S.els.time.textContent = fmtTime(S.elapsedMs);
  }

  /* ---------- 关卡流转 ---------- */
  function startLevel(i) {
    stopAuto();
    clearTimeout(S.winTimer);
    S.cur = i;
    S.lv = S.levels[i];
    S.board = makeBoard();
    S.initial = S.board.slice();
    S.empty = S.board.indexOf(0);
    S.moves = 0;
    S.hints = 0;
    S.autoUsed = false;
    S.won = false;
    S.elapsedMs = 0;
    S.busy = false;
    S.hintLock = false;
    setState('play', true);
    startTimer();
  }

  function restart() {
    if (S.state !== 'play') return;
    stopAuto();
    clearTimeout(S.winTimer);
    clearWin();
    S.board = S.initial.slice();
    S.empty = S.board.indexOf(0);
    S.moves = 0;
    S.hints = 0;
    S.autoUsed = false;
    S.won = false;
    S.elapsedMs = 0;
    S.state = 'play';
    container.dataset.state = 'play';
    for (let i = 0; i < S.board.length; i++) {
      const v = S.board[i];
      if (v) placeTile(v, i);
    }
    placeEmpty(S.empty);
    updateMovable();
    paintStats();
    lockButtons(false);
    startTimer();
    toast('已回到开局局面');
  }

  /* ---------- 提示 ---------- */
  function doHint() {
    if (S.state !== 'play' || S.auto || S.busy || S.won || S.hintLock) return;
    if (isSolvedArr(S.board)) return;
    const btn = S.els.hint;
    S.hintLock = true;
    S.busy = true;
    btn.disabled = true;
    btn.textContent = '推演中…';
    setTimeout(() => {
      const sol = solveBoard(S.board, S.empty, HINT_BUDGET);
      btn.textContent = '提示';
      btn.disabled = false;
      S.busy = false;
      setTimeout(() => { S.hintLock = false; }, 700);
      if (!sol || !sol.length) { toast('这一局推演较慢，稍后再试'); return; }
      const from = sol[0];
      const v = S.board[from];
      S.hints++;
      const t = S.tileEls[v];
      if (t) {
        t.classList.add('hrd-hinted');
        setTimeout(() => t.classList.remove('hrd-hinted'), 2400);
      }
      if (S.els.sr) S.els.sr.textContent = `提示：移动第 ${v} 片`;
      toast(`试试第 ${v} 片`);
    }, 30);
  }

  /* ---------- 自动完成 ---------- */
  function toggleAuto() {
    if (S.state !== 'play' || S.won || S.busy) return;
    if (S.auto) { stopAuto(); toast('已暂停'); return; }
    if (isSolvedArr(S.board)) return;
    const btn = S.els.auto;
    S.busy = true;
    btn.disabled = true;
    btn.textContent = '推演中…';
    setTimeout(() => {
      const sol = solveBoard(S.board, S.empty, SOLVE_BUDGET);
      btn.disabled = false;
      S.busy = false;
      if (!sol || !sol.length) { btn.textContent = '自动完成'; toast('这一局推演较慢，稍后再试'); return; }
      S.autoUsed = true;
      S.auto = true;
      S.autoSol = sol;
      S.autoIdx = 0;
      btn.textContent = '暂停';
      btn.classList.add('hrd-btn-on');
      lockButtons(true);
      autoStep();
    }, 30);
  }

  function autoStep() {
    if (!S.auto) return;
    if (S.autoIdx >= S.autoSol.length || isSolvedArr(S.board)) { finishAuto(); return; }
    const from = S.autoSol[S.autoIdx++];
    if (!applyMove(from)) { stopAuto(); toast('推演中断'); return; }
    if (isSolvedArr(S.board)) { finishAuto(); return; }
    S.autoId = setTimeout(autoStep, AUTO_MS);
  }

  function finishAuto() {
    stopAuto();
    if (isSolvedArr(S.board)) scheduleWin();
  }

  function stopAuto() {
    if (S.autoId) { clearTimeout(S.autoId); S.autoId = null; }
    S.auto = false;
    S.autoSol = null;
    if (S.els.auto) {
      S.els.auto.textContent = '自动完成';
      S.els.auto.classList.remove('hrd-btn-on');
    }
    lockButtons(false);
  }

  function lockButtons(lock) {
    if (S.els.hint) S.els.hint.disabled = lock;
    if (S.els.restart) S.els.restart.disabled = lock;
  }

  /* ---------- 通关 ---------- */
  function scheduleWin() {
    if (S.won) return;
    clearTimeout(S.winTimer);
    S.winTimer = setTimeout(showWin, 280);
  }

  function starRating() {
    let s = S.moves <= 100 ? 3 : S.moves <= 180 ? 2 : 1;
    if (S.hints > 0) s = Math.max(1, s - 1);
    if (S.autoUsed) s = 1;
    return s;
  }

  function showWin() {
    if (S.state !== 'play' || S.won) return;
    S.won = true;
    stopAuto();
    stopTimer();
    S.state = 'win';
    container.dataset.state = 'win';

    const lv = S.lv;
    const stars = starRating();
    const prev = S.progress[lv.key];
    const best = Math.max(prev && prev.stars ? prev.stars : 0, stars);
    const bestMoves = prev && prev.moves ? Math.min(prev.moves, S.moves) : S.moves;
    S.progress[lv.key] = { stars: best, moves: bestMoves, time: S.elapsedMs };
    saveProgress(S.progress);

    const hasNext = S.levels.length > 1;
    const ov = el(`
      <div class="hrd-win" role="dialog" aria-modal="true" aria-label="通关">
        <div class="hrd-win-card">
          <span class="tape" style="top:-13px; left:8%; transform:rotate(-5deg);"></span>
          <div class="hrd-win-img"><img src="${lv.image}" alt=""></div>
          <div class="hrd-win-body">
            <div class="hrd-win-head">
              <span class="stamp">通关</span>
              <div>
                <h3>${lv.name}</h3>
                ${lv.sub ? `<p class="hrd-win-sub">${lv.sub}</p>` : ''}
              </div>
            </div>
            ${lv.artifact ? `<p class="hrd-win-art mono">宝物 · ${lv.artifact}</p>` : ''}
            <div class="hrd-win-stats mono">
              <span>步数 <b>${S.moves}</b></span>
              <span>用时 <b>${fmtTime(S.elapsedMs)}</b></span>
              <span class="hrd-star-on">${'★'.repeat(stars)}</span><span>${'☆'.repeat(3 - stars)}</span>
            </div>
            ${lv.winText ? `<p class="hrd-win-text">${lv.winText}</p>` : ''}
            <div class="hrd-win-btns">
              ${hasNext ? '<button type="button" class="btn primary" data-act="next">下一关</button>' : ''}
              <button type="button" class="btn" data-act="again">再玩一次</button>
              <button type="button" class="btn ghost" data-act="levels">返回选关</button>
            </div>
          </div>
        </div>
      </div>`);

    root.appendChild(ov);
    S.els.win = ov;
    if (S.els.sr) S.els.sr.textContent = `通关，用 ${S.moves} 步，获得 ${stars} 星`;
    confetti();

    ov.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const a = b.dataset.act;
      clearWin();
      if (a === 'next') startLevel((S.cur + 1) % S.levels.length);
      else if (a === 'again') restart();
      else { S.state = 'levels'; container.dataset.state = 'levels'; render(true); }
    });
    const first = $('.hrd-win-btns .btn', ov);
    if (first) { try { first.focus({ preventScroll: true }); } catch { /* 忽略 */ } }
  }

  function clearWin() {
    if (S.els.win) { S.els.win.remove(); S.els.win = null; }
  }

  /* ---------- AI 配图（imagePrompt 生效入口） ---------- */
  async function genImage() {
    const lv = S.lv;
    if (!lv || !lv.imagePrompt || lv.__genBusy) return;
    lv.__genBusy = true;
    const btn = S.els.play ? S.els.play.querySelector('[data-act="gen"]') : null;
    if (btn) { btn.disabled = true; btn.textContent = '生成中…'; }
    toast('正在生成配图…');
    try {
      const r = await fetch('api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: lv.imagePrompt }),
      });
      const j = await r.json().catch(() => ({}));
      if (!j.taskId) throw new Error(j.error || '任务创建失败');
      for (let k = 0; k < 40; k++) {
        await sleep(1500);
        const t = await fetch(`api/task/${j.taskId}`).then((x) => x.json()).catch(() => ({}));
        const st = t.output && t.output.task_status;
        if (st === 'SUCCEEDED') {
          const url = t.output.results && t.output.results[0] && t.output.results[0].url;
          if (!url) throw new Error('无结果');
          lv.image = url;
          lv.fromFallback = false;
          Object.keys(S.tileEls).forEach((v) => {
            const face = S.tileEls[v].querySelector('.hrd-tile-face');
            if (face) face.style.backgroundImage = `url("${url}")`;
          });
          if (btn) { btn.textContent = '已生成'; }
          toast('配图已生成并贴上拼图盘');
          return;
        }
        if (st === 'FAILED' || st === 'CANCELED') throw new Error('生成失败');
      }
      throw new Error('超时');
    } catch (e) {
      toast(`配图未成功（${e && e.message ? e.message : '未知'}），仍用旧图`);
      if (btn) { btn.disabled = false; btn.textContent = '生成配图'; }
    } finally {
      lv.__genBusy = false;
    }
  }

  /* ---------- 纸屑 ---------- */
  function confetti() {
    if (reduceMotion()) return;
    const colors = tokenColors();
    for (let i = 0; i < 30; i++) {
      ((i) => {
        setTimeout(() => {
          const p = document.createElement('span');
          p.className = 'hrd-confetti';
          p.style.left = `${Math.random() * 100}vw`;
          p.style.background = colors[(Math.random() * colors.length) | 0];
          p.style.width = `${5 + Math.random() * 7}px`;
          p.style.height = `${7 + Math.random() * 9}px`;
          p.style.animationDuration = `${1.8 + Math.random() * 1.6}s`;
          document.body.appendChild(p);
          setTimeout(() => p.remove(), 4200);
        }, i * 70);
      })(i);
    }
  }

  /* ---------- 轻提示 ---------- */
  let toastEl = null;
  let toastTimer = null;
  function toast(msg) {
    if (toastEl) { toastEl.remove(); toastEl = null; }
    clearTimeout(toastTimer);
    toastEl = el(`<div class="hrd-toast" role="status">${msg}</div>`);
    root.appendChild(toastEl);
    toastTimer = setTimeout(() => { if (toastEl) { toastEl.remove(); toastEl = null; } }, 2400);
  }

  /* ---------- 键盘 ---------- */
  function onKey(e) {
    if (S.state !== 'play' || S.auto || S.busy || S.won) return;
    if (!container.offsetParent) return; // 面板不可见时不接管
    const map = { ArrowUp: [1, 0], ArrowDown: [-1, 0], ArrowLeft: [0, 1], ArrowRight: [0, -1] };
    const d = map[e.key];
    if (!d) return;
    const er = S.empty >> 2, ec = S.empty & 3;
    const tr = er + d[0], tc = ec + d[1];
    if (tr < 0 || tr > 3 || tc < 0 || tc > 3) return;
    e.preventDefault();
    manualMove(tr * 4 + tc);
  }
  window.addEventListener('keydown', onKey);

  /* ---------- 启动 ---------- */
  setState('menu', false);
  resolveImages(S.levels).then((changed) => {
    if (changed && S.state !== 'play') render(false);
    else if (changed) {
      Object.keys(S.tileEls).forEach((v) => {
        const face = S.tileEls[v].querySelector('.hrd-tile-face');
        if (face) face.style.backgroundImage = `url("${S.lv.image}")`;
      });
    }
  });
}
