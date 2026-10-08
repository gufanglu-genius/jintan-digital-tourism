#!/usr/bin/env node
/* 内容熔炉产出 → public/data/*.json 集成器
 * 用法：node scripts/integrate-content.js [journalDir]
 * - 取每个 c-* agent 的 content，verify-* 的 corrected 覆盖之（无 corrected 则用原包）
 * - 把 research（sites / ich）的经纬度与镇街按名称模糊并入 points
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'public', 'data');
const journalDir =
  process.argv[2] ||
  path.join(
    process.env.HOME,
    '.claude/projects/-Users-chenhuidediannao/946e83a4-a20a-4c66-9fbf-47393d5be357/subagents/workflows/wf_b8ac7c93-395'
  );

// ---- 1. label → agentId（meta.json）----
const labelByAgent = {};
for (const f of fs.readdirSync(journalDir)) {
  if (!f.endsWith('.meta.json')) continue;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(journalDir, f), 'utf8'));
    const agentId = f.replace(/^agent-/, '').replace(/\.meta\.json$/, '');
    if (meta.description) labelByAgent[agentId] = meta.description;
  } catch {}
}

// ---- 2. journal：agentId → result ----
const resultByLabel = {};
const lines = fs.readFileSync(path.join(journalDir, 'journal.jsonl'), 'utf8').split('\n');
for (const line of lines) {
  if (!line.trim()) continue;
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    continue;
  }
  if (e.type !== 'result' || !e.agentId) continue;
  const label = labelByAgent[e.agentId];
  if (label) resultByLabel[label] = e.result;
}

const bundleNames = ['points', 'personas', 'story', 'quiz', 'games', 'tts', 'gene'];

// ---- 3. 组装最终 content ----
const finalContent = {};
const report = [];
for (const name of bundleNames) {
  const created = resultByLabel['c-' + name];
  const verified = resultByLabel['verify-' + name];
  let content = null;
  let source = 'MISSING';
  if (verified && verified.corrected) {
    content = verified.corrected;
    source = verified.ok ? 'verified-clean' : 'verified-corrected';
  } else if (created && created.content) {
    content = created.content;
    source = created ? 'created-unverified' : 'created-unverified';
  }
  if (!content) {
    report.push(`  ✗ ${name}: 无产出`);
    continue;
  }
  finalContent[name] = content;
  const issues = verified && verified.issues ? verified.issues : [];
  report.push(`  ✓ ${name}: ${source}${issues.length ? '，修正 ' + issues.length + ' 处' : ''}`);
}

// ---- 4. 坐标/镇街并入 points ----
const researchSites = (resultByLabel['sites-coords'] || {}).sites || [];
const researchIch = (resultByLabel['ich-records'] || {}).items || [];
const coordSource = [...researchSites, ...researchIch].filter((s) => s && s.name);

function norm(s) {
  return String(s || '')
    .replace(/[（(].*?[)）]/g, '')
    .replace(/[·•・\s]/g, '')
    .trim();
}
function coreMatch(a, b) {
  const na = norm(a);
  const n = norm(b);
  if (!na || !n) return false;
  if (na.includes(n) || n.includes(na)) return true;
  const k = Math.min(4, na.length, n.length);
  return k >= 3 && na.slice(0, k) === n.slice(0, k);
}

if (finalContent.points && Array.isArray(finalContent.points.points)) {
  let joined = 0;
  for (const p of finalContent.points.points) {
    const hit = coordSource.find((s) => coreMatch(p.name, s.name));
    if (!hit) continue;
    if (p.lat == null && typeof hit.lat === 'number') p.lat = hit.lat;
    if (p.lng == null && typeof hit.lng === 'number') p.lng = hit.lng;
    if (!p.town && hit.town) p.town = hit.town;
    if (!p.level && hit.level) p.level = hit.level;
    joined++;
  }
  const withCoord = finalContent.points.points.filter((p) => typeof p.lat === 'number').length;
  report.push(`  ↳ points：${finalContent.points.points.length} 个点位，坐标并入 ${joined}，共 ${withCoord} 个有经纬度`);
}

// ---- 5. 落盘 ----
fs.mkdirSync(DATA_DIR, { recursive: true });
for (const [name, content] of Object.entries(finalContent)) {
  const file = path.join(DATA_DIR, name + '.json');
  fs.writeFileSync(file, JSON.stringify(content, null, 2) + '\n', 'utf8');
}
console.log('集成完成 → public/data/');
console.log(report.join('\n'));
const missing = bundleNames.filter((n) => !finalContent[n]);
if (missing.length) {
  console.log('⚠ 缺失：' + missing.join(', '));
  process.exitCode = 2;
}
