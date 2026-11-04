#!/usr/bin/env node
// 需求点与 Feature 的补充校验（nav-req-analysis 技能）。它与 .workflow/validators/validate.mjs prd 互补：
// validator 负责 CONVENTIONS 的硬性结构；本脚本检查「需求点是否摘录完整、是否真实存在于 PROBLEM.md」
// 「必做需求是否都映射到 Feature」「验收标准是否可测试」。
//
// 用法（在项目根目录执行）：
//   node .agents/skills/nav-req-analysis/scripts/check-requirements.mjs                 # 全量检查（PRD 阶段）
//   node .agents/skills/nav-req-analysis/scripts/check-requirements.mjs --stage=understand  # 只检查 requirements.json（还没有 features.json 时）
//   node .agents/skills/nav-req-analysis/scripts/check-requirements.mjs --dump-items    # 列出 PROBLEM.md 中需要被 REQ 覆盖的条目
//   选项：--root=<项目根目录>  --json
// 退出码：0 表示没有 error（warning 不影响退出码）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const ROOT = opt('root') ? path.resolve(opt('root')) : path.resolve(HERE, '../../../..');
const STAGE = opt('stage', 'prd');
const AS_JSON = args.includes('--json');

const PATHS = {
  problem: 'PROBLEM.md',
  requirements: 'docs/trace/requirements.json',
  features: 'docs/trace/features.json',
  prd: 'docs/02-PRD.md',
};
// 需要逐条被 REQ 覆盖的 PROBLEM.md 一级章节（题目目标 / 背景只作参考，不强制摘录）
const COVER_SECTIONS = ['总体约束', '系统架构说明', '核心数据模型', '必做功能', '进阶要求', '验收要求', '交付物', '提示'];
// 段落句只要求「建议覆盖」（warning），列表项和表格行要求必须覆盖（error）
const PARAGRAPH_SECTIONS = ['总体约束', '系统架构说明', '必做功能', '进阶要求', '验收要求', '交付物'];
const REQ_KINDS = ['functional', 'constraint', 'nfr', 'acceptance', 'deliverable', 'advanced', 'hint', 'interview'];
const RE_REQ = /^REQ-(\d{3})$/;
const SCAN_REQ = /\bREQ-\d{3}\b/g;
const RE_F = /^F-([A-Z]{2,10})-(\d{2})$/;
const RE_D = /^D-\d{2}$/;
// 含糊词：引号内的字面量（例如 UI 上显示的「正常」）会先被剔除，不参与检测
const VAGUE = ['正常', '正确', '合理', '体验良好', '符合预期', '友好', '适当', '恰当', '合适', '等等', '尽量', '尽可能', '较快', '较好', '较少', '流畅', '美观', '清晰', '完善', '一定程度', '基本可用', '大致', '若干', '相关内容', '及时'];

const R = { stage: STAGE, pass: true, errors: [], warnings: [], stats: {} };
const err = (m) => R.errors.push(m);
const warn = (m) => R.warnings.push(m);

// ---------------------------------------------------------------- 工具

function readText(rel, required = true) {
  const f = path.join(ROOT, rel);
  if (!fs.existsSync(f)) { if (required) err(`缺少文件 ${rel}`); return null; }
  return fs.readFileSync(f, 'utf8');
}
function readJson(rel, required = true) {
  const t = readText(rel, required);
  if (t == null) return null;
  try { return JSON.parse(t); } catch (e) { err(`${rel} 不是合法 JSON：${e.message}`); return null; }
}
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const noSpace = (s) => String(s).replace(/\s+/g, '');
const noMarkup = (s) => noSpace(s).replace(/[*`]/g, '');
// 覆盖匹配用的规范化：去掉空白、markdown 标记和中英文标点，统一小写
const norm = (s) => String(s).toLowerCase().replace(/[\s*`|，。、；：:;,.!！?？（）()【】[\]「」“”"'‘’《》<>…—\-_/=+~]/g, '');
const short = (s, n = 60) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };

// ---------------------------------------------------------------- 从 PROBLEM.md 抽取需要覆盖的条目

export function extractItems(md) {
  const items = [];
  const lines = md.split('\n');
  let top = '', sub = '', bold = '', inCode = false, codeLang = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s*```(\S*)/);
    if (fence) { inCode = !inCode; codeLang = inCode ? fence[1] : ''; continue; }
    const coverTop = COVER_SECTIONS.find((s) => top.includes(s));
    const section = [top, sub, bold].filter(Boolean).join(' > ');
    const trimmed = line.trim();
    if (inCode) {
      // 代码块里只抽取接口声明行（POST /api/sync）和无语言标记代码块中的公式行（score = …），JSON 示例一律跳过
      if (!coverTop || !trimmed) continue;
      if (/^(?:GET|POST|PUT|PATCH|DELETE)\s+\/\S+$/.test(trimmed)) items.push({ line: i + 1, section, kind: 'endpoint', level: 'required', text: trimmed });
      else if (!codeLang && /^[A-Za-z]\w*\s*=\s*\S/.test(trimmed)) items.push({ line: i + 1, section, kind: 'formula', level: 'required', text: trimmed });
      continue;
    }
    const h1 = line.match(/^#\s+(.+)/);
    if (h1) { top = h1[1].trim(); sub = ''; bold = ''; continue; }
    const h2 = line.match(/^#{2,6}\s+(.+)/);
    if (h2) {
      sub = h2[1].trim(); bold = '';
      // 核心数据模型的每个模型标题（页面记录（Page）等）都要有对应的需求点
      if (top.includes('核心数据模型')) items.push({ line: i + 1, section: top, kind: 'heading', level: 'required', text: sub });
      continue;
    }
    if (!coverTop || !trimmed) continue;
    const boldOnly = trimmed.match(/^\*\*([^*]+)\*\*[:：]?$/);
    if (boldOnly) { bold = boldOnly[1].replace(/[:：]$/, '').trim(); continue; } // 加粗小标题只用来标注所属区块

    if (trimmed.startsWith('|')) {
      if (/^\|[\s:|-]+\|?$/.test(trimmed)) continue; // 分隔行
      if (/^\|[\s:|-]+\|?$/.test((lines[i + 1] || '').trim())) continue; // 表头行（下一行是分隔行）
      const cells = trimmed.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).filter(Boolean);
      items.push({ line: i + 1, section, kind: 'table', level: 'required', text: cells.join(' | ') });
      continue;
    }
    const li = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.*)$/);
    if (li) {
      items.push({ line: i + 1, section, kind: 'list', level: 'required', text: li[1].trim() });
      continue;
    }
    if (!PARAGRAPH_SECTIONS.some((s) => top.includes(s))) continue;
    if (norm(trimmed).length < 10) continue; // 「返回示例：」「后端接口：」这类引导句
    items.push({ line: i + 1, section, kind: 'paragraph', level: 'suggested', text: trimmed });
  }
  return items;
}

/** 条目被覆盖：某条 quote 包含整个条目；或者若干条 quote 是条目的子串，合起来覆盖了条目 80% 以上的字符 */
function coverOf(item, quotes) {
  const t = norm(item.text);
  if (!t) return { covered: true, by: [] };
  const mask = new Uint8Array(t.length);
  const by = [];
  for (const q of quotes) {
    if (!q.n) continue;
    if (q.n.includes(t)) return { covered: true, by: [q.id] };
    let from = 0, idx, hit = false;
    while ((idx = t.indexOf(q.n, from)) >= 0) { mask.fill(1, idx, idx + q.n.length); from = idx + 1; hit = true; }
    if (hit) by.push(q.id);
  }
  const ratio = mask.reduce((s, x) => s + x, 0) / t.length;
  return { covered: ratio >= 0.8, by, ratio };
}

// ---------------------------------------------------------------- requirements.json

function checkRequirements(problem, items) {
  const j = readJson(PATHS.requirements);
  const list = Array.isArray(j?.requirements) ? j.requirements : [];
  if (j && !Array.isArray(j.requirements)) err(`${PATHS.requirements} 缺少 requirements 数组`);
  if (j && !list.length) err(`${PATHS.requirements} 中没有任何需求点`);

  const strict = noSpace(problem);
  const lenient = noMarkup(problem);
  const ids = [];
  const seen = new Set();
  let lastPos = -1;
  const outOfOrder = [];
  for (const r of list) {
    const id = r?.id;
    if (!isStr(id) || !RE_REQ.test(id)) { err(`非法 REQ ID：${JSON.stringify(id)}（格式 REQ-001）`); continue; }
    if (seen.has(id)) err(`重复的 REQ ID：${id}`);
    seen.add(id);
    ids.push(Number(id.slice(4)));
    if (!isStr(r.section)) err(`${id} 缺少 section（PROBLEM.md 章节，例如「必做功能 2. 浏览器数据同步到后端」）`);
    if (!REQ_KINDS.includes(r.kind)) err(`${id} 的 kind 非法(${r.kind})，可选 ${REQ_KINDS.join('/')}`);
    if (typeof r.mandatory !== 'boolean') err(`${id} 缺少布尔类型的 mandatory`);
    if (typeof r.inScope !== 'boolean') err(`${id} 缺少布尔类型的 inScope`);
    if (!Array.isArray(r.features)) err(`${id} 的 features 必须是数组（没有映射时写 []）`);
    if (r.note != null && typeof r.note !== 'string') err(`${id} 的 note 必须是字符串`);
    if (!isStr(r.quote)) { err(`${id} 缺少 quote（PROBLEM.md 原文逐字摘录）`); continue; }
    const found = strict.includes(noSpace(r.quote)) || lenient.includes(noMarkup(r.quote));
    if (!found) err(`${id} 的 quote 在 PROBLEM.md 中找不到原文：「${short(r.quote)}」（必须逐字摘录，不要改写或合并多处原文）`);
    else {
      // 同一句话可能在前文（例如题目目标）出现过：优先从上一条 REQ 的位置往后找
      const q = noMarkup(r.quote);
      let pos = lenient.indexOf(q, Math.max(0, lastPos));
      if (pos < 0) { pos = lenient.indexOf(q); outOfOrder.push(id); }
      lastPos = pos; // 只和前一条比较，避免一处乱序导致后面全部报警
    }
    if (r.mandatory === true && r.inScope === false) err(`${id} 是必做需求（mandatory=true），不能置为 inScope=false；确属可选时把 mandatory 改为 false 并在 note 中说明`);
    if (['advanced', 'hint', 'interview'].includes(r.kind) && r.mandatory === true) warn(`${id} 的 kind 为 ${r.kind}，但标记为 mandatory=true，请确认`);
  }
  if (outOfOrder.length) warn(`${outOfOrder.length} 条 REQ 的原文位置早于前一条 REQ（REQ 应按 PROBLEM.md 中出现的顺序编号）：${outOfOrder.slice(0, 15).join(', ')}${outOfOrder.length > 15 ? ' …' : ''}`);
  const fmt = (n) => `REQ-${String(n).padStart(3, '0')}`;
  const idSet = new Set(ids);
  const gaps = [];
  for (let n = 1; n <= Math.max(0, ...ids); n++) if (!idSet.has(n)) gaps.push(fmt(n));
  if (gaps.length) err(`REQ 编号不连续，缺少：${gaps.slice(0, 20).join(', ')}${gaps.length > 20 ? ' …' : ''}（编号从 REQ-001 起连续；删除的需求点保留 ID 并置 inScope=false）`);
  if (ids.some((n, i) => i > 0 && n < ids[i - 1])) warn('requirements 数组中的 REQ 没有按编号升序排列');

  // 完整性：PROBLEM.md 中的每个条目都要被某条 REQ 的 quote 覆盖
  const quotes = list.filter((r) => isStr(r?.quote)).map((r) => ({ id: r.id, n: norm(r.quote) }));
  const uncovered = [];
  for (const it of items) {
    const c = coverOf(it, quotes);
    if (c.covered) continue;
    uncovered.push({ line: it.line, section: it.section, kind: it.kind, level: it.level, text: it.text });
    const msg = `PROBLEM.md 第 ${it.line} 行（${it.section}）没有被任何 REQ 覆盖：「${short(it.text, 80)}」`;
    if (it.level === 'required') err(msg); else warn(`[建议覆盖] ${msg}`);
  }
  const required = items.filter((x) => x.level === 'required');
  const reqUncovered = uncovered.filter((x) => x.level === 'required');
  R.stats.requirements = {
    total: list.length,
    mandatory: list.filter((r) => r?.mandatory === true).length,
    mandatoryInScope: list.filter((r) => r?.mandatory === true && r?.inScope === true).length,
    byKind: Object.fromEntries(REQ_KINDS.map((k) => [k, list.filter((r) => r?.kind === k).length]).filter(([, n]) => n)),
  };
  R.stats.problemItems = {
    required: required.length,
    requiredCovered: required.length - reqUncovered.length,
    requiredCoverage: required.length ? Number(((required.length - reqUncovered.length) / required.length).toFixed(4)) : null,
    suggested: items.length - required.length,
    suggestedUncovered: uncovered.length - reqUncovered.length,
    uncovered,
  };
  return list;
}

// ---------------------------------------------------------------- features.json

function checkAcceptance(f) {
  const acs = Array.isArray(f.acceptance) ? f.acceptance : [];
  acs.forEach((raw, i) => {
    const where = `${f.id} 的第 ${i + 1} 条验收标准`;
    if (!isStr(raw)) { err(`${where} 为空`); return; }
    const m = raw.match(/^AC(\d+)([：:])\s*/);
    if (!m) { err(`${where} 必须以「AC${i + 1}：」开头：「${short(raw)}」`); return; }
    if (Number(m[1]) !== i + 1) err(`${where} 编号为 AC${m[1]}，应为 AC${i + 1}（从 1 开始连续编号；已发布的编号只能追加，不能重排）`);
    if (m[2] === ':') warn(`${where} 使用了半角冒号，统一写成「AC${i + 1}：」`);
    const body = raw.slice(m[0].length);
    const g = body.search(/\bGiven\b/i), w = body.search(/\bWhen\b/i), t = body.search(/\bThen\b/i);
    if (g < 0 || w < 0 || t < 0 || !(g < w && w < t)) err(`${where} 必须按「Given … When … Then …」的顺序书写：「${short(raw)}」`);
    // 含糊词：先剔除引号内的字面量；「不正确」「非正常」这类描述非法输入的说法不算
    const outsideQuotes = body.replace(/「[^」]*」|“[^”]*”|"[^"]*"|'[^']*'|`[^`]*`|『[^』]*』/g, ' ');
    const vague = VAGUE.filter((v) => new RegExp(`(?<![不非])${v}`).test(outsideQuotes));
    if (vague.length) err(`${where} 含有含糊词「${vague.join('、')}」，请改成可观察的具体结果：「${short(raw)}」`);
    // 可观察锚点：数字、引号字面量、英文标识符 / testId / 接口路径
    const stripped = body.replace(/\b(?:Given|When|Then|And)\b/gi, ' ');
    const anchor = /\d/.test(stripped) || /「[^」]+」|“[^”]+”|"[^"]+"|`[^`]+`|『[^』]+』/.test(stripped) || /\/api\//.test(stripped) || /[A-Za-z_][A-Za-z0-9_.-]{2,}/.test(stripped);
    if (!anchor) err(`${where} 没有可观察的锚点（具体数值、引号中的文本、字段名 / testId / 接口路径），无法写成断言：「${short(raw)}」`);
  });
  return acs.length;
}

function checkFeatures(reqList) {
  const j = readJson(PATHS.features);
  const list = Array.isArray(j?.features) ? j.features : [];
  if (j && !Array.isArray(j.features)) err(`${PATHS.features} 缺少 features 数组`);
  const fmap = new Map(list.filter((f) => isStr(f?.id)).map((f) => [f.id, f]));
  const reqIds = new Set(reqList.map((r) => r?.id).filter(Boolean));
  const reqMap = new Map(reqList.filter((r) => r?.id).map((r) => [r.id, r]));
  let acTotal = 0;

  for (const f of list) {
    if (!isStr(f?.id) || !RE_F.test(f.id)) { err(`非法 Feature ID：${JSON.stringify(f?.id)}`); continue; }
    acTotal += checkAcceptance(f);
    const refs = String(f.source || '').match(SCAN_REQ) || [];
    if (!refs.length) warn(`${f.id} 的 source 没有引用 REQ（约定格式：「REQ-012；PROBLEM.md 必做功能 2」）`);
    for (const rid of refs) {
      if (!reqIds.has(rid)) err(`${f.id} 的 source 引用了不存在的 ${rid}`);
      else if (!(reqMap.get(rid).features || []).includes(f.id)) warn(`${f.id} 的 source 引用了 ${rid}，但 ${rid}.features 中没有 ${f.id}（双向映射不一致）`);
    }
  }

  // REQ → Feature 映射
  const referenced = new Set();
  for (const r of reqList) {
    if (!r?.id || !Array.isArray(r.features)) continue;
    for (const fid of r.features) {
      if (!fmap.has(fid)) err(`${r.id} 引用了不存在的 Feature ${fid}`);
      else referenced.add(fid);
    }
    if (r.mandatory === true && r.inScope === true && !r.features.some((fid) => fmap.get(fid)?.inScope === true)) {
      err(`必做需求 ${r.id}（${short(r.quote, 40)}）没有映射到任何 inScope 的 Feature`);
    }
  }
  const inScope = list.filter((f) => f?.inScope === true);
  for (const f of inScope) if (!referenced.has(f.id)) warn(`Feature ${f.id}（${f.name}）没有被任何 REQ 引用：来源不明，请补充 REQ 映射或说明为推断需求`);
  if (inScope.length && (inScope.length < 40 || inScope.length > 70)) warn(`inScope 的 Feature 有 ${inScope.length} 个，预期在 40–70 个之间，请复核粒度`);

  // 决策记录
  const decisions = Array.isArray(j?.decisions) ? j.decisions : [];
  if (j && !decisions.length) err(`${PATHS.features} 的 decisions 为空：每个待确认问题的定案都要记录为 D-NN`);
  const dseen = new Set();
  for (const d of decisions) {
    if (!isStr(d?.id) || !RE_D.test(d.id)) err(`非法决策 ID：${JSON.stringify(d?.id)}（格式 D-01）`);
    else if (dseen.has(d.id)) err(`重复的决策 ID：${d.id}`);
    else dseen.add(d.id);
    for (const k of ['question', 'decision', 'reason']) if (!isStr(d?.[k])) err(`决策 ${d?.id || '?'} 缺少 ${k}`);
  }

  // PRD 中的 REQ 追溯（建议项）
  const prd = readText(PATHS.prd, false);
  if (prd != null) {
    const inPrd = new Set(prd.match(SCAN_REQ) || []);
    const missing = [...new Set(reqList.filter((r) => r?.inScope && r?.id && !inPrd.has(r.id)).map((r) => r.id))];
    if (missing.length) warn(`PRD 的「需求点追溯」附录中缺少 ${missing.length} 个 inScope REQ：${missing.slice(0, 15).join(', ')}${missing.length > 15 ? ' …' : ''}`);
    for (const id of inPrd) if (!reqIds.has(id)) err(`PRD 中出现了未登记的 ${id}`);
  }

  const mandatoryInScope = reqList.filter((r) => r?.mandatory === true && r?.inScope === true);
  const mapped = mandatoryInScope.filter((r) => (r.features || []).some((fid) => fmap.get(fid)?.inScope === true));
  R.stats.features = { total: list.length, inScope: inScope.length, acceptanceTotal: acTotal, decisions: decisions.length, unreferencedInScope: inScope.filter((f) => !referenced.has(f.id)).length };
  R.stats.mapping = { mandatoryInScope: mandatoryInScope.length, mapped: mapped.length, coverage: mandatoryInScope.length ? Number((mapped.length / mandatoryInScope.length).toFixed(4)) : null };
}

// ---------------------------------------------------------------- 主流程

const problem = readText(PATHS.problem);
if (problem != null) {
  const items = extractItems(problem);
  if (args.includes('--dump-items')) {
    if (AS_JSON) console.log(JSON.stringify(items, null, 2));
    else {
      let last = '';
      for (const it of items) {
        if (it.section !== last) { console.log(`\n## ${it.section}`); last = it.section; }
        console.log(`  L${it.line} [${it.kind}${it.level === 'suggested' ? '·建议' : ''}] ${it.text}`);
      }
      console.log(`\n共 ${items.length} 条：必须覆盖 ${items.filter((x) => x.level === 'required').length} 条（列表项 / 表格行 / 接口声明 / 公式 / 数据模型标题），建议覆盖 ${items.filter((x) => x.level === 'suggested').length} 条（段落句）`);
    }
    process.exit(0);
  }
  const reqList = checkRequirements(problem, items);
  if (STAGE !== 'understand') checkFeatures(reqList);
}

R.pass = R.errors.length === 0;
if (AS_JSON) console.log(JSON.stringify(R, null, 2));
else {
  for (const e of R.errors) console.log(`✖ ${e}`);
  for (const w of R.warnings) console.log(`⚠ ${w}`);
  const s = R.stats;
  const pct = (x) => (x == null ? '-' : `${(x * 100).toFixed(1)}%`);
  console.log(`\n${R.pass ? '✔ 通过' : '✖ 未通过'}（stage=${STAGE}）：${R.errors.length} 个错误，${R.warnings.length} 个警告`);
  if (s.requirements) console.log(`  REQ：共 ${s.requirements.total} 条，mandatory ${s.requirements.mandatory} 条（其中 inScope ${s.requirements.mandatoryInScope} 条）`);
  if (s.problemItems) console.log(`  PROBLEM.md 条目覆盖：必须项 ${s.problemItems.requiredCovered}/${s.problemItems.required}（${pct(s.problemItems.requiredCoverage)}），建议项未覆盖 ${s.problemItems.suggestedUncovered}/${s.problemItems.suggested}`);
  if (s.mapping) console.log(`  必做 REQ → inScope Feature 映射：${s.mapping.mapped}/${s.mapping.mandatoryInScope}（${pct(s.mapping.coverage)}）`);
  if (s.features) console.log(`  Feature：inScope ${s.features.inScope}/${s.features.total}，验收标准 ${s.features.acceptanceTotal} 条，决策 ${s.features.decisions} 条`);
}
process.exit(R.pass ? 0 : 1);
