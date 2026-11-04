#!/usr/bin/env node
// 质量指标汇总与准出判定（nav-quality-report 技能）。只读取已有的产物文件，自己不执行测试。
// 用法（在项目根目录执行）：
//   node .agents/skills/nav-quality-report/scripts/collect-metrics.mjs              # 生成 docs/quality/metrics.json + metrics.md
//   node .agents/skills/nav-quality-report/scripts/collect-metrics.mjs --inject     # 再把 metrics.md 写入 docs/08-测试报告.md 的自动区块
//   node .agents/skills/nav-quality-report/scripts/collect-metrics.mjs --check-report  # 自检：报告中的数字和结论是否与 metrics 一致
// 选项：--root=<dir>  --json（把 metrics.json 打印到 stdout）  --manifest=<提交包 MANIFEST.json 路径>
//       （不传时依次查找 bundles/MANIFEST.json、.workflow/reports/validate-submission.json 中记录的 manifestPath）
// 指标口径见 ../references/metrics.md。数据缺失时指标记为「未采集」，并且一律不判为达标。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintScripts } from '../../nav-case-to-script/scripts/lint-scripts.mjs';
import { buildEvidenceIndex } from '../../nav-case-to-script/scripts/run-cases.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const ROOT = opt('root') ? path.resolve(opt('root')) : path.resolve(HERE, '../../../..');
const REPORT = 'docs/08-测试报告.md';
const BEGIN = '<!-- METRICS:BEGIN -->';
const END = '<!-- METRICS:END -->';
const VERDICTS = ['准出', '有条件准出', '不准出'];

const abs = (r) => path.join(ROOT, r);
const exists = (r) => fs.existsSync(abs(r));
const readJson = (r) => { try { return JSON.parse(fs.readFileSync(abs(r), 'utf8')); } catch { return null; } };
const mtime = (r) => { try { return fs.statSync(abs(r)).mtime.toISOString(); } catch { return null; } };
const ls = (r) => { try { return fs.readdirSync(abs(r)); } catch { return []; } };
const ratio = (num, den) => ({ num, den, value: den ? Number((num / den).toFixed(4)) : null });
const NA = (reason) => ({ num: null, den: null, value: null, na: reason });
const CASE_DIR_RE = /^TC-(?:API|E2E|UI)-[A-Z]{2,10}-\d{3}$/;

function walk(rel, out = []) {
  const p = abs(rel);
  if (!fs.existsSync(p)) return out;
  if (fs.statSync(p).isFile()) { out.push(rel); return out; }
  for (const n of fs.readdirSync(p).sort()) if (!['node_modules', '.git', '.DS_Store'].includes(n)) walk(path.posix.join(rel, n), out);
  return out;
}

// ================================================================ 1. 读取
const sources = {};
const src = (r, data) => { sources[r] = { exists: data != null, mtime: mtime(r) }; return data; };

const featuresJson = src('docs/trace/features.json', readJson('docs/trace/features.json'));
const reqJson = src('docs/trace/requirements.json', readJson('docs/trace/requirements.json'));
const cpBe = src('docs/trace/code-points-be.json', readJson('docs/trace/code-points-be.json'));
const cpFe = src('docs/trace/code-points-fe.json', readJson('docs/trace/code-points-fe.json'));
const casesApi = src('docs/trace/cases-api.json', readJson('docs/trace/cases-api.json'));
const casesUi = src('docs/trace/cases-ui.json', readJson('docs/trace/cases-ui.json'));
const validatorStatus = src('.workflow/reports/case-status.json', readJson('.workflow/reports/case-status.json'));
const latestRun = src('evidence/_runs/latest.json', readJson('evidence/_runs/latest.json'));
const coverage = src('coverage/summary.json', readJson('coverage/summary.json'));
const mutation = src('evidence/_runs/mutation-latest.json', readJson('evidence/_runs/mutation-latest.json'));
const validateFinal = src('.workflow/reports/validate-final.json', readJson('.workflow/reports/validate-final.json'));
const specBe = src('docs/quality/spec-check-be.json', readJson('docs/quality/spec-check-be.json'));
const specFe = src('docs/quality/spec-check-fe.json', readJson('docs/quality/spec-check-fe.json'));
const criteriaOverride = src('docs/quality/exit-criteria.json', readJson('docs/quality/exit-criteria.json'));
const smokeSummary = src('evidence/_smoke/summary.json', readJson('evidence/_smoke/summary.json'));
// 提交包 MANIFEST：证据完整率以提交包解包后的复核结果为准（pack-submission.mjs 生成）
const manifestPath = (() => {
  const cands = [opt('manifest'), 'bundles/MANIFEST.json', readJson('.workflow/reports/validate-submission.json')?.manifestPath, readJson('.workflow/reports/validate-submission.json')?.stats?.submission?.manifestPath].filter(Boolean);
  return cands.find((p) => fs.existsSync(path.isAbsolute(p) ? p : abs(p))) || null;
})();
const manifest = manifestPath ? (() => { try { return JSON.parse(fs.readFileSync(path.isAbsolute(manifestPath) ? manifestPath : abs(manifestPath), 'utf8')); } catch { return null; } })() : null;
if (manifestPath) sources[path.isAbsolute(manifestPath) ? manifestPath : manifestPath] = { exists: Boolean(manifest), mtime: (() => { try { return fs.statSync(path.isAbsolute(manifestPath) ? manifestPath : abs(manifestPath)).mtime.toISOString(); } catch { return null; } })() };

const features = featuresJson?.features || [];
const fMap = new Map(features.map((f) => [f.id, f]));
const inScopeF = features.filter((f) => f.inScope === true);
const codePoints = [...(cpBe?.codePoints || []).map((c) => ({ ...c, side: c.side || 'BE' })), ...(cpFe?.codePoints || []).map((c) => ({ ...c, side: c.side || 'FE' }))];
const cases = [...(casesApi?.cases || []), ...(casesUi?.cases || [])];
const evidenceIndex = buildEvidenceIndex(ROOT); // 先刷新 evidence/index.json
sources['evidence/index.json'] = { exists: true, mtime: mtime('evidence/index.json') };

// ---------------------------------------------------------------- 用例状态：validator > 最近一次 run-cases > 单个用例的 result.json
const latestRows = new Map((latestRun?.steps?.run?.cases || []).map((r) => [r.caseId, r.status]));
const statusSource = { validator: 0, runCases: 0, evidence: 0, none: 0 };
const status = new Map();
for (const c of cases) {
  let s = null;
  if (validatorStatus && validatorStatus[c.id]) { s = validatorStatus[c.id]; statusSource.validator++; }
  else if (latestRows.has(c.id)) { s = latestRows.get(c.id); statusSource.runCases++; }
  else {
    const r = readJson(`evidence/${c.id}/result.json`);
    if (r) { s = r.status === 'passed' ? 'pass' : 'fail'; statusSource.evidence++; }
    else { s = 'not_run'; statusSource.none++; }
  }
  status.set(c.id, s === 'passed' ? 'pass' : s === 'failed' ? 'fail' : s);
}
const isPass = (id) => status.get(id) === 'pass';
const casesOf = (fid) => cases.filter((t) => (t.features || []).includes(fid));

// ================================================================ 2. 需求点（REQ）
function reqMetrics() {
  if (!reqJson) return { collected: false, coverage: NA('缺少 docs/trace/requirements.json'), mandatoryCoverage: NA('缺少 docs/trace/requirements.json'), verified: NA('缺少 docs/trace/requirements.json'), uncovered: [], unverified: [] };
  const reqs = (reqJson.requirements || []).filter((r) => r.inScope !== false);
  const covered = (r) => (r.features || []).some((fid) => fMap.get(fid)?.inScope === true);
  const verified = (r) => covered(r) && (r.features || []).filter((fid) => fMap.get(fid)?.inScope).every((fid) => featureVerified(fMap.get(fid)));
  const mand = reqs.filter((r) => r.mandatory === true);
  return {
    collected: true,
    total: reqs.length,
    coverage: ratio(reqs.filter(covered).length, reqs.length),
    mandatoryCoverage: ratio(mand.filter(covered).length, mand.length),
    verified: ratio(reqs.filter(verified).length, reqs.length),
    mandatoryVerified: ratio(mand.filter(verified).length, mand.length),
    uncovered: reqs.filter((r) => !covered(r)).map((r) => ({ id: r.id, mandatory: !!r.mandatory, quote: String(r.quote || r.text || '').slice(0, 60) })),
    unverified: reqs.filter((r) => covered(r) && !verified(r)).map((r) => r.id),
  };
}

// ================================================================ 3. Feature
function featureDesignCovered(f) {
  return (f.layers || []).every((layer) => codePoints.some((c) => c.side === layer && (c.features || []).includes(f.id)));
}
function featureCaseCovered(f) {
  const cs = casesOf(f.id);
  const layers = f.layers || [];
  return cs.length > 0 && (!layers.includes('BE') || cs.some((t) => t.type === 'API' || t.type === 'E2E')) && (!layers.includes('FE') || cs.some((t) => t.type === 'UI'));
}
function featureVerified(f) { return featureCaseCovered(f) && casesOf(f.id).every((t) => isPass(t.id)); }

function featureMetrics() {
  const group = (key) => {
    const out = {};
    for (const f of inScopeF) {
      const k = f[key] || '-';
      out[k] ||= { total: 0, designCovered: 0, caseCovered: 0, verified: 0 };
      out[k].total++;
      if (featureDesignCovered(f)) out[k].designCovered++;
      if (featureCaseCovered(f)) out[k].caseCovered++;
      if (featureVerified(f)) out[k].verified++;
    }
    return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
  };
  const p0 = inScopeF.filter((f) => f.priority === 'P0');
  return {
    total: features.length,
    inScope: inScopeF.length,
    designCoverage: ratio(inScopeF.filter(featureDesignCovered).length, inScopeF.length),
    caseCoverage: ratio(inScopeF.filter(featureCaseCovered).length, inScopeF.length),
    verified: ratio(inScopeF.filter(featureVerified).length, inScopeF.length),
    p0Verified: ratio(p0.filter(featureVerified).length, p0.length),
    byPriority: group('priority'),
    byModule: group('module'),
    notVerified: inScopeF.filter((f) => !featureVerified(f)).map((f) => ({
      id: f.id, name: f.name, priority: f.priority,
      reason: !featureCaseCovered(f) ? '缺少对应层的用例' : `用例未全部通过：${casesOf(f.id).filter((t) => !isPass(t.id)).map((t) => `${t.id}(${status.get(t.id)})`).join(', ')}`,
    })),
  };
}

// ================================================================ 4. 验收标准（AC）
function acMetrics() {
  const anyRefs = cases.some((t) => Array.isArray(t.acceptanceRefs) && t.acceptanceRefs.length);
  const refs = new Set(cases.flatMap((t) => t.acceptanceRefs || []));
  const all = inScopeF.flatMap((f) => (f.acceptance || []).map((a, i) => {
    const m = /^\s*AC(\d+)/.exec(String(a));
    return `${f.id}#AC${m ? m[1] : i + 1}`;
  }));
  if (!anyRefs) return { collected: false, total: all.length, coverage: NA('用例中没有 acceptanceRefs 字段'), uncovered: [] };
  const passRefs = new Set(cases.filter((t) => isPass(t.id)).flatMap((t) => t.acceptanceRefs || []));
  return {
    collected: true, total: all.length,
    coverage: ratio(all.filter((k) => refs.has(k)).length, all.length),
    verified: ratio(all.filter((k) => passRefs.has(k)).length, all.length),
    uncovered: all.filter((k) => !refs.has(k)),
    danglingRefs: [...refs].filter((k) => !all.includes(k)),
  };
}

// ================================================================ 5. Code ID
function scanCodeAnnotations() {
  const where = new Map();
  const files = [...walk('server'), ...walk('extension'), ...walk('scripts')].filter((x) => /\.(m?js|cjs|html|css|sh)$/.test(x));
  for (const f of files) {
    const text = fs.readFileSync(abs(f), 'utf8');
    for (const m of text.matchAll(/@code\s+((?:C-(?:FE|BE)-[A-Z]{2,10}-\d{2}[\s,，、]*)+)/g)) {
      for (const id of m[1].match(/\bC-(?:FE|BE)-[A-Z]{2,10}-\d{2}\b/g) || []) { if (!where.has(id)) where.set(id, new Set()); where.get(id).add(f); }
    }
  }
  return where;
}
function codeMetrics() {
  const where = scanCodeAnnotations();
  const relevant = codePoints.filter((c) => (c.features || []).some((fid) => fMap.get(fid)?.inScope));
  const refBy = (c) => cases.filter((t) => (t.codePoints || []).includes(c.id));
  const caseCovered = relevant.filter((c) => refBy(c).length);
  const verified = relevant.filter((c) => refBy(c).length && refBy(c).every((t) => isPass(t.id)));
  const annotated = relevant.filter((c) => where.has(c.id));
  const bySide = (side) => {
    const r = relevant.filter((c) => c.side === side);
    return { total: r.length, caseCoverage: ratio(r.filter((c) => refBy(c).length).length, r.length), verified: ratio(r.filter((c) => verified.includes(c)).length, r.length), annotated: ratio(r.filter((c) => where.has(c.id)).length, r.length) };
  };
  return {
    total: relevant.length,
    caseCoverage: ratio(caseCovered.length, relevant.length),
    verified: ratio(verified.length, relevant.length),
    annotated: ratio(annotated.length, relevant.length),
    be: bySide('BE'), fe: bySide('FE'),
    notReferenced: relevant.filter((c) => !refBy(c).length).map((c) => c.id),
    notAnnotated: relevant.filter((c) => !where.has(c.id)).map((c) => c.id),
    notVerified: relevant.filter((c) => refBy(c).length && !verified.includes(c)).map((c) => c.id),
    unregisteredInSource: [...where.keys()].filter((id) => !codePoints.some((c) => c.id === id)),
  };
}

// ================================================================ 6. 用例执行
function caseMetrics() {
  const tally = (key) => {
    const out = {};
    for (const t of cases) {
      const k = t[key] || '未标注';
      out[k] ||= { total: 0, pass: 0, fail: 0, flaky: 0, not_run: 0 };
      out[k].total++;
      out[k][status.get(t.id)] = (out[k][status.get(t.id)] || 0) + 1;
    }
    return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
  };
  const count = (s) => cases.filter((t) => status.get(t.id) === s).length;
  const p0 = cases.filter((t) => t.priority === 'P0');
  return {
    total: cases.length, pass: count('pass'), fail: count('fail'), flaky: count('flaky'), notRun: count('not_run'),
    passRate: ratio(count('pass'), cases.length),
    p0PassRate: ratio(p0.filter((t) => isPass(t.id)).length, p0.length),
    statusSource,
    byType: tally('type'), byModule: tally('module'), byPriority: tally('priority'), byCategory: tally('category'),
    open: cases.filter((t) => !isPass(t.id)).map((t) => ({ id: t.id, title: t.title, priority: t.priority, status: status.get(t.id) })),
  };
}

// ================================================================ 7. 代码行覆盖
function coverageMetrics() {
  if (!coverage) return { collected: false, reason: '缺少 coverage/summary.json（先运行 collect-coverage.mjs）', be: null, fe: null };
  const side = (s) => s && {
    lines: s.lines, statements: s.statements, functions: s.functions, branches: s.branches,
    lowFiles: (s.files || []).filter((f) => f.lines.pct !== null && f.lines.pct < 50).map((f) => ({ file: f.file, lines: f.lines.pct })),
    files: (s.files || []).length,
  };
  return { collected: true, generatedAt: coverage.generatedAt, run: coverage.run, be: side(coverage.be), fe: side(coverage.fe), notes: coverage.notes || [] };
}

// ================================================================ 8. 断言有效性
function assertionMetrics() {
  const lint = lintScripts({ root: ROOT });
  const m = mutation
    ? { collected: true, generatedAt: mutation.generatedAt, killRate: ratio(mutation.killed, mutation.applicable), ops: mutation.ops,
      survived: (mutation.rows || []).filter((r) => (r.survived || []).length).map((r) => ({ caseId: r.caseId, ops: r.survived })),
      waived: (mutation.rows || []).filter((r) => (r.ignoredOps || []).length).map((r) => ({ caseId: r.caseId, ops: r.ignoredOps })),
      baselineFailed: (mutation.rows || []).filter((r) => r.baseline !== 'pass').map((r) => r.caseId) }
    : { collected: false, killRate: NA('缺少 evidence/_runs/mutation-latest.json（先运行 run-cases.mjs --mutation）'), survived: [] };
  return {
    tagCoverage: lint.stats.expectedTotal ? ratio(lint.stats.taggedTotal, lint.stats.expectedTotal) : NA('没有可检查的用例脚本'),
    weakAssertions: lint.stats.weakTotal,
    lintErrors: lint.errors.length, lintWarnings: lint.warnings.length,
    lintErrorSamples: lint.errors.slice(0, 10),
    mutation: m,
  };
}

// ================================================================ 9. 证据完整性
function evidenceMetrics() {
  const executed = cases.filter((t) => ['pass', 'fail', 'flaky'].includes(status.get(t.id)));
  const complete = executed.filter((t) => evidenceIndex[t.id]?.complete);
  const stateCovered = executed.filter((t) => evidenceIndex[t.id]?.stateCovered);
  const completeness = ratio(complete.length, executed.length);
  const pk = manifest?.evidence;
  const packaged = pk && Number.isFinite(pk.total)
    ? { collected: true, manifest: manifestPath, generatedAt: manifest.generatedAt, level: manifest.level, completeness: ratio(pk.complete, pk.total), stateCoverage: Number.isFinite(pk.stateCovered) ? ratio(pk.stateCovered, pk.total) : NA('MANIFEST 中没有状态快照统计'), dropped: (manifest.dropped || []).length, usage: manifest.usage ? { files: manifest.usage.files, totalBytes: manifest.usage.totalBytes } : null, budget: manifest.budget || null, incomplete: pk.incomplete || [] }
    : { collected: false, reason: '没有提交包 MANIFEST（先运行 node .workflow/tools/pack-submission.mjs）' };
  return {
    executed: executed.length,
    completeness,
    // 准出口径：有提交包时以提交包解包后的复核结果为准（评审者实际拿到的证据），否则用开发环境的证据
    exitCompleteness: packaged.collected ? packaged.completeness : completeness,
    exitSource: packaged.collected ? `提交包（${manifestPath}）` : '开发环境 evidence/（尚未打包，提交前必须以提交包重算）',
    packaged,
    stateCoverage: ratio(stateCovered.length, executed.length),
    incomplete: executed.filter((t) => !evidenceIndex[t.id]?.complete).map((t) => ({ id: t.id, missing: evidenceIndex[t.id]?.missing || ['没有 evidence 目录'] })),
    unregisteredDirs: Object.keys(evidenceIndex).filter((k) => !evidenceIndex[k].registered),
  };
}

// ================================================================ 9b. 真实安装冒烟（smoke-install.mjs 生成 evidence/_smoke/summary.json）
function smokeMetrics() {
  if (!smokeSummary) return { collected: false, reason: '缺少 evidence/_smoke/summary.json（先运行 node .agents/skills/nav-case-to-script/scripts/smoke-install.mjs）', pass: null, results: [] };
  const results = (smokeSummary.results || []).map((r) => ({ browser: r.browser, scenario: r.scenario, pass: !!r.pass, required: r.required !== false, popupSize: r.popupSize || null, errors: (r.errors || []).slice(0, 5), screenshots: r.screenshots || [] }));
  const chromiumRequired = results.filter((r) => r.browser === 'chromium' && r.required);
  const chromiumPass = chromiumRequired.length > 0 && chromiumRequired.every((r) => r.pass);
  return {
    collected: true, generatedAt: smokeSummary.generatedAt || null, pass: !!smokeSummary.pass && chromiumPass,
    chromium: { required: chromiumRequired.length, passed: chromiumRequired.filter((r) => r.pass).length, version: smokeSummary.browsers?.chromium?.version || null },
    chrome: smokeSummary.browsers?.chrome || null,
    requiredPass: ratio(chromiumRequired.filter((r) => r.pass).length, chromiumRequired.length),
    results, errors: (smokeSummary.errors || []).slice(0, 10),
  };
}

// ================================================================ 10. 缺陷与过程、规范、性能
function processMetrics() {
  const gates = ls('.workflow/reports').map((f) => /^gate-iter-(\d+)\.json$/.exec(f)).filter(Boolean)
    .map((m) => ({ iter: Number(m[1]), r: readJson(`.workflow/reports/${m[0]}`) })).sort((a, b) => a.iter - b.iter)
    .map(({ iter, r }) => ({ iter, pass: !!r?.pass, total: r?.run?.total ?? null, passed: r?.run?.passed ?? null, failed: r?.run?.failed ?? null, errors: (r?.errors || []).length }));
  const ui = cases.filter((t) => t.type === 'UI');
  const explore = { pass: 0, product_bug: 0, script_stale: 0, missing: 0 };
  const bugs = [];
  for (const t of ui) {
    const e = readJson(`evidence/${t.id}/explore.json`);
    if (!e) { explore.missing++; continue; }
    explore[e.verdict] = (explore[e.verdict] || 0) + 1;
    if (e.verdict === 'product_bug') bugs.push({ id: t.id, observed: String(e.observed || '').slice(0, 120) });
  }
  return { tddIterations: gates.length, gates, explore, openProductBugs: bugs, validatorFinal: validateFinal ? { pass: !!validateFinal.pass, errors: (validateFinal.errors || []).length } : null };
}
function specMetrics() {
  const one = (j, f) => (j ? { collected: true, pass: !!j.pass, errors: (j.errors || []).length, warnings: (j.warnings || []).length } : { collected: false, reason: `缺少 ${f}` });
  return { be: one(specBe, 'docs/quality/spec-check-be.json'), fe: one(specFe, 'docs/quality/spec-check-fe.json') };
}
function perfMetrics() {
  const out = [];
  for (const d of ls('evidence').filter((n) => CASE_DIR_RE.test(n))) {
    const r = readJson(`evidence/${d}/result.json`);
    for (const t of r?.tests || []) for (const [name, m] of Object.entries(t.metrics || {})) out.push({ caseId: d, name, value: m.value, unit: m.unit || '' });
  }
  return out;
}

// ================================================================ 11. 准出判定
const DEFAULT_CRITERIA = [
  { id: 'H1', kind: 'hard', name: 'P0 Feature 验证率', path: 'features.p0Verified', min: 1 },
  { id: 'H2', kind: 'hard', name: 'mandatory 需求点覆盖率', path: 'requirements.mandatoryCoverage', min: 1 },
  { id: 'H3', kind: 'hard', name: 'P0 用例通过率', path: 'cases.p0PassRate', min: 1 },
  { id: 'H4', kind: 'hard', name: '整体用例通过率', path: 'cases.passRate', min: 0.95 },
  { id: 'H5', kind: 'hard', name: 'Code ID 用例覆盖率', path: 'codePoints.caseCoverage', min: 1 },
  { id: 'H6', kind: 'hard', name: '@code 标注率', path: 'codePoints.annotated', min: 1 },
  { id: 'H7', kind: 'hard', name: '证据完整率（提交包口径）', path: 'evidence.exitCompleteness', min: 1 },
  { id: 'H8', kind: 'hard', name: '真实安装冒烟通过（chromium 必需场景）', path: 'smoke.requiredPass', min: 1, special: 'smoke' },
  { id: 'T1', kind: 'target', name: '后端行覆盖率', path: 'coverage.be.lines', min: 0.8, pct: true },
  { id: 'T2', kind: 'target', name: '后端分支覆盖率', path: 'coverage.be.branches', min: 0.65, pct: true },
  { id: 'T3', kind: 'target', name: '前端行覆盖率', path: 'coverage.fe.lines', min: 0.6, pct: true },
  { id: 'T4', kind: 'target', name: '变异杀死率（API / E2E）', path: 'assertions.mutation.killRate', min: 0.8 },
  { id: 'T5', kind: 'target', name: '[En] 断言标签覆盖率', path: 'assertions.tagCoverage', min: 1 },
  { id: 'T6', kind: 'target', name: 'spec-check error 数（BE + FE）', path: 'spec', max: 0, special: 'spec' },
  { id: 'T7', kind: 'target', name: '后端状态快照覆盖率', path: 'evidence.stateCoverage', min: 0.9 },
];
const get = (obj, p) => p.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

function evaluate(metrics) {
  const overrides = criteriaOverride?.thresholds || {};
  const rows = DEFAULT_CRITERIA.map((c) => {
    const th = overrides[c.id] ?? (c.max !== undefined ? c.max : c.min);
    let actual = null; let display = '未采集'; let met = false; let note = '';
    if (c.special === 'smoke') {
      const sm = metrics.smoke;
      if (sm.collected && sm.requiredPass.value !== null) { actual = sm.requiredPass.value; met = sm.pass && actual >= th; display = `${sm.pass ? '通过' : '未通过'}（chromium ${sm.chromium.passed}/${sm.chromium.required}；chrome ${sm.chrome ? (sm.chrome.pass === true ? '通过' : sm.chrome.skipped ? `跳过：${sm.chrome.reason || ''}` : sm.chrome.pass === false ? '未通过' : '-') : '-'}）`; }
      else note = `未采集，不能判为达标：${sm.reason || '没有 chromium 必需场景'}`;
    } else if (c.special === 'spec') {
      const s = metrics.spec;
      if (s.be.collected && s.fe.collected) { actual = s.be.errors + s.fe.errors; display = String(actual); met = actual <= th; }
      else note = '未采集，不能判为达标';
    } else {
      const v = get(metrics, c.path);
      const value = c.pct ? (v && v.pct !== null && v.pct !== undefined ? v.pct / 100 : null) : v?.value ?? null;
      if (value !== null && value !== undefined) {
        actual = value; met = value >= th;
        display = c.pct ? `${(value * 100).toFixed(1)}%（${v.covered}/${v.total}）` : `${(value * 100).toFixed(1)}%（${v.num}/${v.den}）`;
      } else note = `未采集，不能判为达标${v?.na ? `：${v.na}` : ''}`;
    }
    const thDisplay = c.special === 'spec' ? `≤ ${th}` : `${th >= 1 ? '=' : '≥'} ${Math.round(th * 100)}%`;
    return { id: c.id, kind: c.kind, name: c.name, threshold: th, thresholdDisplay: thDisplay, actual, display, met, note };
  });
  const hardFail = rows.filter((r) => r.kind === 'hard' && !r.met);
  const targetFail = rows.filter((r) => r.kind === 'target' && !r.met);
  const verdict = hardFail.length ? '不准出' : targetFail.length ? '有条件准出' : '准出';
  return { verdict, criteria: rows, hardFailed: hardFail.map((r) => r.id), targetFailed: targetFail.map((r) => r.id), overridden: Object.keys(overrides) };
}

// ================================================================ 12. 输出
const metrics = {
  generatedAt: new Date().toISOString(),
  root: ROOT,
  requirements: reqMetrics(),
  features: featureMetrics(),
  acceptance: acMetrics(),
  codePoints: codeMetrics(),
  cases: caseMetrics(),
  coverage: coverageMetrics(),
  assertions: assertionMetrics(),
  evidence: evidenceMetrics(),
  smoke: smokeMetrics(),
  process: processMetrics(),
  spec: specMetrics(),
  performance: perfMetrics(),
  sources,
};
metrics.exit = evaluate(metrics);

const P = (r) => (r && r.value !== null && r.value !== undefined ? `${(r.value * 100).toFixed(1)}%（${r.num}/${r.den}）` : `未采集${r?.na ? `（${r.na}）` : ''}`);
const C = (m) => (m && m.pct !== null && m.pct !== undefined ? `${m.pct.toFixed(1)}%（${m.covered}/${m.total}）` : '未采集');
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
const groupTable = (g, label) => table([label, 'inScope', '设计覆盖', '用例覆盖', '已验证'], Object.entries(g).map(([k, v]) => [k, v.total, `${v.designCovered}/${v.total}`, `${v.caseCovered}/${v.total}`, `${v.verified}/${v.total}`]));
const tallyTable = (g, label) => table([label, '总数', '通过', '失败', '不稳定', '未执行'], Object.entries(g).map(([k, v]) => [k, v.total, v.pass || 0, v.fail || 0, v.flaky || 0, v.not_run || 0]));

// 链接基准：注入 docs/08 时相对 docs/，写 docs/quality/metrics.md 时相对 docs/quality/
const linkTo = (base, rel) => path.posix.relative(base, rel).split('/').map(encodeURIComponent).join('/');
function representative(m, base) {
  const out = [];
  const sm = m.smoke;
  if (sm.collected) {
    out.push(`真实安装冒烟（真实 action popup、首次安装、空 storage）：${sm.pass ? '✅ 通过' : '❌ 未通过'}`, '');
    out.push(table(['浏览器', '场景', '结果', 'popup 尺寸', '截图'], sm.results.map((r) => [r.browser, r.scenario, r.pass ? '✅' : `❌ ${r.errors.join('；').slice(0, 120)}`, r.popupSize ? r.popupSize.join('×') : '-', r.screenshots.slice(0, 3).map((s, i) => `[${i + 1}](${linkTo(base, s)})`).join(' ') || '-'])));
  } else out.push(`真实安装冒烟：未采集（${sm.reason}）`);
  const flow = 'evidence/ACCEPTANCE-FLOW';
  if (exists(flow)) {
    const shots = walk(flow).filter((r) => /\.(png|jpe?g|gif)$/i.test(r)).slice(0, 6);
    const md = ['explore.md', 'README.md'].map((n) => `${flow}/${n}`).find((r) => exists(r));
    out.push('', `验收流程（PROBLEM.md 第 3–9 步）：${md ? `[记录](${linkTo(base, md)})` : '无记录'}${shots.length ? '；截图 ' + shots.map((s, i) => `[${i + 1}](${linkTo(base, s)})`).join(' ') : '；没有截图'}`);
  }
  const p0ui = cases.filter((t) => t.type === 'UI' && t.priority === 'P0').slice(0, 8);
  const rows = p0ui.map((t) => {
    const dir = `evidence/${t.id}`; const shots = walk(`${dir}/screenshots`).filter((r) => /\.(png|jpe?g)$/i.test(r));
    const gif = exists(`${dir}/flow.gif`) ? `[flow.gif](${linkTo(base, `${dir}/flow.gif`)})` : '-';
    return [t.id, t.title, status.get(t.id), shots.length ? `[首张](${linkTo(base, shots[0])}) / [末张](${linkTo(base, shots[shots.length - 1])})` : '无截图', gif];
  });
  if (rows.length) out.push('', 'P0 UI 用例证据（节选）：', '', table(['Case', '标题', '状态', '截图', '动图'], rows));
  return out;
}

function renderMd(m, base = 'docs') {
  const e = m.exit; const f = m.features; const cp = m.codePoints; const cs = m.cases; const cov = m.coverage; const a = m.assertions;
  const L = [];
  L.push(`> 本区块由 \`collect-metrics.mjs\` 自动生成（${m.generatedAt}），请勿手改。指标口径见 \`.agents/skills/nav-quality-report/references/metrics.md\`。`, '');
  L.push(`### 准出结论：**${e.verdict}**`, '');
  L.push(table(['编号', '类型', '指标', '阈值', '实际', '达标'], e.criteria.map((r) => [r.id, r.kind === 'hard' ? '硬性' : '目标', r.name, r.thresholdDisplay, r.display, r.met ? '✅' : r.note ? `❌ ${r.note}` : '❌'])));
  if (e.overridden.length) L.push('', `阈值覆盖（docs/quality/exit-criteria.json）：${e.overridden.join(', ')}`);
  L.push('', '### 需求覆盖', '');
  L.push(table(['指标', '数值'], [
    ['需求点（REQ）覆盖率', P(m.requirements.coverage)], ['mandatory 需求点覆盖率', P(m.requirements.mandatoryCoverage)], ['需求点验证率', P(m.requirements.verified)],
    ['Feature 设计覆盖率（代码点）', P(f.designCoverage)], ['Feature 用例覆盖率', P(f.caseCoverage)], ['Feature 验证通过率', P(f.verified)], ['P0 Feature 验证率', P(f.p0Verified)],
    ['验收标准（AC）覆盖率', P(m.acceptance.coverage)], ['验收标准（AC）验证率', P(m.acceptance.verified || NA('未采集'))],
  ]));
  if (m.requirements.uncovered?.length) L.push('', `未覆盖的需求点：${m.requirements.uncovered.map((r) => `${r.id}${r.mandatory ? '（mandatory）' : ''}`).join(', ')}`);
  L.push('', '按优先级：', '', groupTable(f.byPriority, '优先级'), '', '按模块：', '', groupTable(f.byModule, '模块'));
  if (f.notVerified.length) L.push('', '未验证的 Feature：', '', table(['Feature', '名称', '优先级', '原因'], f.notVerified.map((x) => [x.id, x.name, x.priority, x.reason])));
  if (m.acceptance.uncovered?.length) L.push('', `未被任何用例引用的 AC：${m.acceptance.uncovered.join(', ')}`);
  L.push('', '### 代码追溯（Code ID）', '');
  L.push(table(['指标', '全部', 'BE', 'FE'], [
    ['用例覆盖率', P(cp.caseCoverage), P(cp.be.caseCoverage), P(cp.fe.caseCoverage)],
    ['验证通过率', P(cp.verified), P(cp.be.verified), P(cp.fe.verified)],
    ['@code 标注率', P(cp.annotated), P(cp.be.annotated), P(cp.fe.annotated)],
  ]));
  for (const [k, label] of [['notReferenced', '没有被用例引用'], ['notAnnotated', '源码中没有 @code 标注'], ['notVerified', '用例未全部通过'], ['unregisteredInSource', '源码中出现了未登记的 @code']]) if (cp[k].length) L.push('', `${label}：${cp[k].join(', ')}`);
  L.push('', '### 测试执行', '');
  L.push(table(['总数', '通过', '失败', '不稳定', '未执行', '通过率', 'P0 通过率'], [[cs.total, cs.pass, cs.fail, cs.flaky, cs.notRun, P(cs.passRate), P(cs.p0PassRate)]]));
  L.push('', `状态来源：validator ${cs.statusSource.validator}，run-cases ${cs.statusSource.runCases}，evidence ${cs.statusSource.evidence}，无记录 ${cs.statusSource.none}`);
  L.push('', tallyTable(cs.byType, '类型'), '', tallyTable(cs.byPriority, '优先级'), '', tallyTable(cs.byCategory, '用例类别'), '', tallyTable(cs.byModule, '模块'));
  if (cs.open.length) L.push('', '未通过的用例：', '', table(['Case', '标题', '优先级', '状态'], cs.open.map((x) => [x.id, x.title, x.priority, x.status])));
  L.push('', '### 代码行覆盖率', '');
  if (!cov.collected) L.push(`未采集：${cov.reason}`);
  else {
    L.push(table(['端', '行', '分支', '函数', '语句', '文件数'], [
      ['后端 server/', C(cov.be?.lines), C(cov.be?.branches), C(cov.be?.functions), C(cov.be?.statements), cov.be?.files ?? '未采集'],
      ['前端 extension/', C(cov.fe?.lines), C(cov.fe?.branches), C(cov.fe?.functions), C(cov.fe?.statements), cov.fe?.files ?? '未采集'],
    ]));
    L.push('', `采集运行：${cov.run?.passed}/${cov.run?.total} 个测试通过（${cov.generatedAt}）`);
    const low = [...(cov.be?.lowFiles || []), ...(cov.fe?.lowFiles || [])];
    if (low.length) L.push('', '行覆盖率低于 50% 的文件：', '', table(['文件', '行覆盖率'], low.map((x) => [x.file, `${x.lines.toFixed(1)}%`])));
    for (const n of cov.notes) L.push(`- ⚠ ${n}`);
  }
  L.push('', '### 断言有效性', '');
  L.push(table(['指标', '数值'], [
    ['[En] 断言标签覆盖率', P(a.tagCoverage)], ['弱断言数', a.weakAssertions], ['脚本 lint 错误 / 警告', `${a.lintErrors} / ${a.lintWarnings}`],
    ['变异杀死率（API / E2E）', P(a.mutation.killRate)],
  ]));
  if (a.mutation.survived.length) L.push('', '存活的变异（断言没有约束住对应属性）：', '', table(['Case', '存活算子'], a.mutation.survived.map((x) => [x.caseId, x.ops.join(', ')])));
  if (a.mutation.waived?.length) L.push('', '已豁免的变异（用例中声明了理由，不计入分母）：', '', table(['Case', '豁免算子（理由）'], a.mutation.waived.map((x) => [x.caseId, x.ops.join('；')])));
  if (a.mutation.baselineFailed?.length) L.push('', `变异检查中基线未通过：${a.mutation.baselineFailed.join(', ')}`);
  L.push('', '### 证据完整性', '');
  const ev = m.evidence;
  L.push(table(['口径', '证据完整率', '后端状态快照覆盖率', '说明'], [
    ['开发环境 evidence/', P(ev.completeness), P(ev.stateCoverage), `已执行用例 ${ev.executed} 个；索引 \`evidence/index.json\``],
    ['提交包（准出口径）', ev.packaged.collected ? P(ev.packaged.completeness) : '未采集', ev.packaged.collected ? P(ev.packaged.stateCoverage) : '未采集', ev.packaged.collected ? `打包级别 ${ev.packaged.level}，裁剪条目 ${ev.packaged.dropped} 个（见 MANIFEST 的 dropped）${ev.packaged.usage ? `；${ev.packaged.usage.files} 个文件、${(ev.packaged.usage.totalBytes / 1048576).toFixed(2)}MB` : ''}` : ev.packaged.reason],
  ]));
  L.push('', `准出（H7）采用：${ev.exitSource}。`);
  if (m.evidence.incomplete.length) L.push('', table(['Case', '缺少'], m.evidence.incomplete.map((x) => [x.id, x.missing.join('；')])));
  L.push('', '### 代表性证据', '', ...representative(m, base));
  L.push('', '### 缺陷与过程', '');
  const pr = m.process;
  L.push(`TDD 门禁轮次：${pr.tddIterations}；UI 探索结论：pass ${pr.explore.pass}，product_bug ${pr.explore.product_bug}，script_stale ${pr.explore.script_stale}，无记录 ${pr.explore.missing}；validate final：${pr.validatorFinal ? (pr.validatorFinal.pass ? '通过' : `未通过（${pr.validatorFinal.errors} 个错误）`) : '未采集'}`);
  if (pr.gates.length) L.push('', table(['轮次', '门禁', '测试总数', '通过', '失败', '校验错误'], pr.gates.map((g) => [g.iter, g.pass ? '✅' : '❌', g.total ?? '-', g.passed ?? '-', g.failed ?? '-', g.errors])));
  if (pr.openProductBugs.length) L.push('', '未关闭的产品缺陷（探索）：', '', table(['Case', '现象'], pr.openProductBugs.map((b) => [b.id, b.observed])));
  L.push('', '### 规范符合度', '');
  const sp = (s) => (s.collected ? `${s.pass ? '✅' : '❌'} error ${s.errors} / warning ${s.warnings}` : `未采集（${s.reason}）`);
  L.push(table(['端', '结果'], [['后端 specs/backend.spec.md', sp(m.spec.be)], ['前端 specs/frontend.spec.md', sp(m.spec.fe)]]));
  L.push('', '### 性能指标', '');
  L.push(m.performance.length ? table(['Case', '指标', '数值'], m.performance.map((x) => [x.caseId, x.name, `${x.value}${x.unit ? ' ' + x.unit : ''}`])) : '未采集（性能用例需要调用 evidence.metric(name, value, unit) 记录指标）');
  L.push('', '### 数据来源', '');
  L.push(table(['文件', '存在', '更新时间'], Object.entries(m.sources).map(([k, v]) => [k, v.exists ? '是' : '否', v.mtime || '-'])));
  return L.join('\n') + '\n';
}

const md = renderMd(metrics, 'docs'); // 注入 docs/08 使用（链接相对 docs/）
fs.mkdirSync(abs('docs/quality'), { recursive: true });
fs.writeFileSync(abs('docs/quality/metrics.json'), JSON.stringify(metrics, null, 2));
fs.writeFileSync(abs('docs/quality/metrics.md'), renderMd(metrics, 'docs/quality'));

let exitCode = 0;
if (args.includes('--inject')) {
  if (!exists(REPORT)) { console.error(`✖ ${REPORT} 不存在：请先按 references/report-template.md 创建报告（其中包含 ${BEGIN} / ${END} 标记）`); process.exit(2); }
  const text = fs.readFileSync(abs(REPORT), 'utf8');
  const i = text.indexOf(BEGIN); const j = text.indexOf(END);
  if (i < 0 || j < i) { console.error(`✖ ${REPORT} 中缺少 ${BEGIN} / ${END} 标记：请按 references/report-template.md 补上`); process.exit(2); }
  fs.writeFileSync(abs(REPORT), text.slice(0, i + BEGIN.length) + '\n' + md + text.slice(j));
  console.log(`· 已写入 ${REPORT} 的自动区块`);
}

if (args.includes('--check-report')) {
  const problems = [];
  if (!exists(REPORT)) problems.push(`${REPORT} 不存在`);
  else {
    const text = fs.readFileSync(abs(REPORT), 'utf8');
    const i = text.indexOf(BEGIN); const j = text.indexOf(END);
    if (i < 0 || j < i) problems.push('缺少自动区块标记');
    else {
      const block = text.slice(i, j);
      if (block.trim() === BEGIN || !block.includes(metrics.exit.verdict)) problems.push('自动区块为空或已过期：请重新运行 --inject');
      const outside = text.slice(0, i) + text.slice(j + END.length);
      const vm = /准出结论[：:]\s*\**\s*(有条件准出|不准出|准出)/.exec(outside);
      if (!vm) problems.push('报告正文缺少「准出结论：<结论>」');
      else if (vm[1] !== metrics.exit.verdict) problems.push(`报告正文的结论「${vm[1]}」与 metrics 判定「${metrics.exit.verdict}」不一致`);
      const nums = [...outside.matchAll(/(\d+(?:\.\d+)?%)|(\b\d+\/\d+\b)/g)].map((x) => x[0]);
      for (const n of [...new Set(nums)]) if (!md.includes(n)) problems.push(`正文中的数字「${n}」在 metrics.md 中找不到（数字只能引用自动生成的指标）`);
    }
  }
  if (problems.length) { exitCode = 1; for (const p of problems) console.log(`✖ ${p}`); } else console.log('✔ 报告自检通过：结论和正文中的数字与 metrics 一致');
}

if (args.includes('--json')) console.log(JSON.stringify(metrics, null, 2));
else {
  console.log(`准出结论：${metrics.exit.verdict}（硬性未达标：${metrics.exit.hardFailed.join(', ') || '无'}；目标未达标：${metrics.exit.targetFailed.join(', ') || '无'}）`);
  for (const r of metrics.exit.criteria) console.log(`  ${r.met ? '✔' : '✖'} ${r.id} ${r.name}：${r.display}（阈值 ${r.thresholdDisplay}）${r.note ? ' ' + r.note : ''}`);
  console.log('→ docs/quality/metrics.json、docs/quality/metrics.md');
}
process.exit(exitCode);
