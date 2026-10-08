/* ============================================================
   05 · 空间皮肤 — 把非遗住进去
   形态：预览 = 贴在手账上的建筑图纸（纸片剪贴客房立面，纯 CSS/SVG 拼贴）
        侧栏 = 皮肤选择 + 场景文案（全部取自 points / gene 数据）
   数据：data = points.json（文案）· window.__GENE_DATA__ = gene.json（色板）
   导出：export function initSpace(container, data)   // #spaceShell
   ============================================================ */

/* ---------------- 小工具 ---------------- */
const esc = (s) =>
  String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

const reduced = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/* 最长公共子串长度（皮肤名 → 点位名 匹配用） */
function lcsLen(a, b) {
  const n = a.length;
  const m = b.length;
  if (!n || !m) return 0;
  let prev = new Array(m + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= n; i++) {
    const cur = new Array(m + 1).fill(0);
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) best = cur[j];
      }
    }
    prev = cur;
  }
  return best;
}

/* ---------------- 点位整形（坏数据直接剔除） ---------------- */
function normPoints(data) {
  const raw = Array.isArray(data) ? data : data && Array.isArray(data.points) ? data.points : [];
  const out = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;
    const name = typeof p.name === 'string' ? p.name.trim() : '';
    if (!name) continue;
    out.push({
      name,
      category: typeof p.category === 'string' ? p.category : '',
      hook: typeof p.hook === 'string' ? p.hook : '',
      description: typeof p.description === 'string' ? p.description : '',
      playTip: typeof p.playTip === 'string' ? p.playTip : '',
    });
  }
  return out;
}

/* ---------------- 皮肤来源 ---------------- */
/* 优先：gene.json 的 5 套 palette；缺失时回退 4 套由点位名派生的默认皮肤 */
const FALLBACK_SKINS = [
  { kw: '三星村', fallbackPalette: ['var(--clay)', 'var(--riso-red)', 'var(--paper-deep)', 'var(--ink-soft)', 'var(--paper-card)'] },
  { kw: '刻纸', fallbackPalette: ['var(--riso-red)', 'var(--ink)', 'var(--paper-deep)', 'var(--ink-soft)', 'var(--paper-card)'] },
  { kw: '长荡湖', fallbackPalette: ['var(--lake)', 'var(--riso-cyan)', 'var(--paper-deep)', 'var(--ink-soft)', 'var(--paper-card)'] },
  { kw: '茅山', fallbackPalette: ['var(--bamboo)', 'var(--riso-pink)', 'var(--paper-deep)', 'var(--ink-soft)', 'var(--paper-card)'] },
];

function padPalette(pal, fill) {
  const base = Array.isArray(pal) ? pal.filter((c) => typeof c === 'string' && c.trim()) : [];
  const out = base.slice(0, 5);
  const fb = fill || ['var(--clay)', 'var(--riso-red)', 'var(--paper-deep)', 'var(--ink-soft)', 'var(--paper-card)'];
  while (out.length < 5) out.push(fb[out.length]);
  return out;
}

function geneSkins() {
  let genes = null;
  try {
    const g = window.__GENE_DATA__;
    genes = g && Array.isArray(g.genes) ? g.genes : null;
  } catch {
    genes = null;
  }
  if (!genes) return [];
  const out = [];
  for (let i = 0; i < genes.length && out.length < 5; i++) {
    const g = genes[i];
    if (!g || typeof g.name !== 'string' || !g.name.trim()) continue;
    if (!Array.isArray(g.palette) || !g.palette.some((c) => typeof c === 'string' && c.trim())) continue;
    out.push({
      id: String(g.id || 'skin-' + (i + 1)),
      base: g.name.trim(),
      story: typeof g.story === 'string' ? g.story : '',
      palette: padPalette(g.palette),
      fromGene: true,
    });
  }
  return out;
}

function fallbackSkins(points) {
  const out = [];
  for (const f of FALLBACK_SKINS) {
    const pt = points.find((p) => p.name.includes(f.kw));
    if (!pt) continue;
    out.push({
      id: 'fallback-' + f.kw,
      base: pt.name,
      story: '',
      palette: padPalette(f.fallbackPalette),
      fromGene: false,
    });
  }
  return out;
}

/* ---------------- 场景文案匹配（禁编造：只取 points 原文） ---------------- */
function matchPoint(base, points) {
  if (!base || !points.length) return null;
  const direct = points.find((p) => base.includes(p.name) || p.name.includes(base));
  if (direct) return direct;
  let best = null;
  let bestN = 1;
  for (const p of points) {
    const n = lcsLen(base, p.name);
    if (n > bestN) {
      bestN = n;
      best = p;
    }
  }
  return best;
}

/* 合作场景：优先「盐湖城」，其次「茅山」（住进去的落点） */
function coopPoint(points) {
  return (
    points.find((p) => p.name.includes('盐湖城')) ||
    points.find((p) => p.name.includes('茅山')) ||
    null
  );
}

/* ============================================================
   客房立面 SVG（纸片剪贴，全部走 CSS 变量换色）
   ============================================================ */
function sceneSVG() {
  return `
<svg class="sp-svg" viewBox="0 0 480 384" role="img" aria-label="客房立面拼贴示意图：窗、落地灯、挂画、床与地毯，附尺寸标注">
  <g class="sp-scene">
    <!-- 墙面 / 踢脚线 / 地面 -->
    <rect class="sp-wall" x="70" y="48" width="360" height="248"/>
    <rect class="sp-floor" x="70" y="296" width="360" height="40"/>
    <line class="sp-board" x1="130" y1="296" x2="130" y2="336"/>
    <line class="sp-board" x1="190" y1="296" x2="190" y2="336"/>
    <line class="sp-board" x1="250" y1="296" x2="250" y2="336"/>
    <line class="sp-board" x1="310" y1="296" x2="310" y2="336"/>
    <line class="sp-board" x1="370" y1="296" x2="370" y2="336"/>
    <rect class="sp-base" x="70" y="282" width="360" height="14"/>
    <line class="sp-rule" x1="70" y1="296" x2="430" y2="296"/>
    <!-- 房间轮廓（图纸的主角必须先立住） -->
    <rect class="sp-room" x="70" y="48" width="360" height="288"/>

    <!-- 窗 -->
    <g class="sp-hard">
      <rect class="sp-glass" x="96" y="86" width="104" height="112"/>
      <path class="sp-hill" d="M96 172 L128 140 L158 168 L198 142 L198 198 L96 198 Z"/>
      <circle class="sp-sun" cx="176" cy="112" r="13"/>
      <rect class="sp-frame" x="96" y="86" width="104" height="112"/>
      <line class="sp-rule" x1="148" y1="86" x2="148" y2="198"/>
      <line class="sp-rule" x1="96" y1="142" x2="200" y2="142"/>
      <rect class="sp-curtain" x="86" y="76" width="22" height="132"/>
      <rect class="sp-curtain" x="188" y="76" width="22" height="132"/>
    </g>

    <!-- 落地灯 -->
    <g class="sp-lamp">
      <rect class="sp-ink-fill" x="224" y="194" width="4" height="102"/>
      <rect class="sp-ink-fill" x="210" y="290" width="32" height="9"/>
      <polygon class="sp-shade sp-hard" points="200,150 252,150 242,194 210,194"/>
    </g>

    <!-- 挂画 -->
    <g class="sp-hard">
      <rect class="sp-art-bg" x="286" y="84" width="96" height="76"/>
      <path class="sp-art-zig" d="M294 140 L312 116 L330 140 L348 116 L366 140 L374 130 L374 152 L294 152 Z"/>
      <circle class="sp-art-sun" cx="312" cy="106" r="10"/>
      <rect class="sp-art-base" x="294" y="92" width="72" height="6"/>
      <rect class="sp-frame" x="286" y="84" width="96" height="76"/>
    </g>

    <!-- 床 -->
    <g class="sp-hard">
      <rect class="sp-head" x="246" y="226" width="22" height="70"/>
      <rect class="sp-pillow" x="274" y="222" width="54" height="20"/>
      <rect class="sp-mattress" x="266" y="242" width="150" height="32"/>
      <rect class="sp-blanket" x="266" y="248" width="92" height="26"/>
      <rect class="sp-blanket-2" x="266" y="248" width="92" height="7"/>
      <rect class="sp-ink-fill" x="272" y="274" width="10" height="22"/>
      <rect class="sp-ink-fill" x="396" y="274" width="10" height="22"/>
    </g>

    <!-- 盆栽 -->
    <g>
      <path class="sp-leaf" d="M168 246 L176 272 L160 272 Z"/>
      <path class="sp-leaf" d="M150 254 L166 274 L148 278 Z"/>
      <path class="sp-leaf" d="M186 254 L172 276 L190 278 Z"/>
      <polygon class="sp-pot" points="150,270 186,270 180,296 156,296"/>
    </g>

    <!-- 地毯 -->
    <g>
      <polygon class="sp-rug" points="126,300 342,300 366,330 102,330"/>
      <polygon class="sp-rug-in" points="152,306 316,306 336,324 132,324"/>
      <polygon class="sp-rug-mid" points="196,311 272,311 284,321 184,321"/>
    </g>

    <!-- 标注引线 -->
    <g class="sp-callout">
      <line class="sp-leader" x1="334" y1="84" x2="334" y2="68"/>
      <text class="sp-call" x="334" y="62" text-anchor="middle">挂画</text>
      <line class="sp-leader" x1="254" y1="170" x2="288" y2="170"/>
      <text class="sp-call" x="292" y="174" text-anchor="start">落地灯</text>
      <line class="sp-leader" x1="350" y1="240" x2="350" y2="208"/>
      <text class="sp-call" x="350" y="202" text-anchor="middle">床 1800</text>
      <line class="sp-leader" x1="126" y1="314" x2="104" y2="314"/>
      <text class="sp-call" x="100" y="318" text-anchor="end">地毯</text>
      <text class="sp-call" x="148" y="216" text-anchor="middle">窗 1200</text>
    </g>

    <!-- 尺寸标注（mono） -->
    <g class="sp-dim">
      <line x1="52" y1="48" x2="52" y2="296"/>
      <line x1="46" y1="48" x2="58" y2="48"/>
      <line x1="46" y1="296" x2="58" y2="296"/>
      <text class="sp-dim-t" x="44" y="172" text-anchor="middle" transform="rotate(-90 44 172)">2800</text>
      <line x1="70" y1="356" x2="430" y2="356"/>
      <line x1="70" y1="350" x2="70" y2="362"/>
      <line x1="430" y1="350" x2="430" y2="362"/>
      <text class="sp-dim-t" x="250" y="348" text-anchor="middle">3600</text>
    </g>
  </g>
  <rect class="sp-ghost" x="70" y="48" width="360" height="248"/>
</svg>`;
}

/* ============================================================
   模块入口
   ============================================================ */
export function initSpace(container, data) {
  if (!container) return;

  /* 幂等：重复调用先拆旧实例 */
  if (typeof container.__spaceOff === 'function') {
    try {
      container.__spaceOff();
    } catch {
      /* 旧实例拆卸失败不阻塞新实例 */
    }
  }

  const preview = container.querySelector('#spacePreview') || container.querySelector('.space-preview');
  const side = container.querySelector('#spaceSide') || container.querySelector('.space-side');
  if (!preview || !side) {
    container.dataset.module = 'space';
    container.dataset.status = 'broken';
    return;
  }

  const points = normPoints(data);
  let skins = geneSkins();
  if (!skins.length) skins = fallbackSkins(points);
  const coop = coopPoint(points);

  const EMPTY_SKIN = { id: 'none', base: '客房', story: '', palette: padPalette([]) };

  const st = {
    dead: false,
    busy: false,
    idx: 0,
    timers: new Set(),
    els: { preview, side, status: null },
  };

  /* ---------------- 计时（可随卸载全部清掉） ---------------- */
  const sleep = (ms) =>
    new Promise((resolve) => {
      const id = window.setTimeout(() => {
        st.timers.delete(id);
        resolve();
      }, ms);
      st.timers.add(id);
    });

  const cur = () =>
    skins.length
      ? skins[Math.min(Math.max(st.idx, 0), skins.length - 1)]
      : EMPTY_SKIN;

  /* ---------------- 侧栏文案 ---------------- */
  function copyHTML(skin) {
    const pt = matchPoint(skin.base, points);
    const coopShow = coop && (!pt || coop.name !== pt.name) ? coop : null;
    const label = pt ? (coop && pt.name === coop.name ? '合作场景 · CO-OP' : '场景原型 · POINT') : '';

    let body = '';
    if (skin.story) {
      body += `
      <div class="sp-story">
        <span class="kicker">皮肤故事 · SKIN STORY</span>
        <p>${esc(skin.story)}</p>
      </div>`;
    }
    if (pt) {
      body += `
      <div class="sp-copy">
        <span class="kicker">${label}</span>
        <h4 class="sp-pt-name">${esc(pt.name)}</h4>
        ${pt.hook ? `<blockquote class="sp-hook">${esc(pt.hook)}</blockquote>` : ''}
        ${pt.description ? `<p class="sp-desc">${esc(pt.description)}</p>` : ''}
      </div>`;
    } else {
      body += `<div class="sp-copy sp-copy-empty"><span class="kicker">场景文案 · COPY</span><p class="mono">场景文案印制中…</p></div>`;
    }
    if (coopShow) {
      body += `
      <div class="sp-coop">
        <span class="kicker">落地合作场景 · STAY</span>
        <h4 class="sp-pt-name">${esc(coopShow.name)}</h4>
        ${coopShow.hook ? `<blockquote class="sp-hook">${esc(coopShow.hook)}</blockquote>` : ''}
      </div>`;
    }
    return body;
  }

  function headHTML(skin, i) {
    const sw = skin.palette
      .map((c, n) => `<i class="sp-sw" style="background:${esc(c)}" title="色 ${n + 1}"></i>`)
      .join('');
    const total = skins.length;
    const no = total ? `${String(Math.min(i, total - 1) + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}` : '— / —';
    return `
      <span class="kicker">${total ? `ROOM SKIN — ${total} 套皮肤 · 一间客房` : 'ROOM SKIN — 皮肤印制中'}</span>
      <h3 class="sp-name">${esc(skin.base)}<em> · 客房</em></h3>
      <div class="sp-meta mono">
        <span>SKIN ${no}</span>
        <span class="sp-swatches">${sw}</span>
      </div>`;
  }

  function picksHTML(active) {
    if (skins.length < 2) return '';
    const chips = skins
      .map((s, i) => {
        const dots = s.palette
          .slice(0, 3)
          .map((c) => `<i class="sp-chip-dot" style="background:${esc(c)}"></i>`)
          .join('');
        return `<button type="button" class="sp-chip${i === active ? ' active' : ''}" data-skin="${i}" aria-pressed="${i === active}">${dots}<span>${esc(s.base)}</span></button>`;
      })
      .join('');
    return `<div class="sp-picks"><span class="kicker">换一间 · SWITCH SKIN</span><div class="sp-chips">${chips}</div></div>`;
  }

  function buildSideShell() {
    side.innerHTML =
      `<div class="sp-head"></div>` +
      `<div class="sp-body"></div>` +
      `<div class="sp-act">` +
      `<button type="button" class="btn primary" data-act="gen">生成这间房</button>` +
      `<p class="sp-status mono" role="status" aria-live="polite"></p>` +
      `</div>`;
    st.els.status = side.querySelector('.sp-status');
  }

  function renderSide() {
    const skin = cur();
    if (!side.querySelector('.sp-head')) buildSideShell();
    const head = side.querySelector('.sp-head');
    const body = side.querySelector('.sp-body');
    const act = side.querySelector('.sp-act');
    st.els.status = side.querySelector('.sp-status');

    const oldPicks = side.querySelector('.sp-picks');
    if (oldPicks) oldPicks.remove();

    head.innerHTML = headHTML(skin, st.idx);
    body.innerHTML = copyHTML(skin);
    if (skins.length >= 2) body.insertAdjacentHTML('beforebegin', picksHTML(st.idx));
    if (act) act.hidden = !skins.length;
  }

  function setStatus(msg, isErr) {
    const el = st.els.status || (st.els.status = side.querySelector('.sp-status'));
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('err', !!isErr);
  }

  /* ---------------- 预览：图纸 + 换肤 ---------------- */
  function buildPreview() {
    preview.innerHTML = `
      <p class="sp-cap kicker">ROOM ELEVATION — 纸片拼贴 · 标注单位 mm</p>
      <div class="sp-stage">
        <figure class="sp-sheet">
          <span class="tape" style="top:-12px; left:9%; transform:rotate(-4deg);"></span>
          <span class="tape" style="bottom:-11px; right:13%; transform:rotate(3deg);"></span>
          <div class="sp-draw">${sceneSVG()}</div>
          <figcaption class="sp-title mono">
            <span>立面 ELEVATION A</span>
            <span>比例 1:50</span>
            <span class="sp-title-name"></span>
          </figcaption>
        </figure>
        <figure class="sp-print" hidden></figure>
      </div>`;
  }

  function paintVars(skin) {
    /* 变量挂在壳上，预览与侧栏共用同一套皮肤色 */
    const root = container;
    skin.palette.forEach((c, i) => {
      root.style.setProperty(`--sk${i + 1}`, c);
    });
    const t = preview.querySelector('.sp-title-name');
    if (t) t.textContent = `${skin.base}客房`;
    const svg = preview.querySelector('.sp-svg');
    if (svg) svg.setAttribute('aria-label', `${skin.base}客房立面拼贴示意图：窗、落地灯、挂画、床与地毯，附尺寸标注`);
  }

  function risoSwap() {
    const svg = preview.querySelector('.sp-svg');
    if (!svg || reduced()) return;
    svg.classList.remove('is-swap');
    /* 强制回流，保证连续点选时动画能重播 */
    void svg.getBoundingClientRect();
    svg.classList.add('is-swap');
    const id = window.setTimeout(() => {
      st.timers.delete(id);
      svg.classList.remove('is-swap');
    }, 520);
    st.timers.add(id);
  }

  function selectSkin(i, opts) {
    if (!skins.length) return;
    const next = Math.min(Math.max(Number(i) || 0, 0), skins.length - 1);
    const changed = next !== st.idx;
    st.idx = next;
    const skin = cur();
    paintVars(skin);
    renderSide();
    if (changed && !(opts && opts.silent)) risoSwap();
    container.dataset.skin = skin.id;
  }

  /* ---------------- 生成这间房：文生图 → 轮询 → 贴图 ---------------- */
  function buildPrompt(skin) {
    return `${skin.base}客房，水墨纸质感，纸片剪贴插画，米黄纸底，Lo-Fi 手账拼贴，室内立面构图，窗床灯画毯家具陈设，素雅留白，无文字`;
  }

  async function pollTask(taskId) {
    for (let i = 0; i < 40; i++) {
      if (st.dead) throw new Error('已中止');
      await sleep(1500);
      if (st.dead) throw new Error('已中止');
      let j = null;
      try {
        const r = await fetch('api/task/' + encodeURIComponent(taskId));
        if (!r.ok) throw new Error('任务查询 ' + r.status);
        j = await r.json();
      } catch {
        if (st.dead) throw new Error('已中止');
        continue; /* 瞬时失败：继续轮询，超时兜底 */
      }
      const out = (j && j.output) || {};
      const s = out.task_status || j.task_status || '';
      if (s === 'SUCCEEDED') {
        const url = out.results && out.results[0] && out.results[0].url;
        if (url) return url;
        throw new Error('任务完成但未返回图片');
      }
      if (s === 'FAILED' || s === 'CANCELED' || s === 'UNKNOWN') {
        throw new Error('任务状态 ' + s);
      }
      if (i > 0 && i % 4 === 0) setStatus(`仍在排版… 约 ${i * 1.5 | 0} 秒`, false);
    }
    throw new Error('超时未出图');
  }

  async function generate(btn) {
    if (st.busy || st.dead || !skins.length) return;
    st.busy = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = '生成中…';
    }
    const skin = cur();
    setStatus('已提交文生图 · 出图约十几秒…', false);
    try {
      const r = await fetch('api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: buildPrompt(skin) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.taskId) throw new Error(j.error || `提交失败 ${r.status}`);
      const url = await pollTask(j.taskId);
      if (st.dead) return;
      const print = preview.querySelector('.sp-print');
      if (print) {
        print.hidden = false;
        print.innerHTML = `
          <span class="tape" style="top:-11px; right:16%; transform:rotate(-3deg);"></span>
          <img src="${esc(url)}" alt="${esc(skin.base)}客房的 AI 生成图" loading="lazy">
          <figcaption class="mono">AI 出图 · ${esc(skin.base)}客房</figcaption>`;
      }
      setStatus('成图已贴到图纸旁', false);
    } catch (e) {
      if (st.dead) return;
      const msg = e && e.message ? e.message : String(e);
      setStatus(`生图未成功（${msg}），可稍后再试`, true);
    } finally {
      st.busy = false;
      if (btn && btn.isConnected) {
        btn.disabled = false;
        btn.textContent = '生成这间房';
      }
    }
  }

  /* ---------------- 事件（委托，重渲染不丢） ---------------- */
  function onClick(e) {
    const chip = e.target.closest('[data-skin]');
    if (chip) {
      selectSkin(Number(chip.dataset.skin));
      return;
    }
    const gen = e.target.closest('[data-act="gen"]');
    if (gen) generate(gen);
  }

  /* ---------------- 启动 ---------------- */
  container.dataset.module = 'space';
  buildPreview();
  buildSideShell();
  container.addEventListener('click', onClick);

  if (skins.length) {
    selectSkin(0, { silent: true });
    container.dataset.status = 'ready';
  } else {
    /* 无皮肤数据：图纸保留，侧栏给空态，按钮停用 */
    paintVars(EMPTY_SKIN);
    renderSide();
    container.dataset.status = 'empty';
  }

  container.__spaceOff = function () {
    st.dead = true;
    st.timers.forEach((id) => window.clearTimeout(id));
    st.timers.clear();
    container.removeEventListener('click', onClick);
    preview.innerHTML = '';
    side.innerHTML = '';
    ['--sk1', '--sk2', '--sk3', '--sk4', '--sk5'].forEach((k) => container.style.removeProperty(k));
    container.dataset.status = '';
    delete container.dataset.skin;
    delete container.__spaceOff;
  };
}
