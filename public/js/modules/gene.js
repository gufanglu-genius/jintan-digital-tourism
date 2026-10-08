/* ============================================================
   模块 04 · 审美基因编辑器（共创台左栏）
   - 5 条非遗纹样基因切换（以 gene.json 为准，数据驱动）
   - 确定性随机纹样生成器：同基因 + 同参数 = 同图（seeded）
   - 轴对称 / 旋转对称实时预览，重绘走 rAF 节流
   - 参数=手账旋钮纸条；输出=「拓印一张」（存 PNG）+「AI 生图」
   - meta 区：源流 source / 基因故事 story / 色板 swatch（点击复制 hex）
   - 无数据 →「纹样版待上机…」；重复 initGene 幂等（__geneOff）
   ============================================================ */

const TAU = Math.PI * 2;

/* ---------------- 小工具 ---------------- */
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* 读取设计令牌（禁止另造色值：一切颜色从 tokens.css 来） */
function cssVar(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return v && v.trim() ? v.trim() : fallback;
  } catch {
    return fallback;
  }
}

/* 确定性随机（mulberry32） */
function mulberry32(a) {
  let t = a >>> 0;
  return function () {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/* 字符串 → 32 位种子 */
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ---------------- 颜色小工具 ---------------- */
function normHex(c) {
  let h = String(c || '').trim().replace(/^#/, '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return '#' + h.toLowerCase();
}
const HEX_RE = /^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;

function hexToRgb(hex) {
  let h = normHex(hex).slice(1);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHex(r, g, b) {
  const p = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return '#' + p(r) + p(g) + p(b);
}

function shiftHue(hex, deg) {
  const { r, g, b } = hexToRgb(hex);
  const a = (deg * Math.PI) / 180;
  const cosA = Math.cos(a), sinA = Math.sin(a);
  // 轻量 RGB 旋转矩阵（近似色相环移）
  const m = [
    0.213 + cosA * 0.787 - sinA * 0.213,
    0.715 - cosA * 0.715 - sinA * 0.715,
    0.072 - cosA * 0.072 + sinA * 0.928,
    0.213 - cosA * 0.213 + sinA * 0.143,
    0.715 + cosA * 0.285 + sinA * 0.14,
    0.072 - cosA * 0.072 - sinA * 0.283,
    0.213 - cosA * 0.213 - sinA * 0.787,
    0.715 - cosA * 0.715 + sinA * 0.715,
    0.072 + cosA * 0.928 + sinA * 0.072,
  ];
  return rgbToHex(
    r * m[0] + g * m[1] + b * m[2],
    r * m[3] + g * m[4] + b * m[5],
    r * m[6] + g * m[7] + b * m[8]
  );
}

/* ---------------- 数据清洗 ---------------- */
function normalizeGenes(data) {
  let arr = [];
  if (Array.isArray(data)) arr = data;
  else if (data && Array.isArray(data.genes)) arr = data.genes;
  else {
    const w = typeof window !== 'undefined' ? window.__GENE_DATA__ : null;
    if (w && Array.isArray(w.genes)) arr = w.genes;
  }

  const out = [];
  for (const g of arr) {
    if (!g || typeof g !== 'object') continue;
    const name = typeof g.name === 'string' ? g.name.trim() : '';
    if (!name) continue;

    const params = [];
    for (const p of Array.isArray(g.params) ? g.params : []) {
      if (!p || typeof p !== 'object') continue;
      const key = typeof p.key === 'string' ? p.key.trim() : '';
      if (!key) continue;
      const min = Number(p.min);
      const max = Number(p.max);
      if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) continue;
      let def = Number(p.default);
      if (!Number.isFinite(def)) def = (min + max) / 2;
      def = clamp(def, min, max);
      params.push({
        key,
        label: typeof p.label === 'string' && p.label.trim() ? p.label.trim() : key,
        min,
        max,
        def,
        unit: typeof p.unit === 'string' ? p.unit : '',
      });
    }

    const palette = [];
    for (const c of Array.isArray(g.palette) ? g.palette : []) {
      if (typeof c === 'string' && HEX_RE.test(c.trim())) {
        const n = normHex(c);
        if (!palette.includes(n)) palette.push(n);
      }
    }

    out.push({
      id: typeof g.id === 'string' && g.id.trim() ? g.id.trim() : 'gene-' + out.length,
      name,
      source: typeof g.source === 'string' ? g.source.trim() : '',
      story: typeof g.story === 'string' ? g.story.trim() : '',
      params,
      palette,
    });
  }
  return out;
}

/* ---------------- 参数访问器（生成器用，别名匹配数据 key） ---------------- */
const A_DENS = ['density', 'dens', 'complex', '密度', '疏密', '繁复', '繁'];
const A_JAG = ['jagged', 'jag', 'rough', 'edge', '锯齿', '锯', '糙', '毛糙', 'fringe', '流苏'];
const A_CURL = ['curl', 'curly', 'swirl', 'spiral', 'curv', 'ripple', '曲率', 'flow', '流', '卷曲', '卷', '旋', '涡'];
const A_DOT = ['dots', 'dot', '点数', '圆点', '点', 'sparkle', '闪烁', '灯光'];
const A_WGT = ['weight', 'thick', 'width', '线宽', '粗细', '笔画', 'bleed', '扩散'];
const A_AXES = ['mirrorAxes', 'mirror', 'axis', 'axes', '对称轴', '轴'];

function makeP(vals, params) {
  function find(aliases) {
    for (const a of aliases) {
      const p = params.find((x) => x.key.toLowerCase() === a.toLowerCase());
      if (p) return p;
    }
    for (const a of aliases) {
      const low = a.toLowerCase();
      const p = params.find(
        (x) => x.key.toLowerCase().includes(low) || x.label.toLowerCase().includes(low)
      );
      if (p) return p;
    }
    return null;
  }
  return {
    find,
    norm(aliases, def) {
      const p = find(aliases);
      if (!p) return def;
      const v = vals[p.key];
      if (!Number.isFinite(v)) return def;
      return clamp((v - p.min) / (p.max - p.min), 0, 1);
    },
  };
}

/* ---------------- 纹样生成器（每个基因一个；参数以数据 key 别名读取） ------- */
/* 约定：ctx 原点在格子中心，S=格边长，R=该格确定性随机，C={colors,T,paper} */

function gridN(P, lo, hi) {
  const d = P.norm(A_DENS, 0.5);
  return Math.round(clamp(lo + d * (hi - lo), lo, hi));
}

/* ① 三星村陶纹：涡纹 + 弧带 + 三角齿 + 点纹 */
function genPottery() {
  return {
    tiles: (P) => gridN(P, 2, 8),
    draw(ctx, S, P, R, C) {
      const ink = C.colors[0] || C.T.ink;
      const acc = C.colors[1] || C.T.red;
      const jag = P.norm(A_JAG, 0.42);
      const curl = P.norm(A_CURL, 0.4);
      const dots = P.norm(A_DOT, 0.45);
      const lw = S * (0.02 + 0.035 * P.norm(A_WGT, 0.4));
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // 中心涡纹（螺旋）
      const turns = 0.9 + curl * 2.3;
      const steps = Math.max(26, Math.floor(turns * 30));
      ctx.strokeStyle = ink;
      ctx.lineWidth = lw;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * turns * TAU;
        const rr = S * 0.05 + (i / steps) * S * 0.17;
        const x = Math.cos(t) * rr + (R() - 0.5) * S * 0.016 * jag;
        const y = Math.sin(t) * rr + (R() - 0.5) * S * 0.016 * jag;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();

      // 同心弧带（带轻微抖动的手绘感）
      const rings = gridN(P, 2, 3);
      for (let k = 0; k < rings; k++) {
        const r = S * (0.24 + (k / Math.max(1, rings - 1)) * 0.17);
        const segs = 3 + Math.floor(R() * 4);
        ctx.strokeStyle = k % 2 ? acc : ink;
        ctx.lineWidth = lw * 0.85;
        for (let s = 0; s < segs; s++) {
          const a0 = R() * TAU;
          const span = TAU * (0.2 + R() * 0.4);
          const seg = 9;
          ctx.beginPath();
          for (let i = 0; i <= seg; i++) {
            const a = a0 + (span * i) / seg;
            const rr = r + (R() - 0.5) * S * 0.022 * jag;
            const x = Math.cos(a) * rr;
            const y = Math.sin(a) * rr;
            if (i) ctx.lineTo(x, y);
            else ctx.moveTo(x, y);
          }
          ctx.stroke();
        }
      }

      // 三角锯齿环
      const teeth = 7 + Math.round(jag * 9);
      const amp = S * (0.018 + 0.042 * jag);
      ctx.strokeStyle = ink;
      ctx.lineWidth = lw * 0.9;
      ctx.beginPath();
      for (let i = 0; i <= teeth; i++) {
        const a = (i / teeth) * TAU;
        const rr = S * 0.43 + (i % 2 ? -amp : amp);
        const x = Math.cos(a) * rr;
        const y = Math.sin(a) * rr;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();

      // 点纹
      const nd = 3 + Math.round(dots * 7);
      ctx.fillStyle = ink;
      for (let i = 0; i < nd; i++) {
        const a = R() * TAU;
        const r = S * (0.19 + R() * 0.2);
        const rad = S * (0.011 + R() * 0.018);
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r, Math.sin(a) * r, rad, 0, TAU);
        ctx.fill();
      }
    },
  };
}

/* ② 金坛刻纸：实底镂空 —— 中心花 + 月牙咬角 + 连线孔 */
function genPapercut() {
  return {
    tiles: (P) => gridN(P, 2, 7),
    draw(ctx, S, P, R, C) {
      const bg = C.colors[0] || C.T.red;
      const cut = C.paper;
      const jag = P.norm(A_JAG, 0.5);
      const curl = P.norm(A_CURL, 0.35);
      const d = P.norm(A_DENS, 0.5);
      const pad = S * 0.03;
      const L = S / 2 - pad;

      ctx.fillStyle = bg;
      ctx.fillRect(-L, -L, L * 2, L * 2);

      ctx.fillStyle = cut;
      // 中心花（镂空）：「对称轴」参数直接决定花瓣数
      const ax = P.norm(A_AXES, -1);
      const petals =
        ax >= 0 ? clamp(2 + Math.round(ax * 7), 2, 9) : 4 + Math.round(d * 5);
      const pr = S * (0.1 + curl * 0.07);
      for (let i = 0; i < petals; i++) {
        ctx.save();
        ctx.rotate((i / petals) * TAU);
        ctx.beginPath();
        ctx.ellipse(0, -S * 0.17, pr * 0.55, pr, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(0, 0, S * 0.045, 0, TAU);
      ctx.fill();

      // 四角月牙咬边
      const bite = S * (0.055 + jag * 0.075);
      const corners = [
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ];
      for (const [sx, sy] of corners) {
        ctx.beginPath();
        ctx.arc(sx * (L - bite * 0.35), sy * (L - bite * 0.35), bite, 0, TAU);
        ctx.fill();
      }

      // 四边连线孔（刻纸“线不断”）
      const holes = 3 + Math.round(jag * 6);
      const hr = S * 0.02;
      for (let i = 0; i < holes; i++) {
        const t = (i + 0.5) / holes;
        let x, y;
        const side = i % 4;
        if (side === 0) {
          x = -L + 2 * L * t;
          y = -L + S * 0.05;
        } else if (side === 1) {
          x = L - S * 0.05;
          y = -L + 2 * L * t;
        } else if (side === 2) {
          x = -L + 2 * L * t;
          y = L - S * 0.05;
        } else {
          x = -L + S * 0.05;
          y = -L + 2 * L * t;
        }
        ctx.beginPath();
        ctx.arc(x, y, hr, 0, TAU);
        ctx.fill();
      }

      // 内框留白线
      ctx.strokeStyle = cut;
      ctx.lineWidth = S * 0.012;
      ctx.strokeRect(-L + S * 0.08, -L + S * 0.08, (L - S * 0.08) * 2, (L - S * 0.08) * 2);
    },
  };
}

/* ③ 茅山符箓：云篆竖脊 + 符头横笔 + 符胆螺旋 + 朱印 */
function genTalisman() {
  return {
    tiles: (P) => gridN(P, 2, 5),
    draw(ctx, S, P, R, C) {
      const ink = C.colors[0] || C.T.ink;
      const acc = C.colors[1] || C.T.red;
      const jag = P.norm(A_JAG, 0.45);
      const curl = P.norm(A_CURL, 0.4);
      const d = P.norm(A_DENS, 0.5);
      const lw = S * (0.022 + 0.03 * P.norm(A_WGT, 0.5));
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // 主脊：带折竖笔
      ctx.strokeStyle = ink;
      ctx.lineWidth = lw;
      const segs = 7 + Math.round(jag * 7);
      ctx.beginPath();
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const y = -S * 0.42 + t * S * 0.84;
        const x =
          (R() - 0.5) * S * 0.09 * jag +
          Math.sin(t * Math.PI * (1 + Math.round(d * 3))) * S * 0.05 * jag;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();

      // 符头：横笔
      const bars = 2 + Math.round(d * 2);
      for (let b = 0; b < bars; b++) {
        const y = -S * 0.34 + (b / Math.max(1, bars - 1)) * S * 0.2;
        const w2 = S * (0.2 + R() * 0.14);
        const mid = (R() - 0.5) * S * 0.05 * jag;
        ctx.beginPath();
        ctx.moveTo(-w2, y);
        ctx.quadraticCurveTo(0, y + mid, w2, y);
        ctx.stroke();
      }

      // 符胆：圆 + 内螺旋
      const cy = S * 0.05;
      ctx.beginPath();
      ctx.arc(0, cy, S * 0.1, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      const turns = 1 + curl * 2;
      for (let i = 0; i <= 44; i++) {
        const t = (i / 44) * turns * TAU;
        const rr = (i / 44) * S * 0.085;
        const x = Math.cos(t) * rr;
        const y = cy + Math.sin(t) * rr;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();

      // 星点（方点）
      const nd = 2 + Math.round(d * 4);
      ctx.fillStyle = ink;
      for (let i = 0; i < nd; i++) {
        const x = (R() - 0.5) * S * 0.52;
        const y = (R() - 0.5) * S * 0.62;
        const s = S * (0.015 + R() * 0.018);
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
      }

      // 底部朱印（留白十字）
      const ms = S * 0.075;
      const my = S * 0.32;
      ctx.fillStyle = acc;
      ctx.fillRect(-ms / 2, my, ms, ms);
      ctx.fillStyle = C.paper;
      ctx.fillRect(-ms * 0.34, my + ms * 0.42, ms * 0.68, ms * 0.16);
      ctx.fillRect(-ms * 0.08, my + ms * 0.18, ms * 0.16, ms * 0.64);
    },
  };
}

/* ④ 长荡湖水纹：鱼鳞叠弧 + 涡流 */
function genWater() {
  return {
    tiles: (P) => gridN(P, 2, 7),
    draw(ctx, S, P, R, C) {
      const main = C.colors[0] || C.T.lake;
      const acc = C.colors[1] || C.T.ink;
      const jag = P.norm(A_JAG, 0.4);
      const curl = P.norm(A_CURL, 0.35);
      const d = P.norm(A_DENS, 0.5);
      const lw = S * (0.018 + 0.03 * P.norm(A_WGT, 0.45));
      ctx.lineCap = 'round';

      // 鱼鳞纹（交错叠弧）
      const rows = 3 + Math.round(d * 3);
      const rh = (S * 0.94) / rows;
      const rad = rh * 0.7;
      const count = 3 + Math.round(d * 3);
      for (let r = 0; r < rows; r++) {
        const y = -S * 0.47 + (r + 0.55) * rh;
        const off = r % 2 ? rad * 0.75 : 0;
        ctx.strokeStyle = r % 2 ? acc : main;
        ctx.lineWidth = lw;
        for (let i = -1; i <= count; i++) {
          const x = -S * 0.5 + off + i * rad * 1.4 + (R() - 0.5) * S * 0.01 * jag;
          if (x - rad > S * 0.5) break;
          ctx.beginPath();
          ctx.arc(x, y, rad, Math.PI, TAU);
          ctx.stroke();
        }
      }

      // 中心涡流
      if (curl > 0.1) {
        ctx.strokeStyle = acc;
        ctx.lineWidth = lw * 1.1;
        ctx.beginPath();
        const turns = 1 + curl * 2.2;
        for (let i = 0; i <= 60; i++) {
          const t = (i / 60) * turns * TAU;
          const rr = S * 0.018 + (i / 60) * S * 0.15;
          const x = Math.cos(t) * rr + (R() - 0.5) * S * 0.01 * jag;
          const y = Math.sin(t) * rr * 0.82 + (R() - 0.5) * S * 0.01 * jag;
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
        ctx.stroke();
      }
    },
  };
}

/* ⑤ 手龙绣球灯：球体分瓣 + 齿边 + 中心旋球 */
function genLantern() {
  return {
    tiles: (P) => gridN(P, 2, 7),
    draw(ctx, S, P, R, C) {
      const ink = C.colors[0] || C.T.ink;
      const acc = C.colors[1] || C.T.red;
      const jag = P.norm(A_JAG, 0.45);
      const curl = P.norm(A_CURL, 0.4);
      const d = P.norm(A_DENS, 0.5);
      const spark = P.norm(A_DOT, 0.4);
      const lw = S * (0.02 + 0.032 * P.norm(A_WGT, 0.5));
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const R0 = S * 0.33;

      // 球体
      ctx.strokeStyle = ink;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(0, 0, R0, 0, TAU);
      ctx.stroke();

      // 分瓣（透镜形花瓣）
      const petals = 6 + Math.round(d * 4);
      ctx.lineWidth = lw * 0.85;
      for (let i = 0; i < petals; i++) {
        const a = (i / petals) * TAU;
        const na = a + TAU / petals / 2;
        const px = Math.cos(a) * R0;
        const py = Math.sin(a) * R0;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(
          Math.cos(na) * R0 * 0.62,
          Math.sin(na) * R0 * 0.62,
          px,
          py
        );
        ctx.quadraticCurveTo(
          Math.cos(a - TAU / petals / 2) * R0 * 0.62,
          Math.sin(a - TAU / petals / 2) * R0 * 0.62,
          0,
          0
        );
        ctx.stroke();
      }

      // 齿边（外环）
      const teeth = petals * 2;
      const amp = S * (0.018 + jag * 0.042);
      const rOut = R0 + S * 0.03;
      ctx.strokeStyle = acc;
      ctx.lineWidth = lw * 0.8;
      ctx.beginPath();
      for (let i = 0; i <= teeth; i++) {
        const a = (i / teeth) * TAU;
        const rr = rOut + (i % 2 ? 0 : amp);
        const x = Math.cos(a) * rr;
        const y = Math.sin(a) * rr;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();

      // 中心旋球
      ctx.strokeStyle = ink;
      ctx.lineWidth = lw;
      ctx.beginPath();
      const turns = 1.2 + curl * 2.2;
      for (let i = 0; i <= 52; i++) {
        const t = (i / 52) * turns * TAU;
        const rr = (i / 52) * S * 0.115;
        const x = Math.cos(t) * rr;
        const y = Math.sin(t) * rr;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();

      // 灯点：外圈瓣尖随灯光闪烁度增密，亮时再补一圈内芯
      ctx.fillStyle = acc;
      const nd = petals + Math.round(spark * 4);
      const sOut = S * (0.014 + 0.016 * spark);
      for (let i = 0; i < nd; i++) {
        const a = ((i + 0.5) / nd) * TAU;
        const x = Math.cos(a) * (rOut + amp * 0.55);
        const y = Math.sin(a) * (rOut + amp * 0.55);
        ctx.fillRect(x - sOut / 2, y - sOut / 2, sOut, sOut);
      }
      if (spark > 0.5) {
        ctx.fillStyle = ink;
        const sIn = S * (0.012 + spark * 0.012);
        for (let i = 0; i < petals; i++) {
          const a = (i / petals) * TAU;
          const x = Math.cos(a) * R0 * 0.5;
          const y = Math.sin(a) * R0 * 0.5;
          ctx.fillRect(x - sIn / 2, y - sIn / 2, sIn, sIn);
        }
      }
    },
  };
}

/* 兜底：几何徽章 */
function genMedallion() {
  return {
    tiles: (P) => gridN(P, 2, 7),
    draw(ctx, S, P, R, C) {
      const ink = C.colors[0] || C.T.ink;
      const acc = C.colors[1] || C.T.pink || C.T.red;
      const d = P.norm(A_DENS, 0.5);
      const jag = P.norm(A_JAG, 0.4);
      const curl = P.norm(A_CURL, 0.4);
      const lw = S * (0.02 + 0.03 * P.norm(A_WGT, 0.45));
      ctx.lineCap = 'round';

      ctx.strokeStyle = ink;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(0, 0, S * 0.34, 0, TAU);
      ctx.stroke();

      const ticks = 8 + Math.round(d * 12);
      ctx.lineWidth = lw * 0.8;
      for (let i = 0; i < ticks; i++) {
        const a = (i / ticks) * TAU;
        const r1 = S * 0.37;
        const r2 = S * (0.42 + (i % 2 ? 0.03 : 0) * jag);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
        ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
        ctx.stroke();
      }

      ctx.strokeStyle = acc;
      ctx.beginPath();
      ctx.moveTo(0, -S * 0.2);
      ctx.lineTo(S * 0.18, S * 0.14);
      ctx.lineTo(-S * 0.18, S * 0.14);
      ctx.closePath();
      ctx.stroke();

      ctx.strokeStyle = ink;
      ctx.beginPath();
      const turns = 1 + curl * 2;
      for (let i = 0; i <= 40; i++) {
        const t = (i / 40) * turns * TAU;
        const rr = (i / 40) * S * 0.1;
        if (i) ctx.lineTo(Math.cos(t) * rr, Math.sin(t) * rr);
        else ctx.moveTo(Math.cos(t) * rr, Math.sin(t) * rr);
      }
      ctx.stroke();
    },
  };
}

const GEN_RULES = [
  { re: /陶|tao|pottery|clay|三星/, make: genPottery },
  { re: /刻纸|剪纸|kezhi|papercut|\bcut\b/, make: genPapercut },
  { re: /符|箓|fulu|talisman|茅山/, make: genTalisman },
  { re: /水|湖|wave|lake|shui|涟|荡/, make: genWater },
  { re: /龙|灯|绣球|lantern|dragon|deng|ball/, make: genLantern },
];

function pickGen(gene) {
  const tag = (gene.name + ' ' + gene.id).toLowerCase();
  for (const r of GEN_RULES) if (r.re.test(tag)) return r.make();
  return genMedallion();
}

/* ---------------- 模块入口 ---------------- */
export function initGene(container, data) {
  if (!container) return;
  if (typeof container.__geneOff === 'function') {
    try {
      container.__geneOff();
    } catch {
      /* 上一轮会话异常也要继续 */
    }
    container.__geneOff = null;
  }

  container.dataset.module = 'gene';

  const genes = normalizeGenes(data);

  /* 容器内既有结构（index.html 提供，绝不回写 HTML） */
  let canvas = container.querySelector('#geneCanvas');
  if (!canvas) canvas = container.querySelector('canvas');
  let controls = container.querySelector('#geneControls');
  let meta = container.querySelector('#geneMeta');
  const kicker = container.querySelector(':scope > .kicker');

  /* —— 空数据：纹样版待上机… —— */
  if (!genes.length || !canvas) {
    container.dataset.status = 'empty';
    const msg = !genes.length ? '纹样版待上机…' : '画布未就绪…';
    const empty = document.createElement('div');
    empty.className = 'gene-empty';
    empty.dataset.geneUi = '1';
    empty.innerHTML = `
      <span class="tape" style="top:-13px; right:12%; transform:rotate(4deg);"></span>
      <span class="kicker">PATTERN PRESS · 纹样车间</span>
      <p class="gene-empty-title">${msg}</p>
      <p class="gene-empty-sub">数据到机后，这里将开出五条金坛纹样基因。</p>
      <div class="halftone gene-empty-bar" aria-hidden="true"></div>`;
    if (kicker && kicker.parentNode) kicker.insertAdjacentElement('afterend', empty);
    else container.insertBefore(empty, container.firstChild);

    const body = container.querySelector('.gene-body');
    if (body) body.hidden = true;
    if (meta) meta.hidden = true;

    container.__geneOff = function () {
      empty.remove();
      if (body) body.hidden = false;
      if (meta) meta.hidden = false;
      container.dataset.status = '';
      container.dataset.module = '';
    };
    return;
  }

  /* ============ 状态 ============ */
  const T = {
    paper: cssVar('--paper', '#e8e0c0'),
    paperCard: cssVar('--paper-card', '#f0e9cf'),
    ink: cssVar('--ink', '#221f1a'),
    inkFaint: cssVar('--ink-faint', '#7a7263'),
    red: cssVar('--riso-red', '#e8452b'),
    pink: cssVar('--riso-pink', '#ff006e'),
    cyan: cssVar('--riso-cyan', '#00ffcc'),
    clay: cssVar('--clay', '#b0603c'),
    bamboo: cssVar('--bamboo', '#5f7a52'),
    lake: cssVar('--lake', '#4a7a8c'),
  };
  const paperRGB = hexToRgb(T.ink); // 复用解析：ink 的 RGB 供半调网点用

  const st = {
    dead: false,
    raf: 0,
    genes,
    gene: genes[0],
    vals: new Map(),
    sym: { mode: 'rotate', folds: 4 },
    aiBusy: false,
    timers: new Map(), // id → resolve：拆除时逐个 resolve，挂起的轮询立刻醒来看到 dead
    ctx: null,
    dpr: 1,
    L: 480, // 逻辑画布边长
    gen: null,
  };

  /* —— 补齐容器（HTML 缺件时自建，不改 index.html 已有内容） —— */
  const parent = canvas.parentNode || container;
  let madeControls = false;
  if (!controls) {
    controls = document.createElement('div');
    controls.id = 'geneControls';
    controls.className = 'gene-controls';
    parent.appendChild(controls);
    madeControls = true;
  }
  let madeMeta = false;
  if (!meta) {
    meta = document.createElement('div');
    meta.id = 'geneMeta';
    meta.className = 'gene-meta';
    container.appendChild(meta);
    madeMeta = true;
  }

  /* —— 离屏画布（DPR 锐化） —— */
  try {
    st.dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    canvas.width = Math.round(st.L * st.dpr);
    canvas.height = Math.round(st.L * st.dpr);
    st.ctx = canvas.getContext('2d');
    if (!st.ctx) throw new Error('no 2d context');
  } catch {
    st.ctx = null;
  }

  /* —— UI：基因签 / 画版框 —— */
  const tabs = document.createElement('div');
  tabs.className = 'gene-tabs';
  tabs.dataset.geneUi = '1';
  tabs.setAttribute('role', 'group');
  tabs.setAttribute('aria-label', '选择纹样基因');
  tabs.innerHTML = genes
    .map(
      (g, i) => `
      <button type="button" class="gene-tab" data-gene="${esc(g.id)}" style="--gi:${i}"
        aria-pressed="${i === 0 ? 'true' : 'false'}">
        <span class="tab-no mono">${String(i + 1).padStart(2, '0')}</span>
        <span class="tab-name">${esc(g.name)}</span>
      </button>`
    )
    .join('');
  if (kicker && kicker.parentNode) kicker.insertAdjacentElement('afterend', tabs);
  else container.insertBefore(tabs, container.firstChild);

  /* 画版：胶带压角的版画 */
  const frame = document.createElement('div');
  frame.className = 'gene-frame';
  frame.dataset.geneUi = '1';
  frame.innerHTML = '<span class="tape" style="top:-13px; left:9%; transform:rotate(-5deg);"></span>';
  canvas.replaceWith(frame);
  frame.appendChild(canvas);
  const caption = document.createElement('span');
  caption.className = 'gene-caption mono';
  frame.appendChild(caption);

  /* —— 每基因一套参数记忆 —— */
  function valsFor(g) {
    let v = st.vals.get(g.id);
    if (!v) {
      v = {};
      st.vals.set(g.id, v);
    }
    for (const p of g.params) if (!Number.isFinite(v[p.key])) v[p.key] = p.def;
    return v;
  }
  valsFor(st.gene);

  /* —— 数值格式 —— */
  function fmtVal(p, v) {
    const range = p.max - p.min;
    let s;
    if (Number.isInteger(p.min) && Number.isInteger(p.max)) s = String(Math.round(v));
    else if (range >= 2) s = String(Math.round(v * 10) / 10);
    else if (range >= 0.2) s = String(Math.round(v * 100) / 100);
    else s = v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
    return p.unit ? s + p.unit : s;
  }

  function stepOf(p) {
    if (Number.isInteger(p.min) && Number.isInteger(p.max)) return 1;
    const r = p.max - p.min;
    return r >= 1 ? 0.1 : r >= 0.2 ? 0.01 : 0.005;
  }

  /* —— 画笔布局：旋钮纸条 —— */
  function buildControls() {
    const g = st.gene;
    const vals = valsFor(g);
    const knobs = g.params
      .map((p, i) => {
        const step = stepOf(p);
        const v = clamp(vals[p.key], p.min, p.max);
        return `
        <label class="gene-knob" style="--ki:${i}">
          <span class="knob-head">
            <span class="knob-label">${esc(p.label)}</span>
            <span class="knob-val mono">${esc(fmtVal(p, v))}</span>
          </span>
          <input type="range" data-pkey="${esc(p.key)}" min="${p.min}" max="${p.max}"
            step="${step}" value="${v}" aria-label="${esc(p.label)}">
        </label>`;
      })
      .join('');

    controls.innerHTML = `
      <div class="gene-sym" data-gene-ui="1">
        <span class="kicker">对称 · SYMMETRY</span>
        <div class="gene-sym-row">
          <button type="button" class="gene-chip" data-sym="none" aria-pressed="false">不对称</button>
          <button type="button" class="gene-chip" data-sym="mirror" aria-pressed="false">轴对称</button>
          <button type="button" class="gene-chip" data-sym="rotate" aria-pressed="true">旋转对称</button>
          <span class="gene-folds" data-folds-row>
            <span class="fold-label mono">重</span>
            <button type="button" class="gene-fold" data-folds="2" aria-pressed="false">2</button>
            <button type="button" class="gene-fold" data-folds="3" aria-pressed="false">3</button>
            <button type="button" class="gene-fold" data-folds="4" aria-pressed="true">4</button>
            <button type="button" class="gene-fold" data-folds="6" aria-pressed="false">6</button>
            <button type="button" class="gene-fold" data-folds="8" aria-pressed="false">8</button>
          </span>
        </div>
      </div>
      <div class="gene-knobs" data-gene-ui="1">
        ${knobs || '<p class="gene-knob-empty mono">本条基因暂无参数旋钮</p>'}
      </div>
      <div class="gene-actions" data-gene-ui="1">
        <button type="button" class="btn primary" data-act="print">拓印一张</button>
        <button type="button" class="btn" data-act="ai">AI 生图</button>
      </div>
      <p class="gene-status mono" aria-live="polite" data-gene-ui="1"></p>`;
    syncSymUI();
  }

  function syncSymUI() {
    controls.querySelectorAll('[data-sym]').forEach((b) => {
      b.setAttribute('aria-pressed', b.dataset.sym === st.sym.mode ? 'true' : 'false');
    });
    const row = controls.querySelector('[data-folds-row]');
    if (row) row.hidden = st.sym.mode !== 'rotate';
    controls.querySelectorAll('[data-folds]').forEach((b) => {
      b.setAttribute(
        'aria-pressed',
        Number(b.dataset.folds) === st.sym.folds ? 'true' : 'false'
      );
    });
  }

  function statusEl() {
    return controls.querySelector('.gene-status');
  }

  function setStatus(text, isErr) {
    const el = statusEl();
    if (!el || st.dead) return;
    el.textContent = text || '';
    el.classList.toggle('is-err', !!isErr);
  }

  /* —— meta：源流 / 色板 / AI 成图 —— */
  let flashEl = null;
  let aiSlot = null;
  let flashTimer = 0;

  function buildMeta() {
    const g = st.gene;
    // 保留已生成的 AI 图（换基因不清空用户成果）
    // 注意：aiSlot 首个子节点是「成图 · AI PRINT」小标题，成图是后续 figure，
    // 只留 firstElementChild 会丢图并留下悬空标题 —— 整段 innerHTML 原样保留
    let keep = '';
    if (aiSlot && aiSlot.isConnected && aiSlot.childElementCount) keep = aiSlot.innerHTML;

    meta.innerHTML = `
      <div class="gene-meta-main" data-gene-ui="1">
        ${g.source ? `<span class="kicker">源流 · SOURCE</span><p class="gene-source mono">${esc(g.source)}</p>` : ''}
        ${g.story ? `<span class="kicker">基因故事 · STORY</span><p class="gene-story">${esc(g.story)}</p>` : ''}
        ${!g.source && !g.story ? '<p class="gene-story">本条基因暂无源流记录。</p>' : ''}
      </div>
      <div class="gene-meta-side" data-gene-ui="1">
        <span class="kicker">色板 · PALETTE</span>
        <div class="gene-palette">${
          g.palette.length
            ? g.palette
                .map(
                  (c) =>
                    `<button type="button" class="gene-swatch" data-hex="${esc(c)}" style="--sw:${esc(c)}" aria-label="复制色值 ${esc(c)}"></button>`
                )
                .join('')
            : '<span class="gene-palette-none mono">暂无色板</span>'
        }</div>
        <p class="gene-flash mono" aria-live="polite"></p>
      </div>
      <div class="gene-ai" data-gene-ui="1"></div>`;

    flashEl = meta.querySelector('.gene-flash');
    aiSlot = meta.querySelector('.gene-ai');
    if (keep) aiSlot.innerHTML = keep;
  }

  function flash(text, ok) {
    if (!flashEl || st.dead) return;
    flashEl.textContent = text;
    flashEl.classList.toggle('is-err', !ok);
    window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => {
      if (flashEl) flashEl.textContent = '';
    }, 2200);
  }

  async function copyHex(hex) {
    let ok = false;
    try {
      await navigator.clipboard.writeText(hex);
      ok = true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = hex;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      } catch {
        ok = false;
      }
    }
    flash(ok ? hex + ' 已复制' : '复制失败：' + hex, ok);
  }

  /* ============ 渲染（确定性纹样 + 对称落版，rAF 节流） ============ */
  function seedOf(gene, vals) {
    const parts = [gene.id, gene.name];
    for (const p of gene.params) parts.push(p.key + '=' + vals[p.key]);
    // 注意：seed 只由「基因 + 参数」决定（同参数同图）；对称只改变落版方式
    return hashStr(parts.join('|'));
  }

  function paletteFor(gene, vals) {
    let colors = gene.palette.slice();
    if (!colors.length) colors = [T.ink, T.red, T.lake];
    // 色相偏移参数（数据里若有 hue 类 key）
    const hueP = gene.params.find(
      (p) => /hue|色相|偏色/i.test(p.key) || /色相|偏色/.test(p.label)
    );
    if (hueP) {
      const v = vals[hueP.key];
      const range = hueP.max - hueP.min;
      const deg = range > 12 ? v : ((v - hueP.min) / range) * 360;
      if (deg) colors = colors.map((c) => shiftHue(c, deg));
    }
    return colors;
  }

  function drawFrameMarks(ctx, seed) {
    // 版框
    ctx.strokeStyle = 'rgba(' + paperRGB.r + ',' + paperRGB.g + ',' + paperRGB.b + ',0.8)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(4.5, 4.5, st.L - 9, st.L - 9);
    // 角上的套准十字
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(' + paperRGB.r + ',' + paperRGB.g + ',' + paperRGB.b + ',0.55)';
    const m = 14;
    const corners = [
      [m, m],
      [st.L - m, m],
      [m, st.L - m],
      [st.L - m, st.L - m],
    ];
    for (const [x, y] of corners) {
      ctx.beginPath();
      ctx.moveTo(x - 6, y);
      ctx.lineTo(x + 6, y);
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x, y + 6);
      ctx.stroke();
    }
    // 版号（等宽小字，像印厂打样）
    ctx.fillStyle = 'rgba(' + paperRGB.r + ',' + paperRGB.g + ',' + paperRGB.b + ',0.5)';
    ctx.font = '11px ' + cssVar('--font-mono', '"Courier New", monospace');
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('JINSHA PATTERN · ' + seed.toString(16).toUpperCase().padStart(8, '0'), st.L - 16, st.L - 16);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  function render() {
    const ctx = st.ctx;
    if (!ctx || st.dead || !st.gene) return;
    const g = st.gene;
    const vals = valsFor(g);
    const P = makeP(vals, g.params);
    const gen = st.gen || (st.gen = pickGen(g));
    const n = gen.tiles(P);
    const cell = st.L / n;
    const seed = seedOf(g, vals);
    const colors = paletteFor(g, vals);

    ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);

    // 纸底 + 极淡半调网点（印张质感）
    ctx.globalAlpha = 1;
    ctx.fillStyle = T.paper;
    ctx.fillRect(0, 0, st.L, st.L);
    ctx.fillStyle =
      'rgba(' + paperRGB.r + ',' + paperRGB.g + ',' + paperRGB.b + ',0.075)';
    for (let y = 3; y < st.L; y += 7) {
      for (let x = 3; x < st.L; x += 7) ctx.fillRect(x, y, 1.2, 1.2);
    }

    // 母题格 → 离屏（保证对称复制完全一致）
    const tp = Math.max(8, Math.ceil(cell * st.dpr));
    // 每格独立流：格坐标参与，格与格不同但完全稳定
    const cellSeed = (s, gx, gy) => mulberry32((s + gx * 374761393 + gy * 668265263) >>> 0);
    const C = { colors, T, paper: T.paper };

    // 逐格母题 → 离屏缓存数组（格间不同、同参稳定）
    const tiles = [];
    for (let gy = 0; gy < n; gy++) {
      for (let gx = 0; gx < n; gx++) {
        const tc = document.createElement('canvas');
        tc.width = tp;
        tc.height = tp;
        tiles.push(tc); // 先占位，保证 tiles[i] 与格坐标一一对应
        const tcx = tc.getContext('2d');
        if (!tcx) continue;
        tcx.setTransform(tp / cell, 0, 0, tp / cell, 0, 0);
        tcx.translate(cell / 2, cell / 2);
        gen.draw(tcx, cell * 0.96, P, cellSeed(seed, gx, gy), C);
      }
    }

    const blit = (img, gx, gy, dx, dy, alpha, tint) => {
      const cx = (gx + 0.5) * cell + dx;
      const cy = (gy + 0.5) * cell + dy;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(cx, cy);
      // 裁在本格内：旋转/镜像不出格，像真正的拼版
      ctx.beginPath();
      ctx.rect(-cell / 2, -cell / 2, cell, cell);
      ctx.clip();
      const put = () => ctx.drawImage(img, -cell / 2, -cell / 2, cell, cell);
      if (tint) {
        // riso 套印：把母题整体压成套印色
        const tc2 = tinted.get(img);
        if (tc2) ctx.drawImage(tc2, -cell / 2, -cell / 2, cell, cell);
        else put();
        ctx.restore();
        return;
      }
      if (st.sym.mode === 'rotate') {
        const k = clamp(Math.round(st.sym.folds), 2, 8);
        for (let i = 0; i < k; i++) {
          ctx.save();
          ctx.rotate((i * TAU) / k);
          put();
          ctx.restore();
        }
      } else if (st.sym.mode === 'mirror') {
        put();
        ctx.save();
        ctx.scale(-1, 1);
        put();
        ctx.restore();
        ctx.save();
        ctx.scale(1, -1);
        put();
        ctx.restore();
        ctx.save();
        ctx.scale(-1, -1);
        put();
        ctx.restore();
      } else {
        put();
      }
      ctx.restore();
    };

    // 染色缓存（riso 粉套印层）
    const tinted = new Map();
    for (const t of tiles) {
      const c = document.createElement('canvas');
      c.width = tp;
      c.height = tp;
      const cx2 = c.getContext('2d');
      if (!cx2) continue;
      cx2.drawImage(t, 0, 0);
      cx2.globalCompositeOperation = 'source-atop';
      cx2.fillStyle = T.pink;
      cx2.fillRect(0, 0, tp, tp);
      tinted.set(t, c);
    }

    // 两遍落版：先错位粉版，再墨版
    for (let gy = 0; gy < n; gy++) {
      for (let gx = 0; gx < n; gx++) {
        const t = tiles[gy * n + gx];
        if (t) blit(t, gx, gy, 2.5, 1.5, 0.3, true);
      }
    }
    for (let gy = 0; gy < n; gy++) {
      for (let gx = 0; gx < n; gx++) {
        const t = tiles[gy * n + gx];
        if (t) blit(t, gx, gy, 0, 0, 1, false);
      }
    }

    drawFrameMarks(ctx, seed);

    if (caption) {
      caption.innerHTML = `<span>SEED ${seed.toString(16).toUpperCase().padStart(8, '0')}</span><span>${n}×${n} 格 · 同参数同图</span>`;
    }
  }

  let pendingRaf = 0;
  function requestRender() {
    if (st.dead) return;
    if (pendingRaf) return;
    pendingRaf = requestAnimationFrame(() => {
      pendingRaf = 0;
      render();
    });
  }

  /* ============ 交互 ============ */
  function switchGene(id) {
    const g = st.genes.find((x) => x.id === id);
    if (!g) return;
    tabs.querySelectorAll('.gene-tab').forEach((b) => {
      b.setAttribute('aria-pressed', b.dataset.gene === id ? 'true' : 'false');
    });
    if (g !== st.gene) {
      st.gene = g;
      st.gen = pickGen(g);
      valsFor(g);
      buildControls();
      buildMeta();
      setStatus('');
      requestRender();
    }
  }

  function onInput(e) {
    const inp = e.target;
    if (!inp || inp.type !== 'range' || !inp.dataset || !inp.dataset.pkey) return;
    const g = st.gene;
    const p = g.params.find((x) => x.key === inp.dataset.pkey);
    if (!p) return;
    const v = clamp(Number(inp.value), p.min, p.max);
    valsFor(g)[p.key] = v;
    const head = inp.closest('.gene-knob');
    const val = head && head.querySelector('.knob-val');
    if (val) val.textContent = fmtVal(p, v);
    requestRender();
  }

  function onClick(e) {
    const t = e.target;
    if (!t || !t.closest) return;

    const tab = t.closest('.gene-tab');
    if (tab && container.contains(tab)) {
      switchGene(tab.dataset.gene);
      return;
    }

    const symBtn = t.closest('[data-sym]');
    if (symBtn && controls.contains(symBtn)) {
      st.sym.mode = symBtn.dataset.sym;
      syncSymUI();
      requestRender();
      return;
    }

    const foldBtn = t.closest('[data-folds]');
    if (foldBtn && controls.contains(foldBtn)) {
      st.sym.folds = clamp(Number(foldBtn.dataset.folds), 2, 8);
      syncSymUI();
      requestRender();
      return;
    }

    const sw = t.closest('.gene-swatch');
    if (sw && meta.contains(sw)) {
      copyHex(sw.dataset.hex || '');
      return;
    }

    const act = t.closest('[data-act]');
    if (act && controls.contains(act)) {
      if (act.dataset.act === 'print') exportPNG(act);
      else if (act.dataset.act === 'ai') aiGenerate(act);
    }
  }

  /* —— 拓印：导出 PNG —— */
  function exportPNG(btn) {
    try {
      const name = (st.gene ? st.gene.name : '纹样') + '-拓印.png';
      const done = (url, revoke) => {
        try {
          const a = document.createElement('a');
          a.href = url;
          a.download = name;
          document.body.appendChild(a);
          a.click();
          a.remove();
          if (revoke) window.setTimeout(() => URL.revokeObjectURL(url), 5000);
          setStatus('已拓印：' + name);
        } catch {
          setStatus('拓印失败，请稍后再试', true);
        }
      };
      if (canvas.toBlob) {
        canvas.toBlob((blob) => {
          if (!blob) {
            setStatus('拓印失败，请稍后再试', true);
            return;
          }
          done(URL.createObjectURL(blob), true);
        }, 'image/png');
      } else {
        done(canvas.toDataURL('image/png'), false);
      }
      if (btn) btn.blur();
    } catch {
      setStatus('拓印失败，请稍后再试', true);
    }
  }

  /* —— AI 生图：基因名 + 当前参数 → /api/generate-image → 轮询出图 —— */
  function buildPrompt() {
    const g = st.gene;
    const vals = valsFor(g);
    const bits = g.params.map((p) => p.label + ' ' + fmtVal(p, vals[p.key]));
    return [
      g.name + ' 非遗纹样图案设计',
      bits.join('，'),
      '中国传统纹样，平铺图案，米黄纸底，版画质感，居中构图，无文字',
    ].join('，');
  }

  const sleep = (ms) =>
    new Promise((resolve) => {
      const id = window.setTimeout(() => {
        st.timers.delete(id);
        resolve();
      }, ms);
      st.timers.set(id, resolve);
    });

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
        continue; // 瞬时失败：继续轮询，超时兜底
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
    }
    throw new Error('超时未出图');
  }

  async function aiGenerate(btn) {
    if (st.aiBusy || st.dead) return;
    st.aiBusy = true;
    if (btn) btn.disabled = true;
    const gName = st.gene ? st.gene.name : '金坛纹样'; // 提交瞬间的基因名，轮询十几秒内换基因也标注正确的出处
    setStatus('文生图任务已提交，出图约需十几秒…');
    try {
      const r = await fetch('api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: buildPrompt() }),
      });
      if (!r.ok) throw new Error('提交失败 ' + r.status);
      const j = await r.json();
      if (!j.taskId) throw new Error(j.error || '未拿到任务号');
      const url = await pollTask(j.taskId);
      if (st.dead) return;
      if (aiSlot) {
        aiSlot.innerHTML = `
          <span class="kicker">成图 · AI PRINT</span>
          <figure class="gene-ai-fig">
            <span class="tape" style="top:-12px; right:9%; transform:rotate(4deg);"></span>
            <img src="${esc(url)}" alt="${esc(gName)} 的 AI 生成纹样" loading="lazy">
            <figcaption class="mono">AI 生图 · ${esc(gName)}</figcaption>
          </figure>`;
      }
      setStatus('成图已贴入下方');
    } catch (e) {
      if (st.dead) return;
      const msg = e && e.message ? e.message : String(e);
      setStatus('生图未成功（' + msg + '），可稍后再试', true);
    } finally {
      st.aiBusy = false;
      if (btn && btn.isConnected) btn.disabled = false;
    }
  }

  /* —— 事件（委托在容器上，重渲染不丢） —— */
  container.addEventListener('click', onClick);
  container.addEventListener('input', onInput);

  /* ============ 启动 ============ */
  st.gen = pickGen(st.gene);
  buildControls();
  buildMeta();
  render();

  container.__geneOff = function () {
    st.dead = true;
    if (pendingRaf) cancelAnimationFrame(pendingRaf);
    st.timers.forEach((resolve, id) => {
      window.clearTimeout(id);
      resolve();
    });
    st.timers.clear();
    window.clearTimeout(flashTimer);
    container.removeEventListener('click', onClick);
    container.removeEventListener('input', onInput);
    // 先把画布从画版里放回原位，再拆注入的 UI
    // （frame 带 data-gene-ui，若先清场画布会随画版一起被摘走，二次 init 就找不到画布）
    if (frame.isConnected) frame.replaceWith(canvas);
    else if (!canvas.isConnected) parent.appendChild(canvas);
    container.querySelectorAll('[data-gene-ui]').forEach((el) => el.remove());
    controls.innerHTML = '';
    meta.innerHTML = '';
    if (madeControls) controls.remove();
    if (madeMeta) meta.remove();
    container.dataset.status = '';
    container.dataset.module = '';
  };
}
