#!/usr/bin/env node
// 用例脚本流水线（nav-case-to-script 技能）：静态检查 → 加载检查 → 执行 → 失败分类 → 证据完整性 →（可选）断言有效性变异检查。
//
// 用法（在项目根目录执行）：
//   node .agents/skills/nav-case-to-script/scripts/run-cases.mjs TC-API-SYNC-001 TC-E2E-FLOW-001
//   node .agents/skills/nav-case-to-script/scripts/run-cases.mjs --module=SYNC --type=API
//   node .agents/skills/nav-case-to-script/scripts/run-cases.mjs --all --lint-only        # 产品还没实现时（TDD 红灯阶段）
//   node .agents/skills/nav-case-to-script/scripts/run-cases.mjs --type=API --mutation    # 断言有效性：变异杀死率
// 选项：--port=4100  --repeat=3（稳定性）  --ops=status,drop-item  --min-kill=0.8  --no-lint  --json
//       --inventory（只盘点目标用例、脚本是否存在、测试基建是否齐全，输出 JSON）
// 输出：evidence/_runs/<runId>/summary.json（同时复制为 evidence/_runs/latest.json）；变异结果另存 mutation.json / mutation-latest.json。
// 退出码：0 = 所选用例全部通过（开启 --mutation 时还要求杀死率达标）。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lintScripts, loadCases, specFileOf, DEFAULT_ROOT } from './lint-scripts.mjs';
import { OPS as ALL_OPS } from '../assets/fixtures/mutation.mjs';

const CASE_ID_G = /\bTC-(?:API|E2E|UI)-[A-Z]{2,10}-\d{3}\b/g;
const CASE_DIR_RE = /^TC-(?:API|E2E|UI)-[A-Z]{2,10}-\d{3}$/;
const stripAnsi = (s) => String(s || '').replace(/\u001b\[[0-9;]*m/g, '');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const ls = (d) => { try { return fs.readdirSync(d); } catch { return []; } };

// ---------------------------------------------------------------- Playwright 调用

function playwright(root, args, env, timeout = 1_800_000) {
  const r = spawnSync('npx', ['playwright', 'test', ...args], {
    cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout,
    env: { ...process.env, CI: '1', FORCE_COLOR: '0', ...env },
  });
  return { status: r.status, stdout: r.stdout || '', stderr: stripAnsi(r.stderr || ''), error: r.error };
}

function collectSpecs(suites, out = []) {
  for (const s of suites || []) {
    for (const sp of s.specs || []) out.push(sp);
    collectSpecs(s.suites, out);
  }
  return out;
}

// ---------------------------------------------------------------- 失败分类（给脚本修复 / 分诊 agent 的第一手线索）

export function classifyFailure(text, caseId) {
  const t = stripAnsi(text);
  const tags = [...new Set(t.match(/\[E\d+\]/g) || [])];
  if (/webServer|EADDRINUSE|Executable doesn't exist|browserType\.launch|Failed to launch|launchPersistentContext/.test(t)) {
    return { category: 'ENV', tags, hint: '环境问题：后端没能启动（看 stderr 中的 [WebServer] 输出）、端口被占用，或者浏览器无法启动。先修环境，不要改脚本。' };
  }
  if (/\[setup\]/.test(t)) {
    return { category: 'SETUP', tags, hint: 'setup 失败：reset 接口或样例导入不可用。属于后端缺陷或尚未实现（TDD 红灯阶段属于正常现象）。' };
  }
  if (/SyntaxError|ReferenceError|is not defined|Cannot find module|does not provide an export|is not a function/.test(t)) {
    return { category: 'SCRIPT', tags, hint: '脚本自身错误（语法、导入、未定义的变量 / 函数）。修正脚本即可，与产品无关。' };
  }
  if (/strict mode violation/.test(t)) {
    return { category: 'SCRIPT', tags, hint: 'getByTestId 匹配到多个元素：脚本需要限定范围（例如先定位列表项再取子元素），或者确认 ui-contract 中 testId 的唯一性约定。' };
  }
  if (/Cannot read propert(?:y|ies) of (?:undefined|null)/.test(t)) {
    return { category: 'CONTRACT', tags, hint: `取值路径不存在。先看 evidence/${caseId}/api/ 中的实际响应：与 api-contract 不一致 → 后端缺陷；与契约一致 → 脚本取值路径写错了。` };
  }
  if (tags.length) {
    return { category: 'ASSERTION', tags, hint: `断言 ${tags.join(' ')} 失败。对照用例 expected、api-contract / ui-contract 和 evidence/${caseId}/ 中的实际值判断：实现不符合 → 产品缺陷；用例或脚本写错 → 提交 testDisputes，不要放宽断言。` };
  }
  if (/Test timeout of|Timeout \d+ms exceeded|waiting for/.test(t)) {
    return { category: 'TIMEOUT', tags, hint: '超时：UI 元素一直没有出现或状态没有变化。看 evidence 截图确认是产品没渲染（产品缺陷）还是 testId / 流程不对（脚本问题）。' };
  }
  if (/expect\(/.test(t)) {
    return { category: 'ASSERTION_UNTAGGED', tags, hint: '断言失败，但断言消息里没有 [En] 标签，无法对应到用例 expected。先给断言补上标签。' };
  }
  return { category: 'UNKNOWN', tags, hint: '无法自动分类，请阅读完整错误信息和证据目录。' };
}

// ---------------------------------------------------------------- 证据

const SHOT_RE = /\.(?:png|jpe?g)$/i;
const STATE_FILES = ['state-before.json', 'state-after.json', 'state-diff.json'];

/**
 * 单个用例的证据完整性。
 * packaged=true（或环境变量 EVIDENCE_PACKAGED=1）表示检查的是提交包解包后的证据：截图可能已转成 JPEG，
 * 非验收流程的 flow.gif 可能按预算被裁掉（见 bundles/MANIFEST.json 的 dropped），因此 gif 不再是必需项。
 * 状态快照（state-*.json）缺失只记 warning，不判为不完整（后端需提供 GET /api/__test__/state，见 BE-RUN-07）。
 * @param {string} root
 * @param {{ id: string, type: string }} c
 * @param {string|null} runId
 * @param {{ packaged?: boolean }} [opts]
 */
export function evidenceStatus(root, c, runId, { packaged = process.env.EVIDENCE_PACKAGED === '1' } = {}) {
  const dir = path.join(root, 'evidence', c.id);
  const result = readJson(path.join(dir, 'result.json'));
  const apiFiles = ls(path.join(dir, 'api'));
  const realCalls = apiFiles.filter((f) => !(readJson(path.join(dir, 'api', f)) || {}).setup).length;
  const shots = ls(path.join(dir, 'screenshots')).filter((f) => SHOT_RE.test(f));
  const serverLog = fs.existsSync(path.join(dir, 'server.log')) && fs.statSync(path.join(dir, 'server.log')).size > 0;
  const gif = fs.existsSync(path.join(dir, 'flow.gif'));
  const state = Object.fromEntries(STATE_FILES.map((f) => [f.replace(/^state-|\.json$/g, ''), fs.existsSync(path.join(dir, f))]));
  const missing = [];
  const warnings = [];
  if (!result) missing.push('result.json');
  else if (runId && result.runId !== runId) missing.push(`result.json 不是本次运行产生的（runId=${result.runId}）`);
  if (c.type !== 'UI' && realCalls === 0) missing.push('api/ 中没有被测调用（setup 以外的请求）');
  if (c.type === 'UI' && !shots.length) missing.push('screenshots/ 为空');
  if (c.type === 'UI' && shots.length && !gif) {
    if (packaged) warnings.push('flow.gif 未包含（提交包按预算裁剪，见 bundles/MANIFEST.json 的 dropped）');
    else missing.push('flow.gif（需要安装 pngjs、gifenc）');
  }
  if (!serverLog) missing.push('server.log（后端需要支持 LOG_FILE，见 specs/backend.spec.md BE-LOG-02）');
  const stateMissing = STATE_FILES.filter((f) => !state[f.replace(/^state-|\.json$/g, '')]);
  if (stateMissing.length) warnings.push(`缺少后端状态快照 ${stateMissing.join('、')}（后端需提供 GET /api/__test__/state，见 BE-RUN-07）`);
  return {
    dir: path.relative(root, dir), complete: missing.length === 0, missing, warnings,
    files: { result: Boolean(result), apiCalls: apiFiles.length, realCalls, screenshots: shots.length, gif, serverLog, extensionLog: fs.existsSync(path.join(dir, 'extension.log')), explore: fs.existsSync(path.join(dir, 'explore.json')), state },
  };
}

/**
 * 扫描 evidence/<CaseID>/ 生成 evidence/index.json（质量报告的证据索引）。
 * @param {string} root
 * @param {{ packaged?: boolean }} [opts] packaged：按提交包口径检查（见 evidenceStatus）
 */
export function buildEvidenceIndex(root, { packaged = process.env.EVIDENCE_PACKAGED === '1' } = {}) {
  const cases = new Map(loadCases(root).map((c) => [c.id, c]));
  const index = {};
  for (const name of ls(path.join(root, 'evidence')).filter((n) => CASE_DIR_RE.test(n)).sort()) {
    const c = cases.get(name) || { id: name, type: name.split('-')[1] };
    const ev = evidenceStatus(root, c, null, { packaged });
    const result = readJson(path.join(root, 'evidence', name, 'result.json'));
    const explore = readJson(path.join(root, 'evidence', name, 'explore.json'));
    index[name] = {
      registered: cases.has(name), status: result?.status || 'unknown', runId: result?.runId || null, updatedAt: result?.updatedAt || null,
      complete: ev.complete, missing: ev.missing, warnings: ev.warnings, files: ev.files, exploreVerdict: explore?.verdict || null,
      stateCovered: Object.values(ev.files.state).every(Boolean),
    };
  }
  const rows = Object.values(index);
  const summary = {
    packaged, total: rows.length, complete: rows.filter((r) => r.complete).length,
    stateCovered: rows.filter((r) => r.stateCovered).length,
    screenshots: rows.reduce((s, r) => s + r.files.screenshots, 0), gifs: rows.filter((r) => r.files.gif).length,
  };
  fs.mkdirSync(path.join(root, 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(root, 'evidence', 'index.json'), JSON.stringify({ generatedAt: new Date().toISOString(), summary, cases: index }, null, 2));
  return index;
}

// ---------------------------------------------------------------- 主流程

function selectCases(root, ids, module, type) {
  const all = loadCases(root);
  if (!ids.length && !module && !type) return all;
  return all.filter((c) => (!ids.length || ids.includes(c.id)) && (!module || c.module === module) && (!type || c.type === type));
}

function parseRun(report, targets) {
  const per = new Map(targets.map((c) => [c.id, { caseId: c.id, type: c.type, status: 'not_run', tests: 0, passed: 0, failed: 0, flaky: 0, durationMs: 0, failures: [] }]));
  for (const sp of collectSpecs(report?.suites)) {
    const id = (sp.title.match(CASE_ID_G) || [])[0];
    const row = per.get(id);
    if (!row) continue;
    for (const t of sp.tests || []) {
      row.tests++;
      const last = (t.results || [])[t.results.length - 1] || {};
      row.durationMs += last.duration || 0;
      if (t.status === 'expected') row.passed++;
      else if (t.status === 'flaky') row.flaky++;
      else {
        row.failed++;
        const msg = stripAnsi((last.errors || []).map((e) => e.message || e.value).join('\n') || last.error?.message || t.status);
        row.failures.push({ title: sp.title, project: t.projectName, status: t.status, error: msg.slice(0, 2000), ...classifyFailure(msg, id) });
      }
    }
  }
  for (const row of per.values()) row.status = row.tests === 0 ? 'not_run' : row.failed ? 'fail' : row.flaky ? 'flaky' : 'pass';
  return [...per.values()];
}

/** 读取脚本中的 // mutation-ignore: <op>[,<op>] —— <理由>（变异与本用例的验证目标无关时使用） */
export function mutationIgnores(root, c) {
  const file = path.join(root, specFileOf(c));
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const m of fs.readFileSync(file, 'utf8').matchAll(/\/\/\s*mutation-ignore:\s*([a-z,\s-]+?)\s*(?:——|--|:)\s*(.+)$/gm)) {
    for (const op of m[1].split(',').map((x) => x.trim()).filter(Boolean)) out[op] = m[2].trim();
  }
  return out;
}

function parseMutation(report, targets, root) {
  const per = new Map(targets.map((c) => [c.id, { caseId: c.id, baseline: 'not_run', mutants: [], ignored: mutationIgnores(root, c) }]));
  for (const sp of collectSpecs(report?.suites)) {
    const id = (sp.title.match(CASE_ID_G) || [])[0];
    const row = per.get(id);
    if (!row) continue;
    for (const t of sp.tests || []) {
      const last = (t.results || [])[t.results.length - 1] || {};
      const ann = [...(t.annotations || []), ...(last.annotations || [])].find((a) => a.type === 'mutation');
      if (!ann) { row.baseline = t.status === 'expected' ? 'pass' : 'fail'; continue; }
      const [op, appliedPart] = String(ann.description || '').split('|');
      const applied = appliedPart === 'applied=true';
      const result = !applied ? 'n/a' : t.status !== 'expected' ? 'killed' : row.ignored[op] ? 'ignored' : 'survived';
      row.mutants.push({ op, applied, result, ...(result === 'ignored' ? { reason: row.ignored[op] } : {}) });
    }
  }
  const rows = [...per.values()].map((r) => {
    const applicable = r.mutants.filter((m) => m.applied && m.result !== 'ignored');
    const killed = applicable.filter((m) => m.result === 'killed').length;
    return { ...r, applicable: applicable.length, killed, survived: applicable.filter((m) => m.result === 'survived').map((m) => m.op), ignoredOps: r.mutants.filter((m) => m.result === 'ignored').map((m) => `${m.op}（${m.reason}）`), killRate: applicable.length ? Number((killed / applicable.length).toFixed(4)) : null };
  });
  const applicable = rows.reduce((s, r) => s + (r.baseline === 'pass' ? r.applicable : 0), 0);
  const killed = rows.reduce((s, r) => s + (r.baseline === 'pass' ? r.killed : 0), 0);
  return { rows, applicable, killed, killRate: applicable ? Number((killed / applicable).toFixed(4)) : null };
}

/** 盘点：目标用例、脚本是否存在、测试基建是否齐全（小 workflow 的第 1 阶段使用） */
export function inventory({ root = DEFAULT_ROOT, ids = [], module, type } = {}) {
  const cases = selectCases(root, ids, module, type).map((c) => ({ id: c.id, type: c.type, module: c.module, hasScript: fs.existsSync(path.join(root, specFileOf(c))) }));
  const missingFixtures = ['api', 'extension', 'evidence', 'mutation', 'sample'].filter((f) => !fs.existsSync(path.join(root, 'tests', 'fixtures', `${f}.mjs`)));
  return { cases, infra: { config: fs.existsSync(path.join(root, 'playwright.config.mjs')), missingFixtures, playwright: fs.existsSync(path.join(root, 'node_modules', '@playwright', 'test')) } };
}

export function runCases(opts) {
  const { root = DEFAULT_ROOT, ids = [], module, type, port = '4100', lintOnly = false, noLint = false, mutation = false, ops = ALL_OPS, minKill = 0.8, repeat = 1 } = opts;
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(root, 'evidence', '_runs', runId);
  fs.mkdirSync(outDir, { recursive: true });
  const summary = { runId, startedAt: new Date().toISOString(), selection: { ids, module: module || null, type: type || null }, port, steps: {}, pass: false };
  const targets = selectCases(root, ids, module, type);
  const save = () => {
    summary.endedAt = new Date().toISOString();
    fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
    fs.copyFileSync(path.join(outDir, 'summary.json'), path.join(root, 'evidence', '_runs', 'latest.json'));
    return summary;
  };
  if (!targets.length) { summary.steps.select = { error: '没有匹配到任何用例（检查 docs/trace/cases-*.json 和筛选参数）' }; return save(); }
  summary.steps.select = { cases: targets.map((c) => c.id) };

  // 1) 静态检查
  if (!noLint) {
    const lint = lintScripts({ root, caseIds: targets.map((c) => c.id) });
    summary.steps.lint = { pass: lint.pass, errors: lint.errors, warnings: lint.warnings, stats: lint.stats };
    if (!lint.pass) return save();
  }

  // 2) 加载检查：Playwright 能否解析脚本、用例是否落在正确的 project
  const files = targets.map(specFileOf);
  const listRes = playwright(root, ['--list', '--reporter=json', ...files], { TEST_PORT: '4199' }, 180_000);
  const start = listRes.stdout.indexOf('{');
  const list = start >= 0 ? (() => { try { return JSON.parse(listRes.stdout.slice(start)); } catch { return null; } })() : null;
  const listErrors = list ? (list.errors || []).map((e) => stripAnsi(e.message).slice(0, 800)) : [`playwright --list 失败：${listRes.stderr.slice(0, 1500)}`];
  const listed = new Set(list ? collectSpecs(list.suites).flatMap((sp) => sp.title.match(CASE_ID_G) || []) : []);
  for (const c of targets) if (list && !listed.has(c.id)) listErrors.push(`${c.id} 没有被 Playwright 加载（检查文件位置和 test 标题）`);
  summary.steps.list = { pass: listErrors.length === 0, errors: listErrors };
  if (listErrors.length || lintOnly) { summary.pass = listErrors.length === 0 && lintOnly; return save(); }

  // 3) 执行
  const logFile = path.join(root, 'evidence', '_runtime', `server-${port}.log`);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.rmSync(logFile, { force: true });
  const pwJson = path.join(outDir, 'pw.json');
  const runArgs = ['--reporter=json', ...files];
  if (repeat > 1) runArgs.push(`--repeat-each=${repeat}`);
  const exec = playwright(root, runArgs, { TEST_PORT: String(port), EVIDENCE_RUN_ID: runId, SERVER_LOG_FILE: logFile, PLAYWRIGHT_JSON_OUTPUT_NAME: pwJson });
  const report = readJson(pwJson);
  const globalErrors = report ? (report.errors || []).map((e) => stripAnsi(e.message || e.value || '').slice(0, 1500)) : [`没有生成报告：${exec.stderr.slice(0, 2000)}`];
  const rows = parseRun(report, targets);
  if (globalErrors.length) for (const r of rows) if (r.status === 'not_run') r.failures.push({ error: globalErrors.join('\n').slice(0, 2000), ...classifyFailure(globalErrors.join('\n'), r.caseId) });
  for (const r of rows) r.evidence = evidenceStatus(root, targets.find((c) => c.id === r.caseId), runId);
  const count = (s) => rows.filter((r) => r.status === s).length;
  summary.steps.run = { pass: rows.every((r) => r.status === 'pass') && !globalErrors.length, total: rows.length, passed: count('pass'), failed: count('fail'), flaky: count('flaky'), notRun: count('not_run'), globalErrors, cases: rows, webServerStderr: exec.stderr.split('\n').filter((l) => /WebServer/.test(l)).slice(-30) };
  summary.steps.evidence = { complete: rows.filter((r) => r.evidence.complete).length, total: rows.length, incomplete: rows.filter((r) => !r.evidence.complete).map((r) => ({ caseId: r.caseId, missing: r.evidence.missing })) };

  // 4) 断言有效性：只对执行通过的 API / E2E 用例做变异
  if (mutation) {
    const mt = targets.filter((c) => c.type !== 'UI' && rows.find((r) => r.caseId === c.id)?.status === 'pass');
    if (!mt.length) summary.steps.mutation = { skipped: '没有执行通过的 API / E2E 用例' };
    else {
      const mJson = path.join(outDir, 'mutation-pw.json');
      playwright(root, ['--reporter=json', `--repeat-each=${ops.length + 1}`, ...mt.map(specFileOf)], {
        TEST_PORT: String(port), EVIDENCE_RUN_ID: `${runId}-mutation`, MUTATION_OPS: ops.join(','), SERVER_LOG_FILE: path.join(root, 'evidence', '_runtime', `server-${port}-mutation.log`), PLAYWRIGHT_JSON_OUTPUT_NAME: mJson,
      });
      const m = parseMutation(readJson(mJson), mt, root);
      summary.steps.mutation = { ops, minKill, ...m, pass: m.killRate === null || m.killRate >= minKill };
      fs.writeFileSync(path.join(outDir, 'mutation.json'), JSON.stringify({ runId, generatedAt: new Date().toISOString(), ...summary.steps.mutation }, null, 2));
      fs.copyFileSync(path.join(outDir, 'mutation.json'), path.join(root, 'evidence', '_runs', 'mutation-latest.json'));
    }
  }

  buildEvidenceIndex(root);
  summary.pass = summary.steps.run.pass && (!mutation || summary.steps.mutation?.pass !== false);
  return save();
}

function printHuman(s) {
  const out = [];
  if (s.steps.select?.error) out.push(`✖ ${s.steps.select.error}`);
  if (s.steps.lint) {
    out.push(`${s.steps.lint.pass ? '✔' : '✖'} 静态检查：${s.steps.lint.errors.length} 个错误，${s.steps.lint.warnings.length} 个警告`);
    for (const e of s.steps.lint.errors.slice(0, 40)) out.push(`   ✖ ${e}`);
    for (const w of s.steps.lint.warnings.slice(0, 20)) out.push(`   ⚠ ${w}`);
  }
  if (s.steps.list) { out.push(`${s.steps.list.pass ? '✔' : '✖'} 加载检查`); for (const e of s.steps.list.errors) out.push(`   ✖ ${e}`); }
  const run = s.steps.run;
  if (run) {
    out.push(`${run.pass ? '✔' : '✖'} 执行：通过 ${run.passed}/${run.total}，失败 ${run.failed}，不稳定 ${run.flaky}，未执行 ${run.notRun}`);
    for (const g of run.globalErrors) out.push(`   ✖ 全局错误：${g.slice(0, 300)}`);
    for (const r of run.cases.filter((x) => x.status !== 'pass')) {
      for (const f of r.failures.slice(0, 2)) out.push(`   ✖ ${r.caseId} [${f.category}] ${f.tags?.join(' ') || ''} ${f.hint}\n      ${String(f.error).split('\n').slice(0, 3).join(' | ').slice(0, 300)}`);
    }
    out.push(`${s.steps.evidence.complete === s.steps.evidence.total ? '✔' : '⚠'} 证据完整：${s.steps.evidence.complete}/${s.steps.evidence.total}`);
    for (const x of s.steps.evidence.incomplete.slice(0, 20)) out.push(`   ⚠ ${x.caseId}：缺少 ${x.missing.join('；')}`);
  }
  const m = s.steps.mutation;
  if (m?.skipped) out.push(`· 变异检查跳过：${m.skipped}`);
  else if (m) {
    out.push(`${m.pass ? '✔' : '✖'} 断言有效性：变异杀死率 ${m.killRate === null ? '-' : (m.killRate * 100).toFixed(1) + '%'}（${m.killed}/${m.applicable}，阈值 ${(m.minKill * 100).toFixed(0)}%）`);
    for (const r of m.rows.filter((x) => x.survived.length || x.baseline !== 'pass')) out.push(`   ${r.baseline !== 'pass' ? '✖ 基线未通过' : '⚠ 存活变异'} ${r.caseId}：${r.survived.join(', ')}`);
    for (const r of m.rows.filter((x) => x.ignoredOps.length)) out.push(`   · 已豁免 ${r.caseId}：${r.ignoredOps.join('；')}`);
  }
  out.push(`\n结果：${s.pass ? '✔ 通过' : '✖ 未通过'}。详情见 evidence/_runs/${s.runId}/summary.json`);
  console.log(out.join('\n'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
  if (args.includes('--inventory')) {
    console.log(JSON.stringify(inventory({ root: opt('root') ? path.resolve(opt('root')) : DEFAULT_ROOT, ids: args.filter((a) => !a.startsWith('--')), module: opt('module'), type: opt('type') }), null, 2));
    process.exit(0);
  }
  const s = runCases({
    root: opt('root') ? path.resolve(opt('root')) : DEFAULT_ROOT,
    ids: args.filter((a) => !a.startsWith('--')),
    module: opt('module'), type: opt('type'), port: opt('port', process.env.TEST_PORT || '4100'),
    lintOnly: args.includes('--lint-only'), noLint: args.includes('--no-lint'), mutation: args.includes('--mutation'),
    ops: opt('ops') ? opt('ops').split(',') : ALL_OPS, minKill: Number(opt('min-kill', '0.8')), repeat: Number(opt('repeat', '1')),
  });
  if (args.includes('--json')) console.log(JSON.stringify(s, null, 2)); else printHuman(s);
  process.exit(s.pass ? 0 : 1);
}
