/* ============================================================
   01 · 勘探图 — 金坛十八处
   钉在纸上的勘探图：做旧瓦片 · 手绘图钉 · 手写图例 · 索引侧栏
   导出：export function initMap(container, data)   // #mapShell / points.json
   ============================================================ */

/* ---- 分类 → 金坛材质语义色（缺省回退墨色） ---- */
const CAT_ORDER = ['遗址考古', '道家文化', '湖鲜渔俗', '传统技艺', '人文胜迹'];
const CAT_INK = {
  遗址考古: 'var(--clay)',
  道家文化: 'var(--bamboo)',
  湖鲜渔俗: 'var(--lake)',
  传统技艺: 'var(--riso-red)',
  人文胜迹: 'var(--riso-pink)',
};

/* ---- 默认视野：金坛区 31.72N 119.57E zoom 11 ---- */
const HOME = { lat: 31.72, lng: 119.57, zoom: 11 };

/* ---- 小工具 ---- */
const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
const pad2 = (n) => String(n).padStart(2, '0');
const inkOf = (c) => CAT_INK[c] || 'var(--ink-soft)';
const hasXY = (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng);
const reduced = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

/* ---- 数据整形（容错：缺字段、坐标可能是字符串、data 可能为 null） ---- */
function normalize(data) {
  const raw = (data && Array.isArray(data.points)) ? data.points : [];
  return raw.map((p, i) => {
    const o = p || {};
    const lat = o.lat === undefined || o.lat === null || o.lat === '' ? NaN : Number(o.lat);
    const lng = o.lng === undefined || o.lng === null || o.lng === '' ? NaN : Number(o.lng);
    return {
      i,
      name: o.name || '未命名点位',
      category: o.category || '未分类',
      hook: o.hook || '',
      description: o.description || '',
      playTip: o.playTip || '',
      level: o.level || '',
      lat: Number.isFinite(lat) ? lat : NaN,
      lng: Number.isFinite(lng) ? lng : NaN,
    };
  });
}

function fmtCoord(p) {
  if (!hasXY(p)) return '';
  const ns = p.lat >= 0 ? 'N' : 'S';
  const ew = p.lng >= 0 ? 'E' : 'W';
  return `${Math.abs(p.lat).toFixed(4)}°${ns} ${Math.abs(p.lng).toFixed(4)}°${ew}`;
}

/* ---- 分类聚合（固定顺序在前，其余按出现顺序） ---- */
function catsOf(pts) {
  const seen = [];
  pts.forEach((p) => { if (!seen.includes(p.category)) seen.push(p.category); });
  const ordered = CAT_ORDER.filter((c) => seen.includes(c))
    .concat(seen.filter((c) => !CAT_ORDER.includes(c)));
  return ordered.map((c) => ({ c, n: pts.filter((p) => p.category === c).length }));
}

/* ============================================================
   Leaflet 装载（UMD，动态注入 script，全局 promise 复用）
   ============================================================ */
let leafletPromise = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/leaflet/leaflet.js';
    s.async = true;
    s.onload = () => (window.L ? resolve(window.L) : reject(new Error('Leaflet 未就绪')));
    s.onerror = () => reject(new Error('Leaflet 脚本加载失败'));
    document.head.appendChild(s);
  });
  return leafletPromise;
}

/* ============================================================
   标记 HTML（Leaflet divIcon 与离线坐标图共用）
   ============================================================ */
function markerHTML(p) {
  return `<span class="mk" data-pt="${p.i}" role="button" tabindex="0" aria-label="${esc(p.name)}" style="--c:${inkOf(p.category)}">` +
    `<span class="mk-name">${esc(p.name)}</span>` +
    `<span class="mk-tag"><i class="mk-dot"></i><em>${pad2(p.i + 1)}</em></span>` +
    `<i class="mk-tip"></i>` +
    `</span>`;
}

/* ============================================================
   骨架搭建（幂等：只在首次 initMap 执行）
   ============================================================ */
function buildDOM(st) {
  const shell = st.shell;
  const canvas = shell.querySelector('#mapCanvas');
  const side = shell.querySelector('#mapSide');
  const filters = document.getElementById('mapFilters');

  canvas.innerHTML =
    `<div class="map-leaf"></div>` +
    `<div class="map-fallback" hidden></div>` +
    `<div class="map-wash halftone" aria-hidden="true"></div>` +
    `<div class="map-legend" hidden></div>`;

  // 保留 index.html 里已有的空态节点，只往后追加
  side.insertAdjacentHTML(
    'beforeend',
    `<div class="map-detail" aria-live="polite" hidden></div>` +
    `<div class="map-index-head mono"><span>索引 INDEX</span><span class="map-idx-count"></span></div>` +
    `<ol class="map-list"></ol>`
  );

  st.dom = {
    canvas,
    side,
    filters,
    empty: side.querySelector('.map-side-empty'),
    leaf: canvas.querySelector('.map-leaf'),
    fallback: canvas.querySelector('.map-fallback'),
    legend: canvas.querySelector('.map-legend'),
    detail: side.querySelector('.map-detail'),
    list: side.querySelector('.map-list'),
    count: side.querySelector('.map-idx-count'),
  };
}

/* ============================================================
   交互绑定（一次）
   ============================================================ */
function wire(st) {
  st.shell.addEventListener('click', (e) => {
    const back = e.target.closest('[data-act="back"]');
    if (back) {
      st.selected = null;
      renderDetail(st);
      syncActive(st);
      st.dom.side.scrollTop = 0;
      return;
    }
    const el = e.target.closest('[data-pt]');
    if (!el) return;
    // Leaflet 的 marker 点击会自己 fire，这里去重交给 pick()
    pick(st, Number(el.dataset.pt), !el.classList.contains('mk'));
  });

  st.shell.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest('.mk[data-pt]');
    if (!el) return;
    e.preventDefault();
    pick(st, Number(el.dataset.pt), false);
  });

  if (st.dom.filters) {
    st.dom.filters.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-cat]');
      if (!chip) return;
      setCat(st, chip.dataset.cat);
    });
  }
}

/* ============================================================
   选择 / 筛选
   ============================================================ */
function pick(st, i, pan) {
  const p = st.pts[i];
  if (!p) return;
  if (st.selected === i) { syncActive(st); return; }
  st.selected = i;
  renderDetail(st);
  syncActive(st);
  st.dom.side.scrollTop = 0;
  if (pan) focus(st, p);
}

function focus(st, p) {
  if (!st.map || !hasXY(p)) return;
  const ll = st.L.latLng(p.lat, p.lng);
  // 只在图钉贴近边缘/出画时才挪视野，保住周边语境
  if (st.map.getBounds().pad(-0.04).contains(ll)) return;
  st.map.panTo(ll, { animate: !reduced(), duration: 0.55, easeLinearity: 0.35 });
}

function setCat(st, cat) {
  st.cat = cat;
  const pts = st.pts;
  if (st.selected != null && cat !== '*' && pts[st.selected].category !== cat) {
    st.selected = null;
    renderDetail(st);
  }
  renderChips(st);
  renderList(st);
  applyMarkers(st);
  if (st.fallbackOn) renderFallback(st);
  syncActive(st);
}

function visible(st) {
  return st.pts.filter((p) => st.cat === '*' || p.category === st.cat);
}

/* ============================================================
   渲染 · 分类筛选 chips
   ============================================================ */
function renderChips(st) {
  const box = st.dom.filters;
  if (!box) return;
  const cats = catsOf(st.pts);
  const total = st.pts.length;
  const chips = [`<button type="button" class="map-chip${st.cat === '*' ? ' is-on' : ''}" data-cat="*" aria-pressed="${st.cat === '*'}">全部<em>${total}</em></button>`]
    .concat(
      cats.map(({ c, n }) => {
        const on = st.cat === c;
        return `<button type="button" class="map-chip${on ? ' is-on' : ''}" data-cat="${esc(c)}" aria-pressed="${on}" style="--c:${inkOf(c)}"><i></i>${esc(c)}<em>${n}</em></button>`;
      })
    );

  box.innerHTML =
    `<span class="mf-label mono">筛选 FILTER</span>` +
    `<span class="mf-chips">${chips.join('')}</span>` +
    `<span class="mf-count mono">${visible(st).length} / ${total}</span>`;
}

/* ============================================================
   渲染 · 图例（手写便签，非交互）
   ============================================================ */
function renderLegend(st) {
  const box = st.dom.legend;
  const cats = catsOf(st.pts);
  if (!cats.length) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML =
    `<span class="tape" style="top:-9px; left:50%; transform:translateX(-50%) rotate(-4deg);"></span>` +
    `<span class="lg-title mono">图例 LEGEND</span>` +
    `<ul class="lg-list">` +
    cats.map(({ c, n }) => `<li><i style="--c:${inkOf(c)}"></i>${esc(c)}<b>${n}</b></li>`).join('') +
    `</ul>` +
    `<p class="lg-note mono">滚轮留给页面，缩放用 + / −</p>`;
}

/* ============================================================
   渲染 · 侧栏索引
   ============================================================ */
function renderList(st) {
  const rows = visible(st);
  const total = st.pts.length;
  st.dom.count.textContent = rows.length === total ? `${total} 处` : `${rows.length} / ${total}`;

  if (!rows.length) {
    st.dom.list.innerHTML = `<li class="map-empty mono">${total ? '此分类下暂无点位' : '暂无点位数据'}</li>`;
    return;
  }

  st.dom.list.innerHTML = rows
    .map(
      (p, k) => `<li style="--r:${k}"><button type="button" class="map-row${st.selected === p.i ? ' is-active' : ''}" data-pt="${p.i}">` +
        `<span class="mr-top"><i class="mr-no mono">${pad2(p.i + 1)}</i><span class="mr-name">${esc(p.name)}</span></span>` +
        `<span class="mr-meta mono"><i class="mr-dot" style="--c:${inkOf(p.category)}"></i>${esc(p.category)}` +
        (p.level ? ` · ${esc(p.level)}` : '') +
        (hasXY(p) ? '' : `<b class="mr-flag">无坐标</b>`) +
        `</span>` +
        `</button></li>`
    )
    .join('');
}

/* ============================================================
   渲染 · 详情
   ============================================================ */
function renderDetail(st) {
  const box = st.dom.detail;
  const empty = st.dom.empty;
  const p = st.selected == null ? null : st.pts[st.selected];

  if (!p) {
    box.hidden = true;
    box.innerHTML = '';
    if (empty) empty.hidden = false;
    return;
  }
  box.hidden = false;
  if (empty) empty.hidden = true;

  box.innerHTML =
    `<article class="md">` +
    `<span class="md-no mono">${pad2(p.i + 1)}</span>` +
    `<button type="button" class="map-back mono" data-act="back">← 返回</button>` +
    `<span class="md-cat" style="--c:${inkOf(p.category)}"><i></i>${esc(p.category)}${p.level ? ` · ${esc(p.level)}` : ''}</span>` +
    `<h3 class="md-name">${esc(p.name)}</h3>` +
    (p.hook ? `<p class="md-hook">${esc(p.hook)}</p>` : '') +
    (p.description ? `<p class="md-desc">${esc(p.description)}</p>` : '') +
    (p.playTip
      ? `<div class="md-tip"><span class="kicker">玩法 TIP</span><p>${esc(p.playTip)}</p></div>`
      : '') +
    `<p class="md-coord mono">${hasXY(p) ? fmtCoord(p) : '坐标未标定 · 仅收录于索引'}</p>` +
    `</article>`;
}

/* ============================================================
   高亮同步（列表 + 图钉 + 离线坐标图）
   ============================================================ */
function syncActive(st) {
  const sel = st.selected;
  st.dom.list.querySelectorAll('.map-row').forEach((r) => {
    r.classList.toggle('is-active', Number(r.dataset.pt) === sel);
  });
  st.shell.querySelectorAll('.mk[data-pt]').forEach((el) => {
    el.classList.toggle('is-active', Number(el.dataset.pt) === sel);
  });
  st.markers.forEach((m, i) => {
    if (!m) return;
    m.setZIndexOffset(i === sel ? 1000 : 0);
  });
}

/* ============================================================
   筛选落到地图
   ============================================================ */
function applyMarkers(st) {
  if (!st.map) return;
  st.pts.forEach((p, i) => {
    const m = st.markers[i];
    if (!m) return;
    const want = st.cat === '*' || p.category === st.cat;
    const on = st.map.hasLayer(m);
    if (want && !on) st.map.addLayer(m);
    if (!want && on) st.map.removeLayer(m);
  });
}

/* ============================================================
   标记构建 / 视野（initMap 可被多次调用：先撤旧再铺新）
   ============================================================ */
function buildMarkers(st) {
  if (!st.map || !st.L) return;
  const { L, map } = st;
  st.markers.forEach((m) => { if (m) map.removeLayer(m); });
  st.markers = st.pts.map((p) => {
    if (!hasXY(p)) return null;
    const mk = L.marker([p.lat, p.lng], {
      keyboard: false,
      riseOnHover: true,
      icon: L.divIcon({
        className: 'mk-wrap',
        html: markerHTML(p),
        iconSize: [46, 54],
        iconAnchor: [23, 54],
      }),
    });
    mk.on('click', () => pick(st, p.i, false));
    mk.addTo(map);
    return mk;
  });
  applyMarkers(st);
  syncActive(st);
}

function fitToData(st) {
  if (!st.map || !st.L) return;
  const xy = st.pts.filter(hasXY);
  if (xy.length >= 2) {
    st.map.fitBounds(st.L.latLngBounds(xy.map((p) => [p.lat, p.lng])), {
      padding: [44, 44], maxZoom: 12, animate: !reduced(),
    });
  } else if (xy.length === 1) {
    st.map.setView([xy[0].lat, xy[0].lng], 12.5, { animate: false });
  }
}

/* ============================================================
   地图挂载
   ============================================================ */
async function mountMap(st) {
  let L;
  try {
    L = await loadLeaflet();
  } catch (err) {
    mountFallback(st, err);
    return;
  }
  if (!st.dom.leaf.isConnected) return;

  const canvas = st.dom.canvas;
  const map = L.map(st.dom.leaf, {
    center: [HOME.lat, HOME.lng],
    zoom: HOME.zoom,
    scrollWheelZoom: false,   // 长页面不抢滚轮
    zoomControl: true,
    attributionControl: true,
    fadeAnimation: !reduced(),
    zoomAnimation: !reduced(),
    markerZoomAnimation: !reduced(),
    zoomSnap: 0.5,
  });
  map.attributionControl.setPrefix('');

  const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    subdomains: 'abc',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  let fails = 0;
  let loaded = 0;
  const markFail = () => canvas.classList.add('map-tile-fail');
  tiles.on('tileerror', () => { if (++fails >= 4) markFail(); });
  tiles.on('tileload', () => { loaded++; canvas.classList.remove('map-tile-fail'); });
  // 瓦片源挂起（既不成功也不报错）→ 到点让坐标纸兜底
  setTimeout(() => { if (!loaded && fails < 4) markFail(); }, 6000);

  st.map = map;
  st.L = L;
  buildMarkers(st);

  // 视野：先按金坛默认视图落位，布局稳定后再 fit
  const setView = () => fitToData(st);
  requestAnimationFrame(() => {
    map.invalidateSize();
    setView();
    setTimeout(() => { map.invalidateSize(); setView(); }, 260);
  });

  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => {
      const r = canvas.getBoundingClientRect();
      const s = map.getSize();
      if (Math.abs(r.width - s.x) > 1 || Math.abs(r.height - s.y) > 1) {
        map.invalidateSize({ animate: false });
      }
    });
    ro.observe(canvas);
  }
}

/* ============================================================
   离线兜底：Leaflet 不可用时，按经纬度铺一张纸上坐标图
   ============================================================ */
function project(list) {
  const lngs = list.map((p) => p.lng);
  const lats = list.map((p) => p.lat);
  let minx = Math.min(...lngs), maxx = Math.max(...lngs);
  let miny = Math.min(...lats), maxy = Math.max(...lats);
  const dx = (maxx - minx) || 0.06;
  const dy = (maxy - miny) || 0.06;
  minx -= dx * 0.2; maxx += dx * 0.2;
  miny -= dy * 0.2; maxy += dy * 0.2;
  return list.map((p) => ({
    x: ((p.lng - minx) / (maxx - minx)) * 100,
    y: (1 - (p.lat - miny) / (maxy - miny)) * 100,
  }));
}

function mountFallback(st) {
  st.fallbackOn = true;
  st.dom.leaf.hidden = true;
  st.dom.fallback.hidden = false;
  renderFallback(st);
}

function renderFallback(st) {
  const fb = st.dom.fallback;
  const rows = visible(st).filter(hasXY);
  if (!rows.length) {
    fb.innerHTML = `<p class="map-fb-note mono">底图未能加载 · 请右侧索引浏览</p>`;
    return;
  }
  const pos = project(rows);
  fb.innerHTML =
    `<p class="map-fb-note mono">底图离线 · 以下按经纬度示意，可点击</p>` +
    `<div class="map-plot">` +
    rows.map((p, k) => `<span class="mk-pin" style="left:${pos[k].x.toFixed(2)}%;top:${pos[k].y.toFixed(2)}%">${markerHTML(p)}</span>`).join('') +
    `</div>`;
}

/* ============================================================
   全量渲染
   ============================================================ */
function renderAll(st) {
  renderChips(st);
  renderLegend(st);
  renderList(st);
  renderDetail(st);
  applyMarkers(st);
  syncActive(st);
  if (st.fallbackOn) renderFallback(st);
}

/* ============================================================
   入口（幂等，可重复调用）
   ============================================================ */
export function initMap(container, data) {
  if (!container) return;
  const pts = normalize(data);

  const st = container.__mapState;
  if (st) {
    st.pts = pts;
    if (st.cat !== '*' && !pts.some((p) => p.category === st.cat)) st.cat = '*';
    if (st.selected != null && st.selected >= pts.length) st.selected = null;
    // 地图已挂载 → 按新数据重建图钉并重落视野（幂等：旧层先撤）
    if (st.map) { buildMarkers(st); fitToData(st); }
    renderAll(st);
    container.dataset.status = 'ready';
    return;
  }

  const fresh = {
    shell: container,
    pts,
    cat: '*',
    selected: null,
    map: null,
    L: null,
    markers: [],
    fallbackOn: false,
    dom: null,
  };
  container.__mapState = fresh;

  buildDOM(fresh);
  wire(fresh);
  renderAll(fresh);
  mountMap(fresh);

  container.dataset.module = 'map';
  container.dataset.status = 'ready';
}
