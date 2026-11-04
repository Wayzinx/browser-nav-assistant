#!/usr/bin/env node
// 用例设计质量检查（nav-test-case-design 技能）。补充 .workflow/validators/validate.mjs cases 阶段之外的检查：
//   新增字段（category / technique / acceptanceRefs）、S/E 编号、AC 覆盖、Feature × 类别覆盖矩阵、
//   expected 是否具体、E2E 数量与步骤数、同一 Feature 下标题重复、用例之间是否互相依赖。
// 用法（在项目根目录执行）：node .agents/skills/nav-test-case-design/scripts/check-cases.mjs [--root=<dir>] [--json]
// 退出码：0 表示没有 error（warning 不影响退出码）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = path.resolve(HERE, '../../../..');

export const CATEGORIES = ['positive', 'negative', 'boundary', 'exception', 'security', 'performance', 'compatibility', 'state'];
export const TECHNIQUES = ['equivalence', 'boundary', 'decision-table', 'state-transition', 'error-guessing', 'scenario', 'pairwise'];
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const CASE_RE = /^TC-(API|E2E|UI)-([A-Z]{2,10})-(\d{3})$/;
const CASE_SCAN = /\bTC-(?:API|E2E|UI)-[A-Z]{2,10}-\d{3}\b/g;
const REF_RE = /^(F-[A-Z]{2,10}-\d{2})#AC(\d+)$/;
const MIN_E2E = 5; // validator 下限是 3；本技能要求至少 5 条，覆盖 PROBLEM.md 验收流程
const MIN_E2E_STEPS = 3;

// 含糊词：只有这些词、没有任何可断言锚点的 expected 判为不合格
const VAGUE = /(成功|正常|正确|合理|符合预期|无异常|没问题|生效|可用|良好|顺利|OK\b|ok\b|works?)/;
// 可断言锚点：数字、引号文本、标识符（字段名 / testId / 路径）、比较符号
const ANCHOR = /\d|[「」“”"'`]|[A-Za-z_][\w.\-/:]{2,}|[=≥≤<>]|\bnull\b|\btrue\b|\bfalse\b/;
// Feature 文本中出现这些内容时，认为存在数值 / 阈值 / 长度，需要 boundary 用例
const NUMERIC_HINT = /\d|阈值|上限|下限|长度|字符|最多|至少|超过|以内|不超过|天|条|毫秒|秒|分钟|limit|max|min|threshold/i;
// Feature 依赖外部资源（后端、浏览器 API、storage）时，需要 exception 用例
const EXTERNAL_HINT = /后端|网络|超时|不可用|不可达|离线|storage|存储|权限|chrome\.|history|tabs|持久化|文件|磁盘|fetch|service worker|SW/i;

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const readJson = (root, rel, errors, required = true) => {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) { if (required) errors.push(`缺少文件 ${rel}`); return null; }
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { errors.push(`${rel} 不是合法 JSON：${e.message}`); return null; }
};
const stripPrefix = (s) => String(s).replace(/^[SE]\d+[：:]\s*/, '');
const normTitle = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

/** 解析 Feature 的 AC 编号：优先用「AC<n>：」前缀，没有前缀时按顺序编号 */
function acList(f, warnings) {
  const list = Array.isArray(f.acceptance) ? f.acceptance : [];
  let unnumbered = false;
  const acs = list.map((text, i) => {
    const m = String(text).match(/^AC(\d+)[：:]/);
    if (!m) unnumbered = true;
    return { n: m ? Number(m[1]) : i + 1, text: String(text) };
  });
  if (unnumbered && list.length) warnings.push(`${f.id} 的 acceptance 缺少「AC<n>：」前缀，按顺序编号为 AC1…AC${list.length}（建议 PM 补上前缀）`);
  return acs;
}

/** 每个 inScope Feature 需要覆盖的类别「槽位」。每个槽位可以由若干类别满足。 */
function requiredSlots(f) {
  const text = [f.name, f.description, ...(f.acceptance || [])].join(' ')
    .replace(/\bAC\d+[：:]/g, '').replace(/\b[FC]-(?:FE-|BE-)?[A-Z]{2,10}-\d{2}\b/g, '');
  // nfr 的「正常负载下达标」用例本身就是 performance / security 类，可以同时满足正例槽位
  const positiveAccept = f.kind === 'nfr' ? ['positive', 'performance', 'security'] : ['positive'];
  const slots = [{ slot: 'positive', accept: positiveAccept, why: '每个 inScope Feature 至少 1 条正例' }];
  if (['action', 'api', 'rule'].includes(f.kind)) {
    slots.push({ slot: 'negative', accept: ['negative', 'security'], why: `kind=${f.kind} 需要非法输入 / 非法操作的反例` });
    if (NUMERIC_HINT.test(text)) slots.push({ slot: 'boundary', accept: ['boundary'], why: '描述或验收标准中有数值 / 阈值 / 长度，需要边界值用例' });
  }
  if ((f.layers || []).includes('FE') || EXTERNAL_HINT.test(text)) {
    slots.push({ slot: 'exception', accept: ['exception'], why: '依赖后端 / 浏览器 API / storage 等外部资源，需要异常用例（不可达、失败、超时）' });
  }
  if (f.kind === 'display') slots.push({ slot: 'state', accept: ['state', 'exception', 'boundary'], why: 'display 类需要覆盖加载 / 空 / 错误 / 离线等状态' });
  if (f.kind === 'nfr') slots.push({ slot: 'performance|security', accept: ['performance', 'security'], why: 'nfr 类需要性能或安全用例' });
  return slots;
}

export function checkCases({ root = DEFAULT_ROOT } = {}) {
  const errors = [];
  const warnings = [];
  const fj = readJson(root, 'docs/trace/features.json', errors);
  const aj = readJson(root, 'docs/trace/cases-api.json', errors);
  const uj = readJson(root, 'docs/trace/cases-ui.json', errors);
  const features = Array.isArray(fj?.features) ? fj.features : [];
  const fmap = new Map(features.filter((f) => f && f.id).map((f) => [f.id, f]));
  const cases = [
    ...((aj?.cases) || []).map((c) => ({ ...c, __file: 'cases-api.json' })),
    ...((uj?.cases) || []).map((c) => ({ ...c, __file: 'cases-ui.json' })),
  ];
  const waivers = [...((aj?.waivers) || []), ...((uj?.waivers) || [])];
  const acByFeature = new Map(features.map((f) => [f.id, acList(f, warnings)]));
  const acCovered = new Map(); // "F-XXX-01#AC1" -> [caseId]

  // ------------------------------------------------------------ 逐条用例
  const seen = new Set();
  for (const c of cases) {
    const id = c?.id;
    if (!isStr(id) || !CASE_RE.test(id)) { errors.push(`${c.__file} 中有非法 Case ID：${JSON.stringify(id)}`); continue; }
    if (seen.has(id)) errors.push(`重复的 Case ID：${id}`);
    seen.add(id);
    const E = (m) => errors.push(`${id}：${m}`);
    const W = (m) => warnings.push(`${id}：${m}`);

    if (!CATEGORIES.includes(c.category)) E(`category 缺失或非法（${JSON.stringify(c.category)}），可选 ${CATEGORIES.join(' / ')}`);
    if (!TECHNIQUES.includes(c.technique)) E(`technique 缺失或非法（${JSON.stringify(c.technique)}），可选 ${TECHNIQUES.join(' / ')}`);
    if (!PRIORITIES.includes(c.priority)) E(`priority 非法（${JSON.stringify(c.priority)}）`);

    // S / E 编号：从 1 开始连续
    for (const [field, letter] of [['steps', 'S'], ['expected', 'E']]) {
      const arr = c[field];
      if (!Array.isArray(arr) || !arr.length) { E(`${field} 不能为空`); continue; }
      arr.forEach((s, i) => {
        if (!new RegExp(`^${letter}${i + 1}[：:]`).test(String(s))) E(`${field}[${i}] 必须以「${letter}${i + 1}：」开头，实际为「${String(s).slice(0, 20)}」`);
      });
    }

    // expected 是否具体
    (c.expected || []).forEach((s, i) => {
      const body = stripPrefix(s).trim();
      if (body.length < 6) E(`E${i + 1} 过短（「${body}」），写清字段 / 数值 / 文本 / testId`);
      else if (!ANCHOR.test(body)) {
        if (VAGUE.test(body)) E(`E${i + 1} 含糊（「${body.slice(0, 40)}」）：只写了「成功 / 正常 / 正确」之类的结论，没有可断言的字段、数值、文本或 testId`);
        else W(`E${i + 1} 缺少可断言锚点（「${body.slice(0, 40)}」），建议写出字段名、具体值或 testId`);
      }
    });

    // acceptanceRefs
    const fset = new Set(Array.isArray(c.features) ? c.features : []);
    if (!Array.isArray(c.acceptanceRefs) || !c.acceptanceRefs.length) E('acceptanceRefs 不能为空，格式为 ["F-SYNC-01#AC1"]');
    for (const ref of c.acceptanceRefs || []) {
      const m = String(ref).match(REF_RE);
      if (!m) { E(`acceptanceRefs 中「${ref}」格式非法，应为 F-<MOD>-<NN>#AC<n>`); continue; }
      const [, fid, n] = m;
      const f = fmap.get(fid);
      if (!f) { E(`acceptanceRefs 引用了不存在的 Feature ${fid}`); continue; }
      if (!fset.has(fid)) E(`acceptanceRefs 引用的 ${fid} 不在用例的 features 中`);
      if (!(acByFeature.get(fid) || []).some((a) => a.n === Number(n))) { E(`acceptanceRefs 引用的 ${ref} 不存在（${fid} 共有 ${(acByFeature.get(fid) || []).length} 条 AC）`); continue; }
      if (!acCovered.has(ref)) acCovered.set(ref, []);
      acCovered.get(ref).push(id);
    }
    for (const fid of fset) {
      if (!fmap.has(fid)) E(`features 引用了不存在的 ${fid}`);
      else if (!(c.acceptanceRefs || []).some((r) => String(r).startsWith(fid + '#'))) W(`features 中的 ${fid} 没有任何 acceptanceRefs，确认该用例确实在验证它`);
    }

    // 独立性：前置条件和步骤中不得引用其他 Case
    for (const field of ['preconditions', 'steps']) {
      const refs = (Array.isArray(c[field]) ? c[field] : []).join('\n').match(CASE_SCAN) || [];
      const others = [...new Set(refs.filter((x) => x !== id))];
      if (others.length) E(`${field} 引用了其他用例 ${others.join(', ')}：每个用例对应一个独立脚本，必须自带数据构造，不能依赖其他用例`);
    }

    if (c.type === 'E2E') {
      if ((c.steps || []).length < MIN_E2E_STEPS) E(`E2E 用例至少 ${MIN_E2E_STEPS} 步，实际 ${(c.steps || []).length} 步`);
      if (fset.size < 2) W('E2E 用例只关联了 1 个 Feature，确认它是真实的端到端链路');
    }
  }

  // ------------------------------------------------------------ E2E 数量
  const e2e = cases.filter((c) => c.type === 'E2E');
  if (e2e.length < MIN_E2E) errors.push(`E2E 用例只有 ${e2e.length} 条，本技能要求至少 ${MIN_E2E} 条（validator 下限为 3 条），需覆盖 PROBLEM.md 验收流程`);

  // ------------------------------------------------------------ 同一 Feature 下标题重复
  const titleByFeature = new Map();
  for (const c of cases) for (const fid of c.features || []) {
    const key = `${fid}::${normTitle(c.title)}`;
    if (!c.title) continue;
    if (titleByFeature.has(key)) errors.push(`${c.id} 与 ${titleByFeature.get(key)} 在 ${fid} 下标题重复（「${c.title}」）`);
    else titleByFeature.set(key, c.id);
  }

  // ------------------------------------------------------------ waiver 合法性
  const waived = new Map(); // fid -> Set(category)
  for (const w of waivers) {
    if (!w || !fmap.has(w.feature)) { errors.push(`waiver 引用了不存在的 Feature：${JSON.stringify(w?.feature)}`); continue; }
    if (!isStr(w.reason) || w.reason.trim().length < 8) errors.push(`${w.feature} 的 waiver（${w.category}）缺少理由，或理由过短`);
    if (w.category === 'positive') errors.push(`${w.feature} 的 positive 不能豁免：每个 inScope Feature 至少要有 1 条正例`);
    if (!CATEGORIES.includes(w.category)) errors.push(`${w.feature} 的 waiver category 非法：${JSON.stringify(w.category)}`);
    if (!waived.has(w.feature)) waived.set(w.feature, new Set());
    waived.get(w.feature).add(w.category);
  }

  // ------------------------------------------------------------ Feature × 类别矩阵 + AC 覆盖
  const matrix = [];
  const gaps = [];
  let acTotal = 0;
  let acHit = 0;
  const acMissing = [];
  for (const f of features.filter((x) => x && x.inScope === true)) {
    const fc = cases.filter((c) => (c.features || []).includes(f.id));
    const cats = {};
    for (const c of fc) cats[c.category] = (cats[c.category] || 0) + 1;
    const missing = [];
    for (const s of requiredSlots(f)) {
      if (s.accept.some((k) => cats[k])) continue;
      if (s.accept.some((k) => waived.get(f.id)?.has(k)) || waived.get(f.id)?.has(s.slot)) continue;
      missing.push(s.slot);
      errors.push(`${f.id}（${f.name}）缺少 ${s.slot} 类用例：${s.why}；不适用时在 cases JSON 根节点的 waivers 中写明理由`);
    }
    for (const k of waived.get(f.id) || []) if (cats[k]) warnings.push(`${f.id} 的 ${k} 已有用例覆盖，waiver 已过时，可以删除`);
    if (missing.length) gaps.push({ feature: f.id, name: f.name, missing });
    for (const a of acByFeature.get(f.id) || []) {
      acTotal++;
      const ref = `${f.id}#AC${a.n}`;
      if (acCovered.has(ref)) acHit++;
      else { acMissing.push(ref); errors.push(`${ref} 没有任何用例覆盖（${a.text.slice(0, 50)}）`); }
    }
    matrix.push({ feature: f.id, name: f.name, kind: f.kind, layers: f.layers, priority: f.priority, cases: fc.length, categories: cats, waived: [...(waived.get(f.id) || [])], missing });
  }
  for (const c of cases) for (const fid of c.features || []) {
    if (fmap.get(fid) && fmap.get(fid).inScope === false) warnings.push(`${c.id} 测试的是 inScope=false 的 ${fid}`);
  }

  const dist = (key) => cases.reduce((m, c) => { const k = c[key] || '(缺失)'; m[k] = (m[k] || 0) + 1; return m; }, {});
  return {
    pass: errors.length === 0,
    errors,
    warnings,
    stats: {
      cases: cases.length,
      byType: dist('type'),
      byCategory: dist('category'),
      byPriority: dist('priority'),
      byTechnique: dist('technique'),
      e2e: e2e.length,
      acCoverage: { total: acTotal, covered: acHit, rate: acTotal ? Number((acHit / acTotal).toFixed(4)) : null, missing: acMissing },
      categoryGaps: gaps,
      waivers: waivers.length,
    },
    matrix,
  };
}

// ---------------------------------------------------------------- CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const rootArg = (args.find((a) => a.startsWith('--root=')) || '').slice(7);
  const r = checkCases({ root: rootArg ? path.resolve(rootArg) : DEFAULT_ROOT });
  if (args.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else {
    for (const e of r.errors) console.log(`✖ ${e}`);
    for (const w of r.warnings) console.log(`⚠ ${w}`);
    const s = r.stats;
    const ac = s.acCoverage;
    console.log(`\n${r.pass ? '✔ 通过' : '✖ 未通过'}：${r.errors.length} 个错误，${r.warnings.length} 个警告`);
    console.log(`用例 ${s.cases} 条：类型 ${JSON.stringify(s.byType)}；类别 ${JSON.stringify(s.byCategory)}；优先级 ${JSON.stringify(s.byPriority)}`);
    console.log(`AC 覆盖 ${ac.covered}/${ac.total}${ac.rate === null ? '' : `（${(ac.rate * 100).toFixed(1)}%）`}；类别缺口 ${s.categoryGaps.length} 个 Feature；E2E ${s.e2e} 条；waiver ${s.waivers} 条`);
  }
  process.exit(r.pass ? 0 : 1);
}
