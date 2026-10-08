/* ============================================================
   文人雅集 —— 金坛五文人卡牌对战（Lo-Fi 手账）
   算法移植自前身项目 yanghu-yaji：buildDeck / drawC / nextTurn /
   doPlay / selCard 对局循环 + 本地启发式 AI + 战斗日志 + 四屏切换
   材质按 tokens.css 重绘：印刷卡纸（硬边 / mono 编号 / 衬线卡名 /
   背面半调网点），桌面纸黄，riso 错位，硬偏移阴影
   导出：export function initYaji(pane)  // #paneYaji，幂等
   数据：window.__PLAY_DATA__.games.yaji（characters / treasures；
         数据为空时用前身项目真实内容兜底，绝不现编）
   ============================================================ */

/* ---------------- 牌库定义（逐字移植前身项目） ---------------- */
const CARD_DEFS = {
  lilun:         { name: '立论',     type: 'article', sub: '散文', effect: '造成1点文气损伤',   cat: 'atk' },
  bianbo:        { name: '辩驳',     type: 'article', sub: '散文', effect: '抵消一次立论损伤',   cat: 'def' },
  dayunshanfang: { name: '大云山房', type: 'article', sub: '散文', effect: '立论+骈文属性',     cat: 'atk', sp: 1 },
  mingkewen:     { name: '茗柯文',   type: 'article', sub: '散文', effect: '立论+摸1张牌',      cat: 'atk', sp: 1, draw: 1 },
  pianwenchao:   { name: '骈体文钞', type: 'article', sub: '骈文', effect: '立论+骈散双属性',   cat: 'atk', sp: 1 },
  qijiawenchao:  { name: '七家文钞', type: 'article', sub: '散文', effect: '立论+弃目标1牌',    cat: 'atk', sp: 1, disc: 1 },
  futangci:      { name: '复堂词',   type: 'article', sub: '词',   effect: '立论+诗词属性',     cat: 'atk', sp: 1 },
  yangyizhai:    { name: '养一斋集', type: 'article', sub: '散文', effect: '立论+回复1文气',    cat: 'atk', sp: 1, heal: 1 },
  diyiliu:       { name: '第一流',   type: 'jj', effect: '本回合立论伤害+1',   cat: 'spc' },
  zilichu:       { name: '自立处',   type: 'jj', effect: '抵消一次境界牌效果', cat: 'spc' },
  jiwendao:      { name: '济文道',   type: 'jj', effect: '弃1牌令己摸2牌',     cat: 'spc' },
  piansanhe:     { name: '骈散合',   type: 'jj', effect: '立论视为骈散双属性', cat: 'spc' },
  yineiyanwai:   { name: '意内言外', type: 'jj', effect: '受损伤时摸1张牌',    cat: 'spc' },
  jingshiwen:    { name: '经世文',   type: 'jj', effect: '弃1牌弃目标1张文章牌', cat: 'spc' },
  bulizong:      { name: '不立宗',   type: 'jj', effect: '免疫一次门派效果',   cat: 'spc' },
  xingqingzhen:  { name: '性情真',   type: 'jj', effect: '回复1点文气',        cat: 'hel' },
  boxueyang:     { name: '博学养',   type: 'jj', effect: '摸2张牌',            cat: 'spc' },
  tongchetu:     { name: '同车图',   type: 'zy', effect: '回复1点文气',        cat: 'hel' },
  lunwentie:     { name: '论文帖',   type: 'zy', effect: '回复1文气可弃牌再回1', cat: 'hel' },
  yanghuhui:     { name: '阳湖会',   type: 'zy', effect: '所有角色各回复1文气', cat: 'hel' },
  v1:            { name: '第一流',   type: 'vic', effect: '流派标识·集齐四张成宗', cat: 'vic' },
  v2:            { name: '自立处',   type: 'vic', effect: '流派标识·集齐四张成宗', cat: 'vic' },
  v3:            { name: '济文道',   type: 'vic', effect: '流派标识·集齐四张成宗', cat: 'vic' },
  v4:            { name: '骈散合',   type: 'vic', effect: '流派标识·集齐四张成宗', cat: 'vic' },
};

const DECK_KEYS = [
  ...Array(15).fill('lilun'),
  ...Array(15).fill('bianbo'),
  'dayunshanfang', 'mingkewen', 'pianwenchao', 'qijiawenchao', 'futangci', 'yangyizhai',
  'diyiliu', 'zilichu', 'jiwendao', 'piansanhe', 'yineiyanwai', 'jingshiwen', 'bulizong', 'xingqingzhen', 'boxueyang',
  'tongchetu', 'lunwentie', 'yanghuhui',
  'v1', 'v2', 'v3', 'v4',
];

/* 雅集题词（前身项目原文） */
const QUOTES = [
  '文章之道，以意为先，以气为主。——恽敬',
  '意内言外，词之为教也。——张惠言',
  '骈散合一，文之正道也。——李兆洛',
  '文以载道，学以致用。——陆继辂',
  '文章须自出机杼，成一家风骨。——恽敬',
];

/* ---------------- 兜底数据（前身项目真实内容，逐字取用） ---------------- */
const NAME_ID = {
  '恽敬': 'yujing', '张惠言': 'zhanghuiyan', '李兆洛': 'lizhaoluo',
  '陆继辂': 'lujilu', '董士锡': 'dongshixi',
};

const IMG_MAP = {
  '恽敬': 'yujing.jpg', '张惠言': 'zhanghuiyan.jpg', '李兆洛': 'lizhaoluo.jpg',
  '陆继辂': 'lujilu.jpg', '董士锡': 'dongshixi.jpg',
  '乱针绣': 'luanzhenxiu.jpg', '大麻糕': 'damagao.jpg',
  '梳篦': 'shubi.jpg', '留青竹刻': 'liuqingzhuke.jpg',
};

const FALLBACK_CHARS = [
  { id: 'yujing', name: '恽敬', title: '奇峻之士', qi: 6, skill: '奇正相生', desc: '使用散文牌伤害时可弃骈文牌令伤害+1',
    history: '恽敬（1757—1817），字子居，号简堂，阳湖（今常州武进）人。清代著名散文家，阳湖派创始人之一。工古文，兼取骈散之长，文风峻拔奇崛，气势雄浑。与张惠言并称「阳湖二家」，著有《大云山房文稿》。恽敬论文主张「义法」与「气骨」并重，强调文章须有真性情、真见识，反对空疏无物。其文论对清代散文发展影响深远，为阳湖文派奠定了理论基础。' },
  { id: 'zhanghuiyan', name: '张惠言', title: '意内言外', qi: 6, skill: '缘情造端', desc: '受损伤后立即摸两张牌',
    history: '张惠言（1761—1802），字皋文，阳湖（今常州武进）人。清代著名经学家、文学家、词人，阳湖派代表人物。精研《周易》《仪礼》，为常州词派开山鼻祖。张惠言词作强调「意内言外」，主张词要有寄托，以比兴手法表达深沉情感，开创了常州词派的美学传统。编有《词选》，影响了整个清代词坛。同时擅古文，与恽敬齐名，著有《茗柯文编》。' },
  { id: 'lizhaoluo', name: '李兆洛', title: '通儒达识', qi: 6, skill: '骈散相杂', desc: '可将骈文牌当散文牌使用',
    history: '李兆洛（1769—1841），字申耆，阳湖（今常州武进）人。清代著名学者、文学家、地理学家，阳湖派重要成员。博学多才，通经史、天文、地理、历算，编纂《骈体文钞》主张骈散合一，打破了当时骈散文对立的僵局。李兆洛认为骈文与散文各有优长，应相互借鉴融合，此论对清代文坛影响深远。主讲江阴暨阳书院近二十年，门下人才辈出。' },
  { id: 'lujilu', name: '陆继辂', title: '志节之士', qi: 6, skill: '七家文选', desc: '弃一张牌令角色摸或弃一张牌',
    history: '陆继辂（1772—1834），字祁孙，阳湖（今常州武进）人。清代文学家、诗人，阳湖派骨干成员。工诗文，风格清刚峻洁，与恽敬、张惠言交游密切。编有《七家文钞》，选录阳湖派七位代表作家的古文作品，是研究阳湖文派的重要文献。陆继辂为人耿介，论文章气节，主张文品即人品，文章须有志节之气方能传世。' },
  { id: 'dongshixi', name: '董士锡', title: '瑰辞朴学', qi: 6, skill: '研咏博访', desc: '文章牌被响应后各摸一牌',
    history: '董士锡（1782—1831），字晋卿，阳湖（今常州武进）人。清代经学家、文学家，阳湖派后期代表人物，张惠言外甥。幼承家学，精研经术，兼擅诗词古文。董士锡学问渊博，融通经学与文学，主张「以朴学为根柢，以瑰辞为华采」，将考据之功与辞章之美结合。其文风典雅醇厚，深得阳湖派精髓。著有《齐物论斋文集》，为阳湖文派后期的重要著作。' },
];

const FALLBACK_TREASURES = [
  { id: 'luanzhenxiu', name: '乱针绣', title: '绣心护体', desc: '武进乱针绣，以针为笔，以线为墨，绣出万千气象。',
    effect: '使用后获得护盾：下次受伤害30%概率闪避',
    history: '乱针绣由常州武进人杨守玉于1930年代独创。她将西洋绘画的色彩理论与中国传统刺绣技艺融合，以长短交叉、分层加色的针法打破传统刺绣「密接其针、排比其线」的规则，形成「以针为笔、以线为色」的独特艺术风格。乱针绣作品远观如油画般色彩斑斓，近看则针法细腻、层次分明，被誉为中国刺绣艺术的一大突破，2007年列入江苏省非物质文化遗产名录。' },
  { id: 'damagao', name: '大麻糕', title: '麻糕充饥', desc: '武进大麻糕，香甜酥脆，一口下去，精神百倍。',
    effect: '使用后恢复2点文气',
    history: '大麻糕是常州武进地区的传统名点，始于清咸丰年间，至今已有百余年历史。以面粉、芝麻、猪油、白糖为主要原料，经揉面、包馅、压模、烘烤等工序制成。成品色泽金黄、香甜酥脆、入口即化，是常州人逢年过节、走亲访友的必备糕点。大麻糕制作技艺于2009年列入常州市非物质文化遗产名录，承载着武进人世代相传的味觉记忆。' },
  { id: 'shubi', name: '梳篦', title: '梳篦理绪', desc: '常州梳篦，梳理千丝万缕，理清纷乱思绪。',
    effect: '使用后摸2张牌',
    history: '常州梳篦制作始于东晋，距今已有一千六百余年历史。以黄杨木为料，经选料、开片、拉花、刻花等七十余道工序精制而成。梳篦齿密而不挂发，篦发去垢而不伤头皮，兼具实用与观赏价值。常州梳篦在明清时期被列为贡品，有「宫梳名篦」之美誉。其制作技艺于2008年列入国家级非物质文化遗产名录，是中国传统手工艺的瑰宝。' },
  { id: 'liuqingzhuke', name: '留青竹刻', title: '竹刻铭记', desc: '留青竹刻，以刀代笔，在竹上铭记千古文章。',
    effect: '查看对手全部手牌并弃掉其1张',
    history: '留青竹刻始于唐代，兴盛于明清，是常州武进的传统竹刻艺术。其技法独特——利用竹皮青筠的厚薄变化表现画面层次，铲去花纹以外的竹皮，留下青筠作为图案，故名「留青」。作品刀法细腻、层次分明、意境深远，集书画、雕刻于一体。常州留青竹刻于2008年列入国家级非物质文化遗产名录，代表了中国竹刻艺术的最高水平。' },
];

/* 宝物效果按名归类（有 data.effect 文案时以文案展示，效果键仍按名） */
const TR_RULE = { '乱针绣': 'shield', '大麻糕': 'heal2', '梳篦': 'draw2', '留青竹刻': 'peek' };

/* ---------------- 小工具 ---------------- */
const $ = (sel, root) => root.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function esc(s) {
  return String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function reduced() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function shuffle(a) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const t = b[i]; b[i] = b[j]; b[j] = t;
  }
  return b;
}

const pad = (n) => String(n).padStart(2, '0');

function asset(name) {
  return name ? '/assets/yaji/' + name : '';
}

/* ---------------- 数据归一 ---------------- */
function normChar(c, i) {
  if (!c || typeof c !== 'object') return null;
  const name = String(c.name || '').trim();
  if (!name) return null;
  return {
    id: String(c.id || NAME_ID[name] || 'ch' + i),
    name,
    title: String(c.title || ''),
    qi: Number.isFinite(Number(c.qi)) && Number(c.qi) > 0 ? Number(c.qi) : 6,
    skill: String(c.skill || ''),
    blurb: String(c.blurb || c.desc || ''),
    history: String(c.history || ''),
    img: c.img ? String(c.img) : asset(IMG_MAP[name] || ''),
  };
}

function normTreasure(t, i) {
  if (!t || typeof t !== 'object') return null;
  const name = String(t.name || '').trim();
  if (!name) return null;
  const rule = TR_RULE[name] || 'heal1';
  // 数据未给效果文案时，用与实际效果一致的说明（不夸大、不编造机制）
  const ruleText = {
    shield: '使用后获得护盾：下次受伤害30%概率闪避',
    heal2: '使用后恢复2点文气',
    draw2: '使用后摸2张牌',
    peek: '查看对手全部手牌并弃掉其1张',
    heal1: '使用后恢复1点文气',
  }[rule];
  return {
    id: String(t.id || 'tr' + i),
    name,
    title: String(t.title || t.rarity || ''),
    rarity: String(t.rarity || t.title || '非遗'),
    intro: String(t.intro || t.desc || ''),
    history: String(t.history || ''),
    effect: String(t.effect || ruleText || ''),
    rule,
    img: t.img ? String(t.img) : asset(IMG_MAP[name] || ''),
  };
}

function pickData() {
  const w = typeof window !== 'undefined' ? window.__PLAY_DATA__ : null;
  const yaji = (w && w.games && w.games.yaji) || null;
  let chars = [];
  let trs = [];
  if (yaji && Array.isArray(yaji.characters)) chars = yaji.characters;
  if (yaji && Array.isArray(yaji.treasures)) trs = yaji.treasures;
  chars = chars.map(normChar).filter(Boolean);
  trs = trs.map(normTreasure).filter(Boolean);
  if (chars.length < 2) chars = FALLBACK_CHARS.map(normChar).filter(Boolean);
  if (trs.length < 1) trs = FALLBACK_TREASURES.map(normTreasure).filter(Boolean);
  return { chars, trs };
}

/* ============================================================
   模块状态（单实例：pane 幂等守护，重复 init 直接返回）
   ============================================================ */
let P = null;          // pane
let R = null;          // 根元素 .yaji
let S = null;          // 对局状态
let els = {};          // DOM 引用
let docKey = null;     // 全局键盘监听去重

/* ---------------- 出口 ---------------- */
export function initYaji(pane) {
  if (!pane) return;
  if (pane.dataset.yajiReady === '1') return; // 幂等
  pane.dataset.yajiReady = '1';
  pane.dataset.module = 'yaji';
  pane.dataset.status = 'ready';
  boot(pane);
}

function boot(pane) {
  P = pane;
  const { chars, trs } = pickData();

  R = el(`
    <div class="yaji">
      <!-- 屏一 · 引首 -->
      <section class="y-scr y-splash" data-scr="splash">
        <div class="y-splash-grid">
          <div class="y-splash-inner">
            <div class="kicker">YANJI — 文人卡牌对战</div>
            <h3 class="y-splash-title riso">文人雅集</h3>
            <p class="lede">五位文人各执一笔，牌上立论、辩驳、唱和。文气归零者止笔；集齐四张流派标识者成宗。</p>
            <blockquote class="y-quote" data-role="quote"></blockquote>
            <ul class="y-rules">
              <li>点击选牌，双击或按「出牌」打出</li>
              <li>「搁笔」结束回合；手牌多于文气数须弃牌</li>
              <li>对方立论时，手中的「辩驳」会自动抵挡</li>
              <li>胜利：对方文气归零，或集齐四张流派标识</li>
            </ul>
            <div class="y-cta">
              <button class="btn primary" data-act="to-select">开卷 · 选择文人</button>
            </div>
          </div>
          <aside class="y-roster" aria-label="五位文人名帖">
            <div class="kicker">ROSTER — 五人名帖</div>
            ${chars
              .slice(0, 5)
              .map(
                (c, i) => `
            <button class="y-slip" type="button" data-act="to-select" style="--slip-i:${i}">
              <span class="y-slip-no mono">${String(i + 1).padStart(2, '0')}</span>
              <span class="y-slip-name">${c.name}</span>
              <span class="y-slip-title">${c.title}</span>
            </button>`
              )
              .join('')}
          </aside>
        </div>
        <span class="tape y-tape-a"></span>
      </section>

      <!-- 屏二 · 择人 -->
      <section class="y-scr y-select" data-scr="select" hidden>
        <header class="y-scr-head">
          <div>
            <div class="kicker">STEP 01 — 择人执笔</div>
            <h3>选择你的文人</h3>
          </div>
          <button class="btn ghost" data-act="to-splash">返回</button>
        </header>
        <div class="y-chars" data-role="chars"></div>
        <div class="y-cta">
          <button class="btn primary" data-act="begin" disabled>开始对局</button>
          <span class="y-note mono" data-role="selnote">尚未择人</span>
        </div>
      </section>

      <!-- 屏三 · 对局 -->
      <section class="y-scr y-game" data-scr="game" hidden>
        <div class="y-top">
          <button class="y-side y-side-o" data-act="who-o" type="button">
            <span class="y-face" data-role="oFace"></span>
            <span class="y-id"><b data-role="oName"></b><i data-role="oTitle"></i></span>
            <span class="y-qi" data-role="oQi"></span>
            <span class="y-hcount mono" data-role="oCount">手牌 0</span>
          </button>
          <div class="y-turn" data-role="turn">第 1 回合</div>
          <div class="y-deck mono" data-role="deckno">牌堆 0 · 弃 0</div>
        </div>

        <div class="y-zone halftone" data-role="zone"></div>

        <div class="y-midbar">
          <button class="btn ghost y-logtog" data-act="toglog" type="button">战报</button>
          <button class="btn y-skill" data-act="skill" type="button" hidden>七家文选</button>
          <span class="y-tip mono" data-role="tip"></span>
        </div>
        <div class="y-log" data-role="log" hidden></div>

        <div class="y-side y-side-p">
          <button class="y-face y-face-btn" data-act="who-p" type="button" data-role="pFace"></button>
          <span class="y-id"><b data-role="pName"></b><i data-role="pTitle"></i></span>
          <span class="y-qi" data-role="pQi"></span>
        </div>

        <div class="y-handwrap">
          <div class="y-hand" data-role="hand"></div>
        </div>

        <div class="y-actions">
          <button class="btn primary" data-act="play" disabled>出牌</button>
          <button class="btn" data-act="end">搁笔结束</button>
          <button class="btn ghost" data-act="restart">重新开局</button>
        </div>
      </section>

      <!-- 屏四 · 结算 -->
      <section class="y-scr y-result" data-scr="result" hidden>
        <div class="y-result-inner">
          <div class="y-big" data-role="rBig"></div>
          <div class="y-sub" data-role="rSub"></div>
          <div class="y-who mono" data-role="rWho"></div>
          <div class="y-cta">
            <button class="btn primary" data-act="again">再论一场</button>
            <button class="btn ghost" data-act="to-splash">归去</button>
          </div>
        </div>
      </section>

      <!-- 宝物介绍（非遗小传） -->
      <div class="y-tr" data-role="tr" hidden>
        <div class="y-tr-card card">
          <span class="tape y-tape-b"></span>
          <div class="y-tr-pic" data-role="trPic"></div>
          <div class="y-tr-body">
            <div class="kicker">非遗宝物</div>
            <h3 data-role="trName"></h3>
            <p class="y-tr-intro" data-role="trIntro"></p>
            <p class="y-tr-hist" data-role="trHist"></p>
            <p class="y-tr-eff mono" data-role="trEff"></p>
            <button class="btn primary" data-act="tr-ok">继续</button>
          </div>
        </div>
      </div>

      <!-- 牌情 / 人物详情 -->
      <div class="y-detail" data-role="detail" hidden>
        <div class="y-detail-card card">
          <div class="kicker" data-role="dTag"></div>
          <h3 data-role="dName"></h3>
          <p class="y-d-eff" data-role="dEff"></p>
          <p class="y-d-hist" data-role="dHist"></p>
          <button class="btn" data-act="d-close">返回</button>
        </div>
      </div>

      <div class="y-flash" data-role="flash" aria-hidden="true"></div>
      <div class="y-toast mono" data-role="toast" aria-hidden="true"></div>
      <div class="y-fx" data-role="fx" aria-hidden="true"></div>
    </div>
  `);
  P.appendChild(R);

  /* DOM 索引 */
  els = {
    scr: {},
    quote: $('[data-role="quote"]', R),
    chars: $('[data-role="chars"]', R),
    selnote: $('[data-role="selnote"]', R),
    zone: $('[data-role="zone"]', R),
    turn: $('[data-role="turn"]', R),
    deckno: $('[data-role="deckno"]', R),
    log: $('[data-role="log"]', R),
    tip: $('[data-role="tip"]', R),
    hand: $('[data-role="hand"]', R),
    oQi: $('[data-role="oQi"]', R),
    pQi: $('[data-role="pQi"]', R),
    oFace: $('[data-role="oFace"]', R),
    pFace: $('[data-role="pFace"]', R),
    oName: $('[data-role="oName"]', R),
    oTitle: $('[data-role="oTitle"]', R),
    pName: $('[data-role="pName"]', R),
    pTitle: $('[data-role="pTitle"]', R),
    oCount: $('[data-role="oCount"]', R),
    btnPlay: $('[data-act="play"]', R),
    btnBegin: $('[data-act="begin"]', R),
    btnSkill: $('[data-act="skill"]', R),
    tr: $('[data-role="tr"]', R),
    detail: $('[data-role="detail"]', R),
    flash: $('[data-role="flash"]', R),
    toast: $('[data-role="toast"]', R),
    fx: $('[data-role="fx"]', R),
    rBig: $('[data-role="rBig"]', R),
    rSub: $('[data-role="rSub"]', R),
    rWho: $('[data-role="rWho"]', R),
  };
  R.querySelectorAll('.y-scr').forEach((s) => { els.scr[s.dataset.scr] = s; });

  /* 状态 */
  S = {
    chars, trs,
    selChar: -1,
    active: false,
    busy: false,
    epoch: 0,
    screen: 'splash',
    turn: 0,
    cur: 'p',
    sel: -1,
    log: [],
    p: null, o: null,
    deck: [], disc: [],
    vics: { p: new Set(), o: new Set() },
    skillUsed: false,
    trUsed: false,
    trPending: null,
    logOpen: false,
  };

  els.quote.textContent = QUOTES[(Math.random() * QUOTES.length) | 0];

  renderCharGrid();
  bindEvents();
  show('splash');
}

/* ============================================================
   屏切换
   ============================================================ */
function show(name) {
  S.screen = name;
  // 切屏即关浮层，避免宝物小传 / 牌情压在新屏上
  els.tr.hidden = true;
  S.trPending = null;
  if (trResolve) { const r = trResolve; trResolve = null; r(); }
  els.detail.hidden = true;
  Object.entries(els.scr).forEach(([k, node]) => { node.hidden = k !== name; });
}

function bindEvents() {
  R.addEventListener('click', (e) => {
    const actEl = e.target.closest('[data-act]');
    if (!actEl || !R.contains(actEl)) return;
    const act = actEl.dataset.act;

    if (act === 'to-splash') { show('splash'); return; }
    if (act === 'to-select') { show('select'); return; }
    if (act === 'begin') { startGame(); return; }
    if (act === 'again') { S.selChar = -1; syncSelNote(); renderCharGrid(); show('select'); return; }
    if (act === 'restart') {
      S.epoch++; S.active = false; S.busy = false;
      S.selChar = -1; syncSelNote(); renderCharGrid(); show('select');
      return;
    }
    if (act === 'play') { doPlay(); return; }
    if (act === 'end') { endTurn(); return; }
    if (act === 'toglog') {
      S.logOpen = !S.logOpen;
      els.log.hidden = !S.logOpen;
      actEl.classList.toggle('on', S.logOpen);
      renderLog();
      return;
    }
    if (act === 'skill') { useSkill(); return; }
    if (act === 'tr-ok') { resolveTr(); return; }
    if (act === 'd-close') { els.detail.hidden = true; return; }
    if (act === 'who-o') {
      if (S.o) openDetail({ tag: '对家 · ' + S.o.ch.title, name: S.o.ch.name, eff: '【' + S.o.ch.skill + '】' + S.o.ch.blurb, hist: S.o.ch.history });
      return;
    }
    if (act === 'who-p') {
      if (S.p) openDetail({ tag: '执笔 · ' + S.p.ch.title, name: S.p.ch.name, eff: '【' + S.p.ch.skill + '】' + S.p.ch.blurb, hist: S.p.ch.history });
      return;
    }
  });

  /* 选人卡 */
  els.chars.addEventListener('click', (e) => {
    if (e.target.closest('summary')) return; // 展开小传不改选中
    const card = e.target.closest('.y-ccard');
    if (!card) return;
    S.selChar = Number(card.dataset.i);
    [...els.chars.children].forEach((n, i) => n.classList.toggle('on', i === S.selChar));
    syncSelNote();
  });

  /* 手牌 */
  els.hand.addEventListener('click', (e) => {
    const c = e.target.closest('.y-card');
    if (!c || S.busy) return;
    selCard(Number(c.dataset.idx));
  });
  els.hand.addEventListener('dblclick', (e) => {
    const c = e.target.closest('.y-card');
    if (!c || S.busy) return;
    S.sel = Number(c.dataset.idx);
    doPlay();
  });

  /* 已出区看牌情 */
  els.zone.addEventListener('click', (e) => {
    const c = e.target.closest('.y-mini');
    if (!c) return;
    const card = S.cardById && S.cardById.get(c.dataset.uid);
    if (card) openDetail({ tag: cardTag(card), name: card.name, eff: card.effect, hist: card.type === 'treasure' ? (card.trHist || '') : '' });
  });

  /* 键盘 */
  if (!docKey) {
    docKey = (e) => {
      if (!P || P.hidden || !S) return;
      if (e.key === 'Escape') {
        if (!els.detail.hidden) { els.detail.hidden = true; return; }
        if (!els.tr.hidden) { resolveTr(); return; }
        if (S.screen === 'game') { S.sel = -1; renderHand(); }
      }
      if (e.key === 'Enter' && S.screen === 'game' && S.sel >= 0 && !S.busy) doPlay();
    };
    document.addEventListener('keydown', docKey);
  }
}

function syncSelNote() {
  const c = S.selChar >= 0 ? S.chars[S.selChar] : null;
  els.btnBegin.disabled = !c;
  els.selnote.textContent = c ? c.name + ' · ' + c.title : '尚未择人';
}

/* ============================================================
   择人屏
   ============================================================ */
function renderCharGrid() {
  els.chars.innerHTML = '';
  S.chars.forEach((c, i) => {
    const face = c.img
      ? `<img src="${esc(c.img)}" alt="${esc(c.name)}" loading="lazy" onerror="this.remove()">`
      : '';
    const node = el(`
      <article class="y-ccard${S.selChar === i ? ' on' : ''}" data-i="${i}" style="--i:${i}">
        <div class="y-cc-face"><span class="y-cc-fb">${esc(c.name.slice(0, 1))}</span>${face}</div>
        <div class="y-cc-body">
          <div class="y-cc-name">${esc(c.name)}</div>
          <div class="y-cc-title mono">${esc(c.title)}</div>
          <div class="y-cc-qi mono">文气 ${c.qi}</div>
          <div class="y-cc-skill"><b>【${esc(c.skill)}】</b> ${esc(c.blurb)}</div>
          ${c.history ? `<details class="y-cc-more"><summary>小传</summary><p>${esc(c.history)}</p></details>` : ''}
        </div>
        <span class="y-cc-pick stamp">执笔</span>
      </article>
    `);
    els.chars.appendChild(node);
  });
}

/* ============================================================
   对局建立
   ============================================================ */
function startGame() {
  if (S.selChar < 0) return;
  const pc = S.chars[S.selChar];
  let oi = (Math.random() * S.chars.length) | 0;
  if (oi === S.selChar) oi = (oi + 1) % S.chars.length;
  const oc = S.chars[oi];

  S.epoch++;
  S.active = true;
  S.busy = false;
  S.turn = 0;
  S.cur = 'p';
  S.sel = -1;
  S.log = [];
  S.vics = { p: new Set(), o: new Set() };
  S.skillUsed = false;
  S.trUsed = false;
  S.trPending = null;
  S.logOpen = false;
  els.log.hidden = true;

  S.p = { ch: pc, qi: pc.qi, mx: pc.qi, hand: [], played: [], bonus: 0, shield: false };
  S.o = { ch: oc, qi: oc.qi, mx: oc.qi, hand: [], played: [], bonus: 0, shield: false };

  buildDeck();
  for (let i = 0; i < 4; i++) { drawC('p'); drawC('o'); }

  faceInto(els.oFace, oc);
  faceInto(els.pFace, pc);
  els.oName.textContent = oc.name;
  els.oTitle.textContent = oc.title;
  els.pName.textContent = pc.name;
  els.pTitle.textContent = pc.title;

  addLog('雅集开始！' + pc.name + ' 对阵 ' + oc.name);
  show('game');
  renderAll();
  startTurn();
}

function faceInto(box, ch) {
  box.innerHTML = `<span class="y-face-fb">${esc(ch.name.slice(0, 1))}</span>`;
  if (ch.img) {
    const img = new Image();
    img.src = ch.img;
    img.alt = ch.name;
    img.loading = 'lazy';
    img.onerror = () => img.remove();
    box.appendChild(img);
  }
}

function buildDeck() {
  const d = [];
  let no = 0;
  DECK_KEYS.forEach((k) => {
    const c = CARD_DEFS[k];
    no++;
    d.push({
      key: k + '_' + no, no, uid: k + '_' + no,
      name: c.name, type: c.type, sub: c.sub, effect: c.effect, cat: c.cat,
      sp: c.sp || 0, draw: c.draw || 0, disc: c.disc || 0, heal: c.heal || 0,
    });
  });
  S.trs.forEach((t, i) => {
    no++;
    d.push({
      key: 'treasure_' + no, no, uid: 'treasure_' + no,
      name: t.name, type: 'treasure', cat: 'spc',
      effect: t.effect || '使用后展示非遗小传',
      trId: t.id, trHist: t.history,
    });
  });
  S.deck = shuffle(d);
  S.disc = [];
  S.cardById = new Map();
  d.forEach((c) => S.cardById.set(c.uid, c));
}

function drawC(who) {
  if (!S.deck.length) {
    if (!S.disc.length) return;
    S.deck = shuffle(S.disc);
    S.disc = [];
  }
  const c = S.deck.pop();
  const side = S[who];
  if (side.hand.length >= 6) { S.disc.push(c); return; }
  side.hand.push(c);
  if (who === 'p' && !reduced()) fxRise(els.hand);
}

/* ============================================================
   回合循环
   ============================================================ */
async function startTurn() {
  const ep = S.epoch;
  // 上一回合的已出牌归入弃牌堆（回收，避免牌堆净流失）
  flushPlayed();
  S.turn++;
  S.p.bonus = 0; S.o.bonus = 0;
  S.skillUsed = false;
  S.sel = -1;
  flash('第' + S.turn + '回合 · 著书立说');
  renderAll();
  await sleep(reduced() ? 120 : 650);
  if (!alive(ep)) return;

  if (S.cur === 'p') {
    drawC('p'); drawC('p');
    addLog('【准备】你摸了两张牌');
    renderAll();
  } else {
    await aiTurn();
  }
}

function flushPlayed() {
  ['p', 'o'].forEach((k) => {
    if (S[k].played.length) {
      S.disc.push(...S[k].played);
      S[k].played = [];
    }
  });
}

function alive(ep) {
  return S && S.active && ep === S.epoch && S.screen !== 'result';
}

async function endTurn() {
  if (!S.active || S.busy || S.cur !== 'p') return;
  const ep = S.epoch;
  S.busy = true;
  render();
  // 手牌多于文气数须弃牌
  while (S.p.hand.length > S.p.qi) {
    const c = S.p.hand.pop();
    S.disc.push(c);
    addLog('【弃牌】你弃掉了「' + c.name + '」');
  }
  addLog('你搁笔结束回合');
  renderAll();
  S.busy = false;
  S.cur = 'o';
  await sleep(reduced() ? 120 : 500);
  if (!alive(ep)) return;
  await startTurn();
}

/* ============================================================
   出牌
   ============================================================ */
function selCard(i) {
  if (S.cur !== 'p' || !S.active) return;
  S.sel = S.sel === i ? -1 : i;
  renderHand();
  render();
}

async function doPlay() {
  if (S.busy || !S.active || S.cur !== 'p' || S.sel < 0) return;
  const ep = S.epoch;
  S.busy = true;
  try {
    const card = S.p.hand.splice(S.sel, 1)[0];
    S.sel = -1;
    S.p.played.push(card);
    addLog('你打出了「' + card.name + '」');
    fxInk();
    await applyCard(card, 'p', ep);
    if (!alive(ep)) return;
    renderAll();
    if (chkWin()) return;
    if (S.trPending) await showTr(S.trPending);
  } finally {
    if (ep === S.epoch) { S.busy = false; render(); }
  }
}

async function applyCard(card, who, ep) {
  if (card.type === 'article') doArticle(card, who);
  else if (card.type === 'jj') doJJ(card, who);
  else if (card.type === 'zy') doZY(card, who);
  else if (card.type === 'vic') doVic(card, who);
  else if (card.type === 'treasure') doTreasure(card, who);
  if (!S.active) return;
  renderQi();
}

function doArticle(card, who) {
  const pl = S[who];
  const opk = who === 'p' ? 'o' : 'p';
  const op = S[opk];
  let dmg = 1 + (pl.bonus || 0);

  if (card.sp) {
    // 【奇正相生】恽敬：散文牌伤害时弃骈文令伤害+1
    if (pl.ch.id === 'yujing' && card.sub === '散文') {
      const f = pl.hand.findIndex((c) => c.sub === '骈文');
      if (f >= 0) {
        const dc = pl.hand.splice(f, 1)[0];
        S.disc.push(dc);
        dmg++;
        addLog('【奇正相生】弃「' + dc.name + '」，伤害+1');
      }
    }
    // 李兆洛：骈文作散文用（记述）
    if (pl.ch.id === 'lizhaoluo' && card.sub === '骈文') {
      addLog('【骈散相杂】骈文作散文用');
    }
    if (card.draw) { for (let i = 0; i < card.draw; i++) drawC(who); addLog('摸了' + card.draw + '牌'); }
    if (card.heal) { pl.qi = Math.min(pl.mx, pl.qi + card.heal); addLog('回复' + card.heal + '文气'); }
    if (card.disc && op.hand.length) {
      const ri = (Math.random() * op.hand.length) | 0;
      const dc = op.hand.splice(ri, 1)[0];
      S.disc.push(dc);
      addLog('弃对方「' + dc.name + '」');
    }
  }

  const defIdx = op.hand.findIndex((c) => c.type === 'article' && c.name === '辩驳');
  // 对方（AI）持辩驳以 50% 抵挡；我方持辩驳自动抵挡
  if (defIdx >= 0 && (who === 'o' || Math.random() > 0.5)) {
    const bc = op.hand.splice(defIdx, 1)[0];
    S.disc.push(bc);
    addLog(op.ch.name + '打出「辩驳」抵消');
    fxSpark();
    // 【研咏博访】董士锡：文章牌被响应后各摸一牌
    if (pl.ch.id === 'dongshixi') {
      drawC('p'); drawC('o');
      addLog('【研咏博访】双方各摸一牌');
    }
  } else {
    if (op.shield && Math.random() < 0.3) {
      op.shield = false;
      addLog('【乱针绣】针线交错，闪避了伤害！');
      toast('闪避！');
      dmg = 0;
    }
    if (dmg > 0) {
      op.qi = Math.max(0, op.qi - dmg);
      addLog(op.ch.name + '受' + dmg + '点损伤，剩余' + op.qi);
      fxShake();
      fxNum(dmg, 'dmg');
      // 【缘情造端】张惠言：受损伤后立即摸两张牌
      if (op.ch.id === 'zhanghuiyan') {
        drawC(opk); drawC(opk);
        addLog('【缘情造端】' + op.ch.name + '摸两牌');
      }
    }
  }
}

function doJJ(card, who) {
  const pl = S[who];
  if (card.name === '第一流') { pl.bonus = (pl.bonus || 0) + 1; addLog('本回合伤害+1'); fxSpark(); }
  else if (card.name === '博学养') { drawC(who); drawC(who); addLog('摸了两牌'); fxNum(2, 'gain'); }
  else if (card.name === '性情真') { pl.qi = Math.min(pl.mx, pl.qi + 1); addLog('回复1文气'); fxNum(1, 'heal'); }
  else if (card.name === '济文道' || card.name === '意内言外') { drawC(who); addLog('摸一牌'); fxNum(1, 'gain'); }
  else addLog('使用了「' + card.name + '」');
}

function doZY(card, who) {
  const pl = S[who];
  if (card.name === '同车图' || card.name === '论文帖') {
    pl.qi = Math.min(pl.mx, pl.qi + 1);
    addLog('回复1文气');
    fxNum(1, 'heal');
  } else if (card.name === '阳湖会') {
    S.p.qi = Math.min(S.p.mx, S.p.qi + 1);
    S.o.qi = Math.min(S.o.mx, S.o.qi + 1);
    addLog('各回复1文气');
    fxNum(1, 'heal');
  } else {
    addLog('使用了「' + card.name + '」');
  }
}

function doVic(card, who) {
  const set = S.vics[who];
  const vicKey = card.uid.split('_')[0]; // v1..v4
  if (!set.has(vicKey)) set.add(vicKey);
  const cnt = set.size;
  if (cnt >= 4) {
    addLog('【文宗制胜】' + S[who].ch.name + '集齐四张！');
    endGame(who);
  } else {
    addLog('收集流派标识(' + cnt + '/4)');
  }
}

function doTreasure(card, who) {
  const tr = S.trs.find((t) => t.id === card.trId) || S.trs.find((t) => t.name === card.name);
  if (!tr) { addLog('「' + card.name + '」暂无记载'); return; }
  const me = S[who];
  const opk = who === 'p' ? 'o' : 'p';

  if (tr.rule === 'shield') {
    me.shield = true;
    addLog('【' + tr.name + '】针线交织，织就护体绣衣');
  } else if (tr.rule === 'heal2') {
    me.qi = Math.min(me.mx, me.qi + 2);
    addLog('【' + tr.name + '】品尝麻糕，恢复2点文气');
    fxNum(2, 'heal');
  } else if (tr.rule === 'draw2') {
    drawC(who); drawC(who);
    addLog('【' + tr.name + '】梳理思绪，摸了两张牌');
  } else if (tr.rule === 'peek') {
    if (S.trUsed) { addLog('【' + tr.name + '】本局已使用过'); }
    else {
      S.trUsed = true;
      const opp = S[opk];
      const info = opp.hand.map((c) => c.name).join('、') || '（无手牌）';
      addLog('【' + tr.name + '】对手手牌：' + info);
      if (opp.hand.length) {
        const ri = (Math.random() * opp.hand.length) | 0;
        const dc = opp.hand.splice(ri, 1)[0];
        S.disc.push(dc);
        addLog('弃掉对手「' + dc.name + '」');
      }
    }
  } else {
    me.qi = Math.min(me.mx, me.qi + 1);
    addLog('【' + tr.name + '】宝物现世，回复1文气');
    fxNum(1, 'heal');
  }
  S.trPending = tr;
}

/* ---------------- 宝物小传弹层 ---------------- */
let trResolve = null;
let trTimer = null;
function showTr(tr) {
  return new Promise((resolve) => {
    if (trResolve) { const r = trResolve; trResolve = null; r(); } // 上一张未关直接放行
    trResolve = resolve;
    const pic = $('[data-role="trPic"]', els.tr);
    pic.innerHTML = tr.img
      ? `<img src="${esc(tr.img)}" alt="${esc(tr.name)}" onerror="this.remove()">`
      : `<span class="y-tr-fb">${esc(tr.name.slice(0, 1))}</span>`;
    $('[data-role="trName"]', els.tr).textContent = tr.name + (tr.title ? ' · ' + tr.title : '');
    $('[data-role="trIntro"]', els.tr).textContent = tr.intro || '';
    $('[data-role="trHist"]', els.tr).textContent = tr.history || '';
    $('[data-role="trEff"]', els.tr).textContent = '游戏效果：' + (tr.effect || '');
    els.tr.hidden = false;
    // 自动放行，避免切走页签后卡住
    clearTimeout(trTimer);
    trTimer = setTimeout(resolveTr, 8000);
  });
}
function resolveTr() {
  clearTimeout(trTimer);
  if (els.tr.hidden) return;
  els.tr.hidden = true;
  S.trPending = null;
  if (trResolve) { const r = trResolve; trResolve = null; r(); }
}

/* ============================================================
   本地启发式 AI（保辩驳 / 残血先疗 / 优先宝物与立论）
   ============================================================ */
async function aiTurn() {
  const ep = S.epoch;
  drawC('o'); drawC('o');
  addLog('【准备】' + S.o.ch.name + '摸了两牌');
  renderAll();
  await sleep(reduced() ? 150 : 700);
  if (!alive(ep)) return;

  // 【七家文选】陆继辂（AI）：弃一牌，令对方弃一牌
  if (S.o.ch.id === 'lujilu' && !S.skillUsed && S.o.hand.length >= 3) {
    aiSkill();
    renderAll();
    await sleep(reduced() ? 150 : 600);
    if (!alive(ep)) return;
  }

  let acts = 0;
  while (acts < 2 && S.active && S.o.hand.length && ep === S.epoch) {
    const card = aiPick();
    if (!card) break;
    const i = S.o.hand.indexOf(card);
    if (i < 0) break;
    S.o.hand.splice(i, 1);
    S.o.played.push(card);
    addLog(S.o.ch.name + '打出「' + card.name + '」');
    fxInk();
    await applyCard(card, 'o', ep);
    if (!alive(ep)) return;
    renderAll();
    if (chkWin()) return;
    acts++;
    if (S.trPending && S.active) {
      await showTr(S.trPending);
      if (!alive(ep)) return;
    }
    await sleep(reduced() ? 150 : 650);
  }
  if (!alive(ep)) return;

  while (S.o.hand.length > S.o.qi) {
    const c = S.o.hand.pop();
    S.disc.push(c);
    addLog(S.o.ch.name + '弃「' + c.name + '」');
  }
  addLog(S.o.ch.name + '搁笔结束');
  renderAll();
  S.cur = 'p';
  await sleep(reduced() ? 120 : 500);
  if (!alive(ep)) return;
  await startTurn();
}

function aiPick() {
  const h = S.o.hand;
  const useful = h.filter((c) => !(c.type === 'article' && c.name === '辩驳'));
  // 1. 宝物（留青竹刻已用则跳过）
  let c = useful.find((x) => x.type === 'treasure' && !(x.name === '留青竹刻' && S.trUsed));
  if (c) return c;
  // 2. 残血先疗
  if (S.o.qi <= 3) {
    c = useful.find((x) => x.cat === 'hel');
    if (c) return c;
  }
  // 3. 对方将败，抢攻立论
  const atk = useful.filter((x) => x.type === 'article');
  if (S.p.qi <= 2) { c = atk[0]; if (c) return c; }
  // 4. 普通立论（保辩驳在手）
  if (atk.length) return atk[0];
  // 5. 疗 / 策
  c = useful.find((x) => x.cat === 'hel');
  if (c) return c;
  c = useful.find((x) => x.type === 'jj');
  if (c) return c;
  // 6. 集齐在望先打流派标识；否则有闲牌也打
  if (S.vics.o.size >= 3) { c = h.find((x) => x.type === 'vic'); if (c) return c; }
  c = h.find((x) => x.type === 'vic');
  if (c && h.length >= 5) return c;
  return null;
}

function aiSkill() {
  // 弃一张优先级最低的牌（策→宗→疗），令玩家随机弃一张
  const rank = (c) => (c.type === 'jj' ? 0 : c.type === 'vic' ? 1 : c.cat === 'hel' ? 2 : c.type === 'treasure' ? 3 : 4);
  let worst = S.o.hand[0];
  for (const c of S.o.hand) if (rank(c) < rank(worst)) worst = c;
  S.o.hand.splice(S.o.hand.indexOf(worst), 1);
  S.disc.push(worst);
  if (S.p.hand.length) {
    const ri = (Math.random() * S.p.hand.length) | 0;
    const dc = S.p.hand.splice(ri, 1)[0];
    S.disc.push(dc);
    addLog('【七家文选】' + S.o.ch.name + '弃「' + worst.name + '」，你弃「' + dc.name + '」');
  } else {
    drawC('o');
    addLog('【七家文选】' + S.o.ch.name + '弃「' + worst.name + '」，自摸一牌');
  }
  S.skillUsed = true;
}

/* ---------------- 陆继辂（玩家）主动技 ---------------- */
function useSkill() {
  if (!S.active || S.busy || S.cur !== 'p') return;
  if (S.p.ch.id !== 'lujilu' || S.skillUsed) return;
  if (S.sel < 0) { toast('请先选择要弃掉的牌'); return; }
  const dc = S.p.hand.splice(S.sel, 1)[0];
  S.disc.push(dc);
  S.sel = -1;
  if (S.o.hand.length) {
    const ri = (Math.random() * S.o.hand.length) | 0;
    const d2 = S.o.hand.splice(ri, 1)[0];
    S.disc.push(d2);
    addLog('【七家文选】你弃「' + dc.name + '」，' + S.o.ch.name + '弃「' + d2.name + '」');
  } else {
    drawC('p');
    addLog('【七家文选】你弃「' + dc.name + '」，自摸一牌');
  }
  S.skillUsed = true;
  fxSpark();
  renderAll();
}

/* ============================================================
   胜负
   ============================================================ */
function chkWin() {
  if (!S.active) return true;
  if (S.p.qi <= 0) { endGame('o'); return true; }
  if (S.o.qi <= 0) { endGame('p'); return true; }
  return false;
}

function endGame(w) {
  if (!S.active) return;
  S.active = false;
  S.busy = false;
  const win = w === 'p';
  els.rBig.textContent = win ? '文宗' : '才竭';
  els.rBig.classList.toggle('win', win);
  els.rBig.classList.toggle('lose', !win);
  els.rSub.textContent = win ? '恭喜，你在雅集中胜出！' : '暂避锋芒，以待来日';
  els.rWho.textContent = S.p.ch.name + ' · ' + S.p.ch.title;
  addLog(win ? '恭喜获胜！' : '遗憾落败…');
  S.logOpen = true; els.log.hidden = false; renderLog();
  show('result');
  if (win && !reduced()) { fxSpark(); setTimeout(fxSpark, 300); }
}

/* ============================================================
   渲染
   ============================================================ */
function renderAll() { render(); renderQi(); renderHand(); renderZone(); renderLog(); }

function cardTag(card) {
  const TAG = { article: '文', jj: '策', zy: '盟', vic: '宗', treasure: '遗' };
  if (card.type === 'article') {
    if (card.name === '辩驳') return '辩 · 散文';
    return '立 · ' + (card.sub || '散文');
  }
  return TAG[card.type] || '牌';
}

function render() {
  if (!S || !S.p) return;
  els.turn.textContent = '第' + S.turn + '回合 · ' + (S.cur === 'p' ? '你的回合' : S.o.ch.name + '的回合');
  els.turn.classList.toggle('mine', S.cur === 'p');
  els.deckno.textContent = '牌堆 ' + S.deck.length + ' · 弃 ' + S.disc.length;
  els.oCount.textContent = '手牌 ' + S.o.hand.length;
  const canPlay = S.active && S.cur === 'p' && S.sel >= 0 && !S.busy;
  els.btnPlay.disabled = !canPlay;
  $('[data-act="end"]', R).disabled = !(S.active && S.cur === 'p' && !S.busy);
  const canSkill = S.active && S.cur === 'p' && !S.busy &&
    S.p.ch.id === 'lujilu' && !S.skillUsed && S.p.hand.length > 0;
  els.btnSkill.hidden = !canSkill;
  els.tip.textContent = S.busy ? '…'
    : !S.active ? ''
    : S.cur !== 'p' ? S.o.ch.name + ' 正在执笔'
    : S.sel >= 0 ? '已选「' + S.p.hand[S.sel].name + '」 · 双击或出牌'
    : '点击手牌选择';
}

function qiHTML(mx, qi) {
  let h = '';
  for (let i = 0; i < mx; i++) h += `<span class="y-pip${i >= qi ? ' off' : ''}"></span>`;
  return h;
}

function renderQi() {
  if (!S.p) return;
  els.oQi.innerHTML = qiHTML(S.o.mx, S.o.qi);
  els.pQi.innerHTML = qiHTML(S.p.mx, S.p.qi);
  els.pQi.setAttribute('aria-label', '你的文气 ' + S.p.qi + '/' + S.p.mx);
  els.oQi.setAttribute('aria-label', S.o.ch.name + ' 文气 ' + S.o.qi + '/' + S.o.mx);
}

function renderHand() {
  if (!S.p) return;
  const prevLen = S._prevHand || 0;
  els.hand.innerHTML = '';
  S.p.hand.forEach((card, i) => {
    const sel = i === S.sel;
    const fresh = i >= prevLen; // 只给新摸的牌进入动画
    const face = card.type === 'treasure'
      ? `<span class="y-c-face y-c-face-tr">${esc(card.name.slice(0, 1))}</span>`
      : '';
    const node = el(`
      <button type="button" class="y-card${sel ? ' sel' : ''}${card.type === 'treasure' ? ' treasure' : ''}${fresh ? ' fresh' : ''}"
              data-idx="${i}" style="--i:${i}" aria-pressed="${sel}">
        <span class="y-c-no mono">№${pad(card.no)}</span>
        <span class="y-c-tag mono t-${esc(card.cat)}">${esc(cardTag(card))}</span>
        ${face}
        <span class="y-c-name">${esc(card.name)}</span>
        <span class="y-c-eff">${esc(card.effect)}</span>
      </button>
    `);
    els.hand.appendChild(node);
  });
  S._prevHand = S.p.hand.length;
}

function renderZone() {
  if (!S.p) return;
  const all = [...S.o.played, ...S.p.played];
  const prevUids = S._zoneUids || new Set();
  const nowUids = new Set(all.map((c) => c.uid));
  const same = prevUids.size === nowUids.size && [...nowUids].every((u) => prevUids.has(u));
  if (same && els.zone.dataset.sig === String(all.length)) return; // 无变化不重绘
  els.zone.innerHTML = '';
  if (!all.length) {
    els.zone.innerHTML = '<span class="y-zone-empty mono">本回合尚无牌面落纸</span>';
  } else {
    all.forEach((card, i) => {
      const who = i < S.o.played.length ? 'o' : 'p';
      const fresh = !prevUids.has(card.uid);
      const node = el(`
        <button type="button" class="y-mini${card.type === 'treasure' ? ' treasure' : ''} from-${who}${fresh ? ' in' : ''}" data-uid="${esc(card.uid)}" style="--i:${i}">
          <span class="y-m-no mono">${pad(card.no)}</span>
          <span class="y-m-name">${esc(card.name)}</span>
          <span class="y-m-tag mono">${esc(cardTag(card))}</span>
        </button>
      `);
      els.zone.appendChild(node);
    });
  }
  S._zoneUids = nowUids;
  els.zone.dataset.sig = String(all.length);
}

function renderLog() {
  if (!S) return;
  const h = S.log.map((l) => `<div><i>${l.ts}</i>${esc(l.t)}</div>`).join('');
  els.log.innerHTML = h || '<div><i>--:--:--</i>暂无战报</div>';
}

function addLog(t) {
  const d = new Date();
  const ts = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  S.log.unshift({ ts, t });
  if (S.log.length > 60) S.log.length = 60;
  renderLog();
}

function openDetail({ tag, name, eff, hist }) {
  $('[data-role="dTag"]', els.detail).textContent = tag || '';
  $('[data-role="dName"]', els.detail).textContent = name || '';
  $('[data-role="dEff"]', els.detail).textContent = eff || '';
  const h = $('[data-role="dHist"]', els.detail);
  h.textContent = hist || '';
  h.hidden = !hist;
  els.detail.hidden = false;
}

/* ============================================================
   微动效（全部限定在面板内；尊重 prefers-reduced-motion）
   ============================================================ */
let toastTimer = null;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('on'), 1600);
}

let flashTimer = null;
function flash(msg) {
  els.flash.textContent = msg;
  els.flash.classList.add('on');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => els.flash.classList.remove('on'), 1100);
}

function fxShake() {
  if (reduced()) return;
  R.classList.remove('y-shake');
  void R.offsetWidth;
  R.classList.add('y-shake');
  setTimeout(() => R.classList.remove('y-shake'), 420);
}

function fxInk() {
  if (reduced()) return;
  const n = el('<span class="y-ink"></span>');
  els.fx.appendChild(n);
  setTimeout(() => n.remove(), 700);
}

function fxNum(v, kind) {
  if (reduced()) return;
  const n = el(`<span class="y-num ${kind}">${v > 0 && kind === 'dmg' ? '-' : '+'}${Math.abs(v)}</span>`);
  els.fx.appendChild(n);
  setTimeout(() => n.remove(), 1100);
}

function fxSpark() {
  if (reduced()) return;
  for (let i = 0; i < 8; i++) {
    const s = el('<span class="y-spark"></span>');
    const a = (Math.PI * 2 * i) / 8;
    s.style.setProperty('--dx', Math.cos(a) * 46 + 'px');
    s.style.setProperty('--dy', Math.sin(a) * 46 + 'px');
    els.fx.appendChild(s);
    setTimeout(() => s.remove(), 700);
  }
}

function fxRise(host) {
  if (reduced()) return;
  const n = el('<span class="y-rise"></span>');
  host.parentElement.appendChild(n);
  setTimeout(() => n.remove(), 500);
}
