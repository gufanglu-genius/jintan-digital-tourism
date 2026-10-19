/* ============================================================
   05 · 空间涂装台 — 把非遗住进去（亲手刷）
   形态：预览 = 贴在手账上的建筑图纸（纸片剪贴客房立面，纯 CSS/SVG 拼贴）
        交互 = 纹样架选一块基因纹样（笔刷）→ 点房间构件上色：
               窗帘 / 挂画 / 灯罩 / 床旗 / 地毯 逐件可刷，也可一键铺满
        侧栏 = 纹样架 + 槽位清单 + 场景文案 + 生成这间房
   数据：data = points.json（文案）· window.__GENE_DATA__ = gene.json（纹样）
   导出：export function initSpace(container, data)   // #spaceShell
   ============================================================ */

/* ---------------- 小工具 ---------------- */
const esc = (s) =>
  String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

const HEX = (s) => (typeof s === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(s.trim()) ? s.trim() : null);

const reduced = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/* 最长公共子串长度（纹样名 → 点位名 匹配用） */
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

/* ---------------- 纹样来源：gene.json 的 5 套 palette ---------------- */
const FALLBACK_SKINS = [
  { kw: '三星村', fallbackPalette: ['#C15C3A', '#8A3E28', '#E3B98F', '#6B4A38', '#D9CBA8'] },
  { kw: '刻纸', fallbackPalette: ['#D8352A', '#B31E1E', '#F6EEDD', '#E8B03C', '#4A3A2E'] },
  { kw: '长荡湖', fallbackPalette: ['#2C6E7F', '#79B7AE', '#1B4B57', '#CBE6DF', '#E2C489'] },
  { kw: '茅山', fallbackPalette: ['#EBC85C', '#C33127', '#1E2831', '#B08437', '#F5EAD2'] },
];

const DEFAULT_FB = ['#C15C3A', '#8A3E28', '#E3B98F', '#6B4A38', '#D9CBA8'];

function padPalette(pal) {
  const base = Array.isArray(pal) ? pal.map(HEX).filter(Boolean) : [];
  const out = base.slice(0, 5);
  for (let i = out.length; i < 5; i++) out.push(DEFAULT_FB[i]);
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
    if (!Array.isArray(g.palette) || !g.palette.some((c) => HEX(c))) continue;
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

function coopPoint(points) {
  return (
    points.find((p) => p.name.includes('盐湖城')) ||
    points.find((p) => p.name.includes('茅山')) ||
    null
  );
}

/* ---------------- 可刷槽位（名称取自图纸标注，真实构件） ---------------- */
const SLOTS = [
  { key: 'curtain', label: '窗帘', hint: '窗 · 1200' },
  { key: 'art', label: '挂画', hint: '墙面' },
  { key: 'shade', label: '灯罩', hint: '落地灯' },
  { key: 'blanket', label: '床旗', hint: '床 · 1800' },
  { key: 'rug', label: '地毯', hint: '地面' },
];

/* ============================================================
   纹样 <pattern> 定义：由 palette 现生成（真实色值，非编造）
   五种母题对应五类金坛基因：陶纹折线 / 刻纸窗花 / 符箓雷文 / 水纹波线 / 龙鳞弧
   ============================================================ */
function motifSVG(i, pal) {
  const [c0, c1, c2, c3, c4] = pal;
  const S = 26; // tile
  switch (i % 5) {
    case 0: // 陶纹 · 锯齿+点
      return `<rect width="${S}" height="${S}" fill="${c3}"/>
        <path d="M0 18 L6.5 8 L13 18 L19.5 8 L26 18 L26 26 L0 26 Z" fill="${c0}" opacity="0.92"/>
        <path d="M0 13 L6.5 3 L13 13 L19.5 3 L26 13" stroke="${c1}" stroke-width="1.6" fill="none"/>
        <circle cx="6.5" cy="21.5" r="1.4" fill="${c4}"/><circle cx="19.5" cy="21.5" r="1.4" fill="${c4}"/>`;
    case 1: // 刻纸 · 窗花菱格
      return `<rect width="${S}" height="${S}" fill="${c2}"/>
        <path d="M13 1 L25 13 L13 25 L1 13 Z" fill="none" stroke="${c0}" stroke-width="1.8"/>
        <path d="M13 6 L20 13 L13 20 L6 13 Z" fill="${c1}" opacity="0.85"/>
        <circle cx="13" cy="13" r="1.7" fill="${c4}"/>
        <path d="M0 0 L4 0 L0 4 Z M26 0 L22 0 L26 4 Z M0 26 L4 26 L0 22 Z M26 26 L22 26 L26 22 Z" fill="${c3}"/>`;
    case 2: // 符箓 · 雷文方折
      return `<rect width="${S}" height="${S}" fill="${c4}"/>
        <path d="M6 3 L6 23 M6 3 L12 3 L12 8 L9 8 L9 13 L13 13" stroke="${c1}" stroke-width="1.9" fill="none"/>
        <path d="M17 5 L23 5 L23 23 M17 10 L21 10" stroke="${c2}" stroke-width="1.9" fill="none"/>
        <rect x="4.5" y="1.5" width="3" height="3" fill="${c0}"/>`;
    case 3: // 水纹 · 波线
      return `<rect width="${S}" height="${S}" fill="${c3}"/>
        <path d="M0 7 Q6.5 2 13 7 T26 7" stroke="${c0}" stroke-width="1.7" fill="none"/>
        <path d="M0 14 Q6.5 9 13 14 T26 14" stroke="${c1}" stroke-width="1.7" fill="none"/>
        <path d="M0 21 Q6.5 16 13 21 T26 21" stroke="${c2}" stroke-width="1.5" fill="none"/>`;
    default: // 龙鳞 · 弧叠
      return `<rect width="${S}" height="${S}" fill="${c3}"/>
        <path d="M0 18 A6.5 6.5 0 0 1 13 18 A6.5 6.5 0 0 1 26 18" stroke="${c0}" stroke-width="1.6" fill="none"/>
        <path d="M-6.5 10 A6.5 6.5 0 0 1 6.5 10 A6.5 6.5 0 0 1 19.5 10 A6.5 6.5 0 0 1 32.5 10" stroke="${c1}" stroke-width="1.6" fill="none"/>
        <path d="M0 25 A6.5 6.5 0 0 1 13 25 A6.5 6.5 0 0 1 26 25" stroke="${c2}" stroke-width="1.4" fill="none"/>`;
  }
}

function patternDef(i, skin) {
  const id = `sp-pat-${i}`;
  return `<pattern id="${id}" width="26" height="26" patternUnits="userSpaceOnUse">${motifSVG(i, skin.palette)}</pattern>`;
}

/* ============================================================
   客房立面 SVG（纸片剪贴；槽位组带透明热区可点选）
   ============================================================ */
function sceneSVG() {
  return `
<svg class="sp-svg" viewBox="0 0 480 384" role="img" aria-label="客房立面拼贴示意图：窗帘、挂画、灯罩、床旗、地毯均可点选上色">
  <defs class="sp-defs"></defs>
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
    <rect class="sp-room" x="70" y="48" width="360" height="288"/>

    <!-- 窗（窗帘 = 槽位） -->
    <g class="sp-hard">
      <rect class="sp-glass" x="96" y="86" width="104" height="112"/>
      <path class="sp-hill" d="M96 172 L128 140 L158 168 L198 142 L198 198 L96 198 Z"/>
      <circle class="sp-sun" cx="176" cy="112" r="13"/>
      <rect class="sp-frame" x="96" y="86" width="104" height="112"/>
      <line class="sp-rule" x1="148" y1="86" x2="148" y2="198"/>
      <line class="sp-rule" x1="96" y1="142" x2="200" y2="142"/>
    </g>
    <g class="sp-hot" data-slot="curtain">
      <rect class="sp-curtain" x="86" y="76" width="22" height="132"/>
      <rect class="sp-curtain" x="188" y="76" width="22" height="132"/>
      <rect class="sp-hit" x="82" y="72" width="132" height="140" rx="0"/>
    </g>

    <!-- 落地灯（灯罩 = 槽位） -->
    <g class="sp-lamp">
      <rect class="sp-ink-fill" x="224" y="194" width="4" height="102"/>
      <rect class="sp-ink-fill" x="210" y="290" width="32" height="9"/>
    </g>
    <g class="sp-hot" data-slot="shade">
      <polygon class="sp-shade sp-hard" points="200,150 252,150 242,194 210,194"/>
      <rect class="sp-hit" x="196" y="146" width="60" height="52"/>
    </g>

    <!-- 挂画（画心 = 槽位） -->
    <g class="sp-hot" data-slot="art">
      <rect class="sp-art-bg" x="286" y="84" width="96" height="76"/>
      <path class="sp-art-zig" d="M294 140 L312 116 L330 140 L348 116 L366 140 L374 130 L374 152 L294 152 Z"/>
      <circle class="sp-art-sun" cx="312" cy="106" r="10"/>
      <rect class="sp-art-base" x="294" y="92" width="72" height="6"/>
      <rect class="sp-frame" x="286" y="84" width="96" height="76"/>
      <rect class="sp-hit" x="282" y="80" width="104" height="84"/>
    </g>

    <!-- 床（床旗 = 槽位） -->
    <g class="sp-hard">
      <rect class="sp-head" x="246" y="226" width="22" height="70"/>
      <rect class="sp-pillow" x="274" y="222" width="54" height="20"/>
      <rect class="sp-mattress" x="266" y="242" width="150" height="32"/>
      <rect class="sp-ink-fill" x="272" y="274" width="10" height="22"/>
      <rect class="sp-ink-fill" x="396" y="274" width="10" height="22"/>
    </g>
    <g class="sp-hot" data-slot="blanket">
      <rect class="sp-blanket" x="266" y="248" width="92" height="26"/>
      <rect class="sp-blanket-2" x="266" y="248" width="92" height="7"/>
      <rect class="sp-hit" x="262" y="244" width="100" height="34"/>
    </g>

    <!-- 盆栽 -->
    <g>
      <path class="sp-leaf" d="M168 246 L176 272 L160 272 Z"/>
      <path class="sp-leaf" d="M150 254 L166 274 L148 278 Z"/>
      <path class="sp-leaf" d="M186 254 L172 276 L190 278 Z"/>
      <polygon class="sp-pot" points="150,270 186,270 180,296 156,296"/>
    </g>

    <!-- 地毯（毯面 = 槽位） -->
    <g class="sp-hot" data-slot="rug">
      <polygon class="sp-rug" points="126,300 342,300 366,330 102,330"/>
      <polygon class="sp-rug-in" points="152,306 316,306 336,324 132,324"/>
      <polygon class="sp-rug-mid" points="196,311 272,311 284,321 184,321"/>
      <rect class="sp-hit" x="98" y="296" width="272" height="38"/>
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
    idx: 0,            // 当前笔刷（纹样架选中项）
    selSlot: '',       // 当前选中的槽位 ''|curtain|art|shade|blanket|rug
    slots: {},         // 槽位 → 纹样下标（无 = 素色，保留原皮肤变量填色）
    timers: new Set(),
    sleeps: new Set(),
    printUrl: '',
    printSig: '',      // 出图对应的「笔刷+槽位」签名，换装后旧图不对版
    els: { preview, side, status: null },
  };

  /* ---------------- 计时（可随卸载全部清掉） ---------------- */
  const sleep = (ms) =>
    new Promise((resolve) => {
      const id = window.setTimeout(() => {
        st.timers.delete(id);
        st.sleeps.delete(resolve);
        resolve();
      }, ms);
      st.timers.add(id);
      st.sleeps.add(resolve);
    });

  const cur = () =>
    skins.length
      ? skins[Math.min(Math.max(st.idx, 0), skins.length - 1)]
      : EMPTY_SKIN;

  const skinAt = (i) =>
    skins.length ? skins[Math.min(Math.max(i, 0), skins.length - 1)] : EMPTY_SKIN;

  const arrSig = () =>
    JSON.stringify({ brush: cur().id, slots: st.slots });

  /* ---------------- 侧栏文案 ---------------- */
  function copyHTML(skin) {
    const pt = matchPoint(skin.base, points);
    const coopShow = coop && (!pt || coop.name !== pt.name) ? coop : null;
    const label = pt ? (coop && pt.name === coop.name ? '合作场景' : '场景原型') : '';

    let body = '';
    if (pt) {
      body += `
      <div class="sp-copy">
        <span class="kicker">${label}</span>
        <h4 class="sp-pt-name">${esc(pt.name)}</h4>
        ${pt.hook ? `<blockquote class="sp-hook">${esc(pt.hook)}</blockquote>` : ''}
        ${pt.description ? `<p class="sp-desc">${esc(pt.description)}</p>` : ''}
      </div>`;
    } else {
      body += `<div class="sp-copy sp-copy-empty"><span class="kicker">场景文案</span><p class="mono">场景文案印制中…</p></div>`;
    }
    if (coopShow) {
      body += `
      <div class="sp-coop">
        <span class="kicker">落地合作场景</span>
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
      <h3 class="sp-name">${esc(skin.base)}</h3>
      <div class="sp-meta mono">
        <span>笔刷 ${no}</span>
        <span class="sp-swatches">${sw}</span>
      </div>`;
  }

  /* 纹样架：每块纹样一枚活字签（内嵌迷你 pattern 预览） */
  function picksHTML(active) {
    if (skins.length < 1) return '';
    const chips = skins
      .map((s, i) => {
        const dots = s.palette
          .slice(0, 3)
          .map((c) => `<i class="sp-chip-dot" style="background:${esc(c)}"></i>`)
          .join('');
        return `<button type="button" class="sp-chip${i === active ? ' active' : ''}" data-skin="${i}" aria-pressed="${i === active}">${dots}<span>${esc(s.base)}</span></button>`;
      })
      .join('');
    return `<div class="sp-picks"><span class="kicker">纹样架</span><div class="sp-chips">${chips}</div></div>`;
  }

  /* 槽位清单：五件构件各自当前住着哪块纹样 */
  function slotsHTML() {
    const rows = SLOTS.map((s) => {
      const p = st.slots[s.key];
      const on = st.selSlot === s.key;
      const pat = p == null ? null : skinAt(p);
      return `
      <button type="button" class="sp-slot${on ? ' on' : ''}${pat ? ' painted' : ''}" data-slot="${s.key}" aria-pressed="${on}">
        <span class="sp-slot-name">${esc(s.label)}</span>
        <span class="sp-slot-hint mono">${esc(pat ? pat.base : '素色 · ' + s.hint)}</span>
      </button>`;
    }).join('');
    return `
      <div class="sp-slots">
        <span class="kicker">上色</span>
        <p class="sp-slots-tip mono">点房间里的构件或下方清单，即用当前笔刷上色；换笔刷请点纹样架。</p>
        <div class="sp-slot-list">${rows}</div>
        <div class="sp-slot-acts">
          <button type="button" class="btn ghost" data-act="fillall">一键铺满</button>
          <button type="button" class="btn ghost" data-act="clearall">全部素色</button>
        </div>
      </div>`;
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

  /* 场景文案通栏：挂在壳底（#spaceShell 网格第 3 行），不占侧栏高度 */
  function notesEl() {
    let notes = container.querySelector(':scope > .sp-notes');
    if (!notes) {
      notes = document.createElement('div');
      notes.className = 'sp-notes';
      container.appendChild(notes);
    }
    return notes;
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
    const oldSlots = side.querySelector('.sp-slots');
    if (oldSlots) oldSlots.remove();

    head.innerHTML = headHTML(skin, st.idx);
    if (skins.length >= 1) body.insertAdjacentHTML('afterbegin', picksHTML(st.idx));
    body.insertAdjacentHTML('afterbegin', slotsHTML());
    notesEl().innerHTML = copyHTML(skin);
    if (act) act.hidden = !skins.length;
  }

  function setStatus(msg, isErr) {
    const el = st.els.status || (st.els.status = side.querySelector('.sp-status'));
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('err', !!isErr);
  }

  /* ---------------- 预览：图纸 + 热区 + 纹样 defs ---------------- */
  function buildPreview() {
    preview.innerHTML = `
      <p class="sp-cap kicker">点构件，给它一块纹样</p>
      <div class="sp-stage">
        <figure class="sp-sheet">
          <span class="tape" style="top:-12px; left:9%; transform:rotate(-4deg);"></span>
          <span class="tape" style="bottom:-11px; right:13%; transform:rotate(3deg);"></span>
          <div class="sp-draw">${sceneSVG()}</div>
          <figcaption class="sp-title mono">
            <span>立面图 A</span>
            <span>比例 1:50</span>
            <span class="sp-title-name"></span>
          </figcaption>
        </figure>
        <figure class="sp-print" hidden></figure>
      </div>`;
    paintDefs();
  }

  function paintDefs() {
    const defs = preview.querySelector('.sp-defs');
    if (!defs) return;
    defs.innerHTML = skins.map((s, i) => patternDef(i, s)).join('');
  }

  /* 槽位上色：CSS 变量挂到容器，SVG 里 fill: var(--pat-xxx) 消费 */
  function paintVars(skin) {
    const root = container;
    skin.palette.forEach((c, i) => {
      root.style.setProperty(`--sk${i + 1}`, c);
    });
    SLOTS.forEach((s) => {
      const p = st.slots[s.key];
      if (p == null) root.style.removeProperty(`--pat-${s.key}`);
      else root.style.setProperty(`--pat-${s.key}`, `url(#sp-pat-${p})`);
    });
    const t = preview.querySelector('.sp-title-name');
    if (t) t.textContent = `${skin.base} · 客房`;
    const svg = preview.querySelector('.sp-svg');
    if (svg) svg.setAttribute('aria-label', '客房立面拼贴示意图：窗帘、挂画、灯罩、床旗、地毯均已按所选纹样上色');
    // 选中态描边
    preview.querySelectorAll('.sp-hot').forEach((g) => {
      g.classList.toggle('sel', !!st.selSlot && g.dataset.slot === st.selSlot);
    });
  }

  function risoSwap() {
    const svg = preview.querySelector('.sp-svg');
    if (!svg || reduced()) return;
    svg.classList.remove('is-swap');
    void svg.getBoundingClientRect();
    svg.classList.add('is-swap');
    const id = window.setTimeout(() => {
      st.timers.delete(id);
      svg.classList.remove('is-swap');
    }, 520);
    st.timers.add(id);
  }

  /* 单件上色的局部抖动（riso 套印感） */
  function paintJitter(key) {
    if (reduced()) return;
    const g = preview.querySelector(`.sp-hot[data-slot="${key}"]`);
    if (!g) return;
    g.classList.remove('is-paint');
    void g.getBoundingClientRect();
    g.classList.add('is-paint');
    const id = window.setTimeout(() => {
      st.timers.delete(id);
      g.classList.remove('is-paint');
    }, 420);
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
    syncPrint();
    if (changed && !(opts && opts.silent)) risoSwap();
    container.dataset.skin = skin.id;
  }

  function paintSlot(key, patIdx) {
    if (!SLOTS.some((s) => s.key === key)) return;
    st.selSlot = key;              // 选中该构件（后续点纹样即改它）
    st.slots[key] = patIdx;        // patIdx=null 表示素色
    paintVars(cur());
    renderSide();
    syncPrint();
    paintJitter(key);
  }

  /* 出图归属「笔刷+槽位」签名，换装后图不对版：
     签名一致才亮出来（改回去还能再亮） */
  function syncPrint() {
    const print = preview.querySelector('.sp-print');
    if (!print) return;
    if (!st.printUrl || st.printSig !== arrSig()) {
      print.hidden = true;
      return;
    }
    print.hidden = false;
    print.innerHTML = `
      <span class="tape" style="top:-11px; right:16%; transform:rotate(-3deg);"></span>
      <img src="${esc(st.printUrl)}" alt="${esc(cur().base)}纹样客房的 AI 生成图" loading="lazy">
      <figcaption class="mono">AI 出图 · ${esc(cur().base)}客房</figcaption>`;
  }

  /* ---------------- 生成这间房：文生图 → 轮询 → 贴图 ---------------- */
  function buildPrompt() {
    const painted = SLOTS.filter((s) => st.slots[s.key] != null)
      .map((s) => `${s.label}印${skinAt(st.slots[s.key]).base}纹样`)
      .join('，');
    const base = cur().base;
    return painted
      ? `${base}基调的客房，${painted}，水墨纸质感，纸片剪贴插画，米黄纸底，Lo-Fi 手账拼贴，室内立面构图，窗床灯画毯家具陈设，素雅留白，无文字`
      : `${base}客房，水墨纸质感，纸片剪贴插画，米黄纸底，Lo-Fi 手账拼贴，室内立面构图，窗床灯画毯家具陈设，素雅留白，无文字`;
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
    if (window.__BACKEND__ && window.__BACKEND__.ai === false) {
      setStatus('暂不支持访问，全量配置后可以使用', true);
      return;
    }
    st.busy = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = '生成中…';
    }
    setStatus('已提交文生图 · 出图约十几秒…', false);
    try {
      const r = await fetch('api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: buildPrompt() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.taskId) throw new Error(j.error || `提交失败 ${r.status}`);
      const url = await pollTask(j.taskId);
      if (st.dead) return;
      st.printUrl = url;
      st.printSig = arrSig();
      syncPrint();
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
    // 点构件（图纸热区或侧栏清单）＝直接用当前笔刷上色并选中它
    const hot = e.target.closest('.sp-hot');
    if (hot && preview.contains(hot)) {
      paintSlot(hot.dataset.slot, st.idx);
      return;
    }
    const slotRow = e.target.closest('.sp-slot');
    if (slotRow) {
      paintSlot(slotRow.dataset.slot, st.idx);
      return;
    }
    // 注意：容器自身带 data-skin 属性，必须限定 .sp-chip，否则 fillall 等按钮会被误判
    const chip = e.target.closest('.sp-chip[data-skin]');
    if (chip) {
      const i = Number(chip.dataset.skin) || 0;
      if (st.selSlot) {
        // 选着构件点纹样 = 直接上色，同时换基准色
        st.idx = Math.min(Math.max(i, 0), Math.max(skins.length - 1, 0));
        paintSlot(st.selSlot, st.idx);
        container.dataset.skin = cur().id;
      } else {
        selectSkin(i);
      }
      return;
    }
    if (e.target.closest('[data-act="fillall"]')) {
      SLOTS.forEach((s) => { st.slots[s.key] = st.idx; });
      paintVars(cur());
      renderSide();
      syncPrint();
      if (!reduced()) SLOTS.forEach((s) => paintJitter(s.key));
      setStatus(`已把「${cur().base}」铺满五件构件`, false);
      return;
    }
    if (e.target.closest('[data-act="clearall"]')) {
      st.slots = {};
      paintVars(cur());
      renderSide();
      syncPrint();
      setStatus('已恢复素色', false);
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
    paintVars(EMPTY_SKIN);
    renderSide();
    container.dataset.status = 'empty';
  }

  container.__spaceOff = function () {
    st.dead = true;
    st.timers.forEach((id) => window.clearTimeout(id));
    st.timers.clear();
    // 清了定时器，await sleep 还吊着：resolve 放行后它立刻撞上 st.dead 收摊
    st.sleeps.forEach((r) => r());
    st.sleeps.clear();
    container.removeEventListener('click', onClick);
    preview.innerHTML = '';
    side.innerHTML = '';
    const notes = container.querySelector(':scope > .sp-notes');
    if (notes) notes.remove();
    ['--sk1', '--sk2', '--sk3', '--sk4', '--sk5',
     '--pat-curtain', '--pat-art', '--pat-shade', '--pat-blanket', '--pat-rug']
      .forEach((k) => container.style.removeProperty(k));
    container.dataset.status = '';
    delete container.dataset.skin;
    delete container.__spaceOff;
  };
}
