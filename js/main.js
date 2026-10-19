/* 金沙文枢 — 主编排：装配文案、挂载七端模块、滚动与导航 */

import { initMap } from './modules/map.js';
import { initChat } from './modules/chat.js';
import { initHuarongdao } from './modules/huarongdao.js';
import { initYaji } from './modules/yaji.js';
import { initQuiz } from './modules/quiz.js';
import { initGene } from './modules/gene.js';
import { initSpace } from './modules/space.js';

const $ = (sel, root = document) => root.querySelector(sel);

/* 文案字段走模板拼 HTML 前一律转义——story.json 若被改动/联调注入，
   裸插会直接开 XSS 口子（modules 里每个拼 HTML 的模块早已有同款） */
const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

async function loadJSON(name) {
  try {
    const r = await fetch(`data/${name}.json`);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/* ---------- 文案注入 ---------- */
function paintStory(story) {
  if (!story) return;
  if (story.heroTitle) $('#heroTitle').textContent = story.heroTitle;
  if (story.heroSub) $('#heroSub').textContent = story.heroSub;
  if (story.footer) $('#footerText').textContent = story.footer;

  const nav = $('#navLinks');
  if (Array.isArray(story.nav)) {
    nav.innerHTML = story.nav
      .map((n) => `<li><a href="#${esc(n.id)}">${esc(n.label)}</a></li>`)
      .join('');
  }

  const acts = $('#acts');
  if (Array.isArray(story.acts)) {
    acts.innerHTML = story.acts
      .map(
        (a, i) => `
      <article class="act reveal" style="--act-i:${i}">
        <span class="act-kicker kicker">${esc(a.kicker)}</span>
        <h3>${esc(a.title)}</h3>
        <p>${esc(a.body)}</p>
        <span class="act-no mono">${String(i + 1).padStart(2, '0')}</span>
      </article>`
      )
      .join('');
  }
}

function paintVision() {
  const body = $('#visionBody');
  if (!body || body.childElementCount) return;
  const stages = [
    {
      tag: 'STAGE 01 · 0–6 月',
      title: '场景验证 · B2G',
      body: '数字导览与研学 SaaS 落进文旅局、景区与学校，项目制加年服务费；先在金坛把 18 个点位与四端跑通。',
    },
    {
      tag: 'STAGE 02 · 6–18 月',
      title: '文创增量 · B2B2C',
      body: '审美基因编辑器接 C2M 打样，游客改纹样、文创品牌接单，交易分成；东方盐湖城与茅山民宿集群首攻。',
    },
    {
      tag: 'STAGE 03 · 18–36 月',
      title: '平台开放 · 长三角',
      body: '文化数据资产与基因 API 授权，向长三角文旅与联名品牌开放；产业叙事结构沉淀为可复用的 B 端方案生成器。',
    },
  ];
  body.innerHTML =
    stages
      .map(
        (s, i) => `
      <article class="v-card reveal" style="--act-i:${i}">
        <span class="act-kicker kicker">${s.tag}</span>
        <h3>${s.title}</h3>
        <p>${s.body}</p>
      </article>`
      )
      .join('');
}

function paintMeta() {
  const el = $('#heroMeta');
  if (!el) return;
  el.textContent = [
    '三星村遗址 6500 年',
    '茅山 · 道文化',
    '长荡湖 · 湖鲜',
    '东方盐湖城 · 道天下',
  ].join('　·　');
}

/* ---------- 导航 ---------- */
function bootNav() {
  const toggle = $('#navToggle');
  const links = $('#navLinks');
  toggle.addEventListener('click', () => links.classList.toggle('open'));
  links.addEventListener('click', (e) => {
    if (e.target.tagName === 'A') links.classList.remove('open');
  });

  const sections = [...document.querySelectorAll('main .section')];
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const id = en.target.id;
        links.querySelectorAll('a').forEach((a) => {
          a.classList.toggle('active', a.getAttribute('href') === `#${id}`);
        });
      });
    },
    { rootMargin: '-40% 0px -55% 0px' }
  );
  sections.forEach((s) => io.observe(s));
}

/* ---------- 滚动进场 ---------- */
function bootReveal() {
  // 区块骨架补挂进场：小标题先、主体依次错落（--act-i 控制 90ms 步进）
  document.querySelectorAll('main .section:not(.hero)').forEach((sec) => {
    const head = sec.querySelector(':scope > .section-head');
    if (head) {
      head.classList.add('reveal');
      head.style.setProperty('--act-i', 0);
    }
    const bodies = sec.querySelectorAll(
      ':scope > .map-shell, :scope > .chat-shell, :scope > .play-tabs, :scope > .play-stage, :scope > .create-grid, :scope > .space-shell'
    );
    bodies.forEach((el, i) => {
      el.classList.add('reveal');
      el.style.setProperty('--act-i', i + 1);
    });
  });
  const foot = document.querySelector('.site-footer');
  if (foot) foot.classList.add('reveal');

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) {
          en.target.classList.add('in');
          io.unobserve(en.target);
        }
      });
    },
    { threshold: 0.12 }
  );
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
  // 动态插入的元素在下一帧补挂
  requestAnimationFrame(() => {
    document.querySelectorAll('.reveal:not(.in)').forEach((el) => io.observe(el));
  });
}

/* ---------- 游戏页签 ---------- */
function bootPlayTabs() {
  const tabs = $('#playTabs');
  const panes = { hrd: $('#paneHrd'), yaji: $('#paneYaji'), quiz: $('#paneQuiz') };
  tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
    Object.entries(panes).forEach(([k, pane]) => (pane.hidden = k !== btn.dataset.tab));
    // 首次切换时惰性初始化
    const key = btn.dataset.tab;
    const pane = panes[key];
    if (pane && !pane.__inited) {
      pane.__inited = 1;
      if (key === 'hrd') initHuarongdao(pane);
      if (key === 'yaji') initYaji(pane);
      if (key === 'quiz') initQuiz(pane);
    }
  });
}

/* ---------- 后端探活（GitHub Pages 静态托管没有 /api/*） ---------- */
async function probeBackend() {
  const be = { srv: false, ai: false };
  const onPages = location.hostname === 'github.io' || location.hostname.endsWith('.github.io');
  if (!onPages) {
    // 静态域名上探活只会白吃一个 404；其余域名（本地/自部署）真实探测
    try {
      const r = await fetch('api/health', { cache: 'no-store' });
      const j = await r.json();
      be.srv = !!(r.ok && j.ok);
      be.ai = be.srv && !!j.hasKey;
    } catch { /* 无后端：静态降级 */ }
  }
  window.__BACKEND__ = be;
  document.body.classList.toggle('no-srv', !be.srv);
  document.body.classList.toggle('no-ai', !be.ai);
}

/* ---------- 启动 ---------- */
async function boot() {
  paintMeta();
  bootNav();
  await probeBackend();

  const [story, points, personas, quiz, games, gene] = await Promise.all([
    loadJSON('story'),
    loadJSON('points'),
    loadJSON('personas'),
    loadJSON('quiz'),
    loadJSON('games'),
    loadJSON('gene'),
  ]);

  paintStory(story);
  paintVision();

  initMap($('#mapShell'), points);
  initChat($('#chatShell'), personas);

  // 玩学三件套（惰性，但数据先喂）
  window.__PLAY_DATA__ = { quiz, games };
  window.__GENE_DATA__ = gene;

  // 首屏页签默认初始化
  const firstPane = $('#paneHrd');
  if (firstPane && !firstPane.__inited) {
    initHuarongdao(firstPane);
    firstPane.__inited = 1;
  }
  bootPlayTabs();

  initGene($('#geneCard'), gene);
  initSpace($('#spaceShell'), points);

  bootReveal();
}

boot();
