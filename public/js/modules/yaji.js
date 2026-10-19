/* ============================================================
   文人雅集 —— 金坛五文人卡牌对战（Lo-Fi 手账）
   算法移植自前身项目 yanghu-yaji：buildDeck / drawC / nextTurn /
   doPlay / selCard 对局循环 + 本地启发式 AI + 战斗日志 + 四屏切换
   材质按 tokens.css 重绘：印刷卡纸（硬边 / mono 编号 / 衬线卡名 /
   背面半调网点），桌面纸黄，riso 错位，硬偏移阴影
   导出：export function initYaji(pane)  // #paneYaji，幂等
   数据：window.__PLAY_DATA__.games.yaji（characters / treasures；
         数据为空时镜像同一份金坛名册兜底，绝不现编）
   ============================================================ */

/* ---------------- 牌库定义（金坛题材：著作名与掌故皆有出处，机制不变） ---------------- */
const CARD_DEFS = {
  lilun:         { name: '立论',       type: 'article', sub: '散文', effect: '造成1点文气损伤',   cat: 'atk' },
  bianbo:        { name: '辩驳',       type: 'article', sub: '散文', effect: '抵消一次立论损伤',   cat: 'def' },
  dayunshanfang: { name: '真诰',       type: 'article', sub: '散文', effect: '立论+骈文属性',     cat: 'atk', sp: 1 },
  mingkewen:     { name: '抱朴子',     type: 'article', sub: '散文', effect: '立论+摸1张牌',      cat: 'atk', sp: 1, draw: 1 },
  pianwenchao:   { name: '六书音均表', type: 'article', sub: '骈文', effect: '立论+骈散双属性',   cat: 'atk', sp: 1 },
  qijiawenchao:  { name: '肘后备急方', type: 'article', sub: '散文', effect: '立论+弃目标1牌',    cat: 'atk', sp: 1, disc: 1 },
  futangci:      { name: '兰溪棹歌',   type: 'article', sub: '词',   effect: '立论+诗词属性',     cat: 'atk', sp: 1 },
  yangyizhai:    { name: '本草经集注', type: 'article', sub: '散文', effect: '立论+回复1文气',    cat: 'atk', sp: 1, heal: 1 },
  diyiliu:       { name: '山中宰相',   type: 'jj', effect: '本回合立论伤害+1',       cat: 'spc' },
  zilichu:       { name: '不撑铁骨',   type: 'jj', effect: '抵消下一次文气损伤',     cat: 'spc' },
  jiwendao:      { name: '华阳洞天',   type: 'jj', effect: '弃1张牌，摸2张牌',       cat: 'spc' },
  piansanhe:     { name: '周礼汉读考', type: 'jj', effect: '查看对手手牌（写入战报）', cat: 'spc' },
  yineiyanwai:   { name: '万里未归',   type: 'jj', effect: '受损伤后摸1张牌（1次）', cat: 'spc' },
  jingshiwen:    { name: '郁冈笔麈',   type: 'jj', effect: '弃1张牌，弃对手1张文章牌', cat: 'spc' },
  bulizong:      { name: '不立宗',     type: 'jj', effect: '弃1张牌，对手弃1张牌',   cat: 'spc' },
  xingqingzhen:  { name: '不耕砚田',   type: 'jj', effect: '回复1点文气',            cat: 'hel' },
  boxueyang:     { name: '弃仕从医',   type: 'jj', effect: '摸2张牌',                cat: 'spc' },
  tongchetu:     { name: '青蒿治疟',   type: 'zy', effect: '回复1点文气',            cat: 'hel' },
  lunwentie:     { name: '取兆讨吉',   type: 'zy', effect: '回复1点文气',            cat: 'hel' },
  yanghuhui:     { name: '文人雅集',   type: 'zy', effect: '所有角色各回复1文气',    cat: 'hel' },
  v1:            { name: '山中宰相',   type: 'vic', effect: '流派标识·集齐四张成宗', cat: 'vic' },
  v2:            { name: '不撑铁骨',   type: 'vic', effect: '流派标识·集齐四张成宗', cat: 'vic' },
  v3:            { name: '华阳洞天',   type: 'vic', effect: '流派标识·集齐四张成宗', cat: 'vic' },
  v4:            { name: '周礼汉读考', type: 'vic', effect: '流派标识·集齐四张成宗', cat: 'vic' },
};

/* 五人对战技（与 games.json 技能名一一对应，皆接入对局机制） */
const SKILL_MECH = {
  taohongjing: '准备阶段额外摸1张牌',
  gehong: '所有回复效果额外+1点文气',
  daishulun: '受到文气损伤后摸1张牌',
  duanyucai: '立论命中时随机弃对手1张牌（每回合首次）',
  wangkentang: '回合结束时若文气不高于2，回复1点文气',
};

const DECK_KEYS = [
  ...Array(15).fill('lilun'),
  ...Array(15).fill('bianbo'),
  'dayunshanfang', 'mingkewen', 'pianwenchao', 'qijiawenchao', 'futangci', 'yangyizhai',
  'diyiliu', 'zilichu', 'jiwendao', 'piansanhe', 'yineiyanwai', 'jingshiwen', 'bulizong', 'xingqingzhen', 'boxueyang',
  'tongchetu', 'lunwentie', 'yanghuhui',
  'v1', 'v2', 'v3', 'v4',
];

/* 雅集题词（金坛五文人名句，皆有出处） */
const QUOTES = [
  '山中何所有？岭上多白云。——陶弘景',
  '我命在我不在天。——葛洪《抱朴子》',
  '一年将尽夜，万里未归人。——戴叔伦',
  '不耕砚田无乐事，不撑铁骨莫支贫。——段玉裁',
];

/* ---------------- 兜底数据（镜像 games.json 金坛名册，绝不现编） ---------------- */
const NAME_ID = {
  '陶弘景': 'taohongjing', '葛洪': 'gehong', '戴叔伦': 'daishulun',
  '段玉裁': 'duanyucai', '王肯堂': 'wangkentang',
};

const IMG_MAP = {
  '陶弘景': 'taohongjing.jpg', '葛洪': 'gehong.jpg', '戴叔伦': 'daishulun.jpg',
  '段玉裁': 'duanyucai.jpg', '王肯堂': 'wangkentang.jpg',
  '金坛刻纸《大运河》长卷': 'tr-kezhi.jpg', '段玉裁《说文解字注》刻本': 'tr-shuowen.jpg',
  '金坛封缸酒': 'tr-fenggang.jpg', '指前鱼灯': 'tr-yudeng.jpg',
};

const FALLBACK_CHARS = [
  { id: 'taohongjing', name: '陶弘景', title: '华阳隐居 · 山中宰相', qi: 6,
    skill: '洞天开卷：出战时以道文化与山水诗文化解难题，为全场文案注入隐逸江南气质',
    desc: '南朝齐梁的茅山宗开创者，隐居山中却被朝廷大事频频问策——“山中何所有？岭上多白云。”金坛华阳洞天古名即是他留给这座城最硬的文化钩子。' },
  { id: 'gehong', name: '葛洪', title: '抱朴子 · 小仙翁', qi: 6,
    skill: '丹火祛魅：把炼丹术语翻译成古代化学科普，破除玄学迷雾',
    desc: '东晋丹道医药学家，“我命由我不由天”最早出处者，青蒿治疟启发了屠呦呦。诚实标注：他是大茅山道教文化圈人物、籍贯句容，非金坛本地人。' },
  { id: 'daishulun', name: '戴叔伦', title: '容管经略使 · 唐诗乡愁客', qi: 6,
    skill: '唤诗：吟出唐诗名句即可对诗通关，为返乡与节气场景附加情绪价值',
    desc: '中唐金坛籍诗人与能吏，“一年将尽夜，万里未归人”写尽游子心事；注意《兰溪棹歌》所咏为浙江兰溪，不可当作长荡湖诗。' },
  { id: 'duanyucai', name: '段玉裁', title: '懋堂先生 · 说文解字注', qi: 6,
    skill: '拆字解谜：以六书之法拆解非遗纹样、匾额与家训，开启文字关卡',
    desc: '清代金坛文字学家，耗三十余年成《说文解字注》三十卷，“不耕砚田无乐事，不撑铁骨莫支贫”——Z世代长期主义的祖师爷。' },
  { id: 'wangkentang', name: '王肯堂', title: '王金坛 · 证治准绳', qi: 6,
    skill: '本草问诊：为研学与养生内容把关，以循证视角解读茅山药草',
    desc: '明代金坛进士，仕途受挫后弃仕从医，以十余年著成约220万字《证治准绳》——高考才子的人生B计划，对Z世代最友好。' },
];

const FALLBACK_TREASURES = [
  { id: 'tr0', name: '金坛刻纸《大运河》长卷', rarity: '传说',
    intro: '金坛刻纸代表作、百米长卷《大运河》，以刻刀代剪的江南细刻巅峰；所在中国剪纸项目是常州地区唯一入选人类非物质文化遗产代表作名录的项目（2009年）。' },
  { id: 'tr1', name: '段玉裁《说文解字注》刻本', rarity: '史诗',
    intro: '金坛籍乾嘉学者段玉裁倾三十余年撰成的三十卷巨著，彰明许书体例、考订词义变迁，王念孙序称“千七百年来无此作矣”，是汉字研究的巅峰之作。' },
  { id: 'tr2', name: '金坛封缸酒', rarity: '稀有',
    intro: '以糯米发酵压榨、密封陈缸的甜型黄酒，酒色金黄、甘甜醇厚；2008年列入第二批国家级非遗名录。元末朱元璋饮后赞绝的说法属民间传说层，仅作彩蛋标注。' },
  { id: 'tr3', name: '指前鱼灯', rarity: '普通',
    intro: '发源于金坛指前镇芦家村、源于长荡湖渔民“取兆讨吉”习俗的鱼灯（约二百余年），竹篾扎制、糊纸彩绘，入夜巡游寓意年年有余，系江苏省级非遗。' },
];

/* 宝物效果按名归类（有 data.effect 文案时以文案展示，效果键仍按名） */
const TR_RULE = {
  '金坛刻纸《大运河》长卷': 'peek', '段玉裁《说文解字注》刻本': 'draw2',
  '金坛封缸酒': 'heal2', '指前鱼灯': 'heal1',
};

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
  return name ? 'assets/yaji/' + name : '';
}

/* 技能的对战机制说明（games.json 技能文偏研学语境，这里补对战口径） */
function mechLine(ch) {
  const m = SKILL_MECH[ch && ch.id];
  return m ? '（对战：' + m + '）' : '';
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
    skillMech: SKILL_MECH[String(c.id || NAME_ID[name] || 'ch' + i)] || '',
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
              <span class="y-slip-face">
                ${c.img ? `<img src="${esc(c.img)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
                <span class="y-slip-fb" aria-hidden="true">${esc(c.name.slice(0, 1))}</span>
              </span>
              <span class="y-slip-name">${esc(c.name)}</span>
              <span class="y-slip-title"><i class="y-slip-no mono">${String(i + 1).padStart(2, '0')}</i>${esc(c.title)}</span>
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
  clearTimeout(trTimer);   // 不清的话，上一张小传的 8s 定时器会把下一张提前关掉
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
    if (act === 'tr-ok') { resolveTr(); return; }
    if (act === 'd-close') { els.detail.hidden = true; return; }
    if (act === 'who-o') {
      if (S.o) openDetail({ tag: '对家 · ' + S.o.ch.title, name: S.o.ch.name, eff: '【' + S.o.ch.skill + '】' + S.o.ch.blurb + mechLine(S.o.ch), hist: S.o.ch.history });
      return;
    }
    if (act === 'who-p') {
      if (S.p) openDetail({ tag: '执笔 · ' + S.p.ch.title, name: S.p.ch.name, eff: '【' + S.p.ch.skill + '】' + S.p.ch.blurb + mechLine(S.p.ch), hist: S.p.ch.history });
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
          <div class="y-cc-skill"><b>【${esc(c.skill)}】</b> ${esc(c.blurb)}${c.skillMech ? `<i class="y-cc-mech"> 对战：${esc(c.skillMech)}</i>` : ''}</div>
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
  S.trUsed = false;
  S.trPending = null;
  S.logOpen = false;
  els.log.hidden = true;

  S.p = { ch: pc, qi: pc.qi, mx: pc.qi, hand: [], played: [], bonus: 0, shield: false, absorb: false, hurtDraw: false };
  S.o = { ch: oc, qi: oc.qi, mx: oc.qi, hand: [], played: [], bonus: 0, shield: false, absorb: false, hurtDraw: false };

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
  S.turnDisc = false;   // 段玉裁【拆字解谜】每回合首次限制
  S.sel = -1;
  flash('第' + S.turn + '回合 · 著书立说');
  renderAll();
  await sleep(reduced() ? 120 : 650);
  if (!alive(ep)) return;

  if (S.cur === 'p') {
    drawC('p'); drawC('p');
    addLog('【准备】你摸了两张牌');
    // 陶弘景【洞天开卷】
    if (S.p.ch.id === 'taohongjing') { drawC('p'); addLog('【洞天开卷】' + S.p.ch.name + '额外摸一牌'); }
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
  // 王肯堂【本草问诊】
  if (S.p.ch.id === 'wangkentang' && S.p.qi > 0 && S.p.qi <= 2) {
    gainQi('p', 1, '本草问诊·望闻问切');
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

/* 回复统一入口：葛洪【丹火祛魅】所有回复 +1 */
function gainQi(who, n, tag) {
  const me = S[who];
  if (!me) return 0;
  const boost = me.ch.id === 'gehong' ? 1 : 0;
  const healed = Math.max(0, Math.min(me.mx, me.qi + n + boost) - me.qi);
  me.qi = Math.min(me.mx, me.qi + n + boost);
  if (healed > 0) {
    addLog((tag ? '【' + tag + '】' : '') + me.ch.name + '恢复' + healed + '点文气' + (boost ? '（丹火祛魅 +1）' : ''));
    fxNum(healed, 'heal');
  }
  return healed;
}

function doArticle(card, who) {
  const pl = S[who];
  const opk = who === 'p' ? 'o' : 'p';
  const op = S[opk];
  let dmg = 1 + (pl.bonus || 0);

  if (card.sp) {
    if (card.draw) { for (let i = 0; i < card.draw; i++) drawC(who); addLog('摸了' + card.draw + '牌'); }
    if (card.heal) gainQi(who, card.heal);
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
  } else {
    // 不撑铁骨（策牌效果）：抵消下一次文气损伤
    if (dmg > 0 && op.absorb) {
      op.absorb = false;
      dmg = 0;
      addLog('【不撑铁骨】' + op.ch.name + '铁骨支贫，抵消了这次损伤');
      fxSpark();
    }
    if (dmg > 0 && op.shield && Math.random() < 0.3) {
      op.shield = false;
      addLog('护盾生效，闪避了伤害！');
      toast('闪避！');
      dmg = 0;
    }
    if (dmg > 0) {
      op.qi = Math.max(0, op.qi - dmg);
      addLog(op.ch.name + '受' + dmg + '点损伤，剩余' + op.qi);
      fxShake();
      fxNum(dmg, 'dmg');
      // 戴叔伦【唤诗】：受伤后诗以遣怀
      if (op.ch.id === 'daishulun') {
        drawC(opk);
        addLog('【唤诗】' + op.ch.name + '诗以遣怀，摸一牌');
      }
      // 万里未归（策牌效果）：受损伤后摸一牌（一次性）
      if (op.hurtDraw) {
        op.hurtDraw = false;
        drawC(opk);
        addLog('【万里未归】诗寄乡愁，摸一牌');
      }
      // 段玉裁【拆字解谜】：进攻方每回合首次命中拆对手一牌
      if (pl.ch.id === 'duanyucai' && !S.turnDisc && op.hand.length) {
        S.turnDisc = true;
        const ri = (Math.random() * op.hand.length) | 0;
        const dc = op.hand.splice(ri, 1)[0];
        S.disc.push(dc);
        addLog('【拆字解谜】' + pl.ch.name + '六书拆字，拆得「' + dc.name + '」');
        fxSpark();
      }
    }
  }
}

/* 弃自己一张优先级最低的牌（策→宗→疗→宝→文） */
function discardWorst(who) {
  const me = S[who];
  if (!me.hand.length) return null;
  const rank = (c) => (c.type === 'jj' ? 0 : c.type === 'vic' ? 1 : c.cat === 'hel' ? 2 : c.type === 'treasure' ? 3 : 4);
  let worst = me.hand[0];
  for (const c of me.hand) if (rank(c) < rank(worst)) worst = c;
  me.hand.splice(me.hand.indexOf(worst), 1);
  S.disc.push(worst);
  return worst;
}

function doJJ(card, who) {
  const pl = S[who];
  const opk = who === 'p' ? 'o' : 'p';
  const op = S[opk];
  const k = String(card.key || '').split('_')[0];
  if (k === 'diyiliu') {                       // 山中宰相
    pl.bonus = (pl.bonus || 0) + 1;
    addLog('本回合立论伤害+1');
    fxSpark();
  } else if (k === 'zilichu') {                // 不撑铁骨
    pl.absorb = true;
    addLog('铁骨支贫，抵消下一次文气损伤');
    fxSpark();
  } else if (k === 'jiwendao') {               // 华阳洞天
    const dc = discardWorst(who);
    drawC(who); drawC(who);
    addLog((dc ? '弃「' + dc.name + '」，' : '') + '摸了两牌');
    fxNum(2, 'gain');
  } else if (k === 'piansanhe') {              // 周礼汉读考
    const info = op.hand.map((c) => c.name).join('、') || '（无手牌）';
    addLog('汉读考镜，' + op.ch.name + '手牌：' + info);
  } else if (k === 'yineiyanwai') {            // 万里未归
    pl.hurtDraw = true;
    addLog('诗寄乡愁：受损伤后摸一牌（一次）');
  } else if (k === 'jingshiwen') {             // 郁冈笔麈
    const dc = discardWorst(who);
    const ai = op.hand.findIndex((c) => c.type === 'article');
    if (ai >= 0) {
      const t = op.hand.splice(ai, 1)[0];
      S.disc.push(t);
      addLog((dc ? '弃「' + dc.name + '」，' : '') + '批削' + op.ch.name + '「' + t.name + '」');
    } else {
      addLog((dc ? '弃「' + dc.name + '」，' : '') + op.ch.name + '手中无文章可削');
    }
  } else if (k === 'bulizong') {               // 不立宗
    const dc = discardWorst(who);
    if (op.hand.length) {
      const ri = (Math.random() * op.hand.length) | 0;
      const t = op.hand.splice(ri, 1)[0];
      S.disc.push(t);
      addLog((dc ? '弃「' + dc.name + '」，' : '') + '不立宗派，' + op.ch.name + '弃「' + t.name + '」');
    } else {
      drawC(who);
      addLog((dc ? '弃「' + dc.name + '」，' : '') + '不立宗派，自摸一牌');
    }
  } else if (k === 'xingqingzhen') {           // 不耕砚田
    gainQi(who, 1);
  } else if (k === 'boxueyang') {              // 弃仕从医
    drawC(who); drawC(who);
    addLog('摸了两牌');
    fxNum(2, 'gain');
  } else {
    addLog('使用了「' + card.name + '」');
  }
}

function doZY(card, who) {
  const k = String(card.key || '').split('_')[0];
  if (k === 'tongchetu' || k === 'lunwentie') {
    gainQi(who, 1);
  } else if (k === 'yanghuhui') {
    gainQi('p', 1, '文人雅集');
    gainQi('o', 1, '文人雅集');
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
    addLog('【' + tr.name + '】织就护盾，闪避戒备');
  } else if (tr.rule === 'heal2') {
    gainQi(who, 2, tr.name);
  } else if (tr.rule === 'draw2') {
    drawC(who); drawC(who);
    addLog('【' + tr.name + '】开卷有益，摸了两张牌');
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
    gainQi(who, 1, tr.name);
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
  // 陶弘景【洞天开卷】
  if (S.o.ch.id === 'taohongjing') { drawC('o'); addLog('【洞天开卷】' + S.o.ch.name + '额外摸一牌'); }
  renderAll();
  await sleep(reduced() ? 150 : 700);
  if (!alive(ep)) return;

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
  // 王肯堂【本草问诊】
  if (S.o.ch.id === 'wangkentang' && S.o.qi > 0 && S.o.qi <= 2) {
    gainQi('o', 1, '本草问诊·望闻问切');
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
  // 1. 宝物（窥探类已用则跳过）
  const peekId = (S.trs.find((t) => t.rule === 'peek') || {}).id;
  let c = useful.find((x) => x.type === 'treasure' && !(x.trId === peekId && S.trUsed));
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
