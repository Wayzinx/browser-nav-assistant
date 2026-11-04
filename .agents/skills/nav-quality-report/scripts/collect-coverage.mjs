#!/usr/bin/env node
// 代码行覆盖率采集（nav-quality-report 技能）。全量执行一遍 api / e2e / ui 测试，同时采集：
//   后端：NODE_V8_COVERAGE（playwright.config 中 BE_COVERAGE_DIR → webServer 环境变量），通过 c8 report 汇总
//   前端：先用 istanbul 把 extension/ 插桩到 coverage/.fe-instrumented/，UI 测试加载插桩后的插件（EXT_DIR），
//         由夹具在收尾时导出 SW 和插件页面中的 globalThis.__coverage__，最后用 istanbul-lib-report 汇总
// 用法（在项目根目录执行）：
//   node .agents/skills/nav-quality-report/scripts/collect-coverage.mjs [--port=4130] [--projects=api,e2e,ui] [--skip-fe] [--skip-be] [--root=<dir>]
// 产物：coverage/be/（c8 报告）、coverage/fe/（istanbul 报告）、coverage/summary.json（质量报告读取这个文件）
// 这次执行的证据写入 coverage/.evidence/，不会覆盖 evidence/ 中的正式证据。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const flag = (k) => args.includes(`--${k}`);

const ROOT = opt('root') ? path.resolve(opt('root')) : path.resolve(HERE, '../../../..');
const PORT = opt('port', '4130');
const PROJECTS = opt('projects', 'api,e2e,ui').split(',').filter(Boolean);
const SKIP_FE = flag('skip-fe') || !PROJECTS.includes('ui');
const SKIP_BE = flag('skip-be');
const COV = path.join(ROOT, 'coverage');
const DIR = { beRaw: path.join(COV, '.be-v8'), feRaw: path.join(COV, '.fe-raw'), feInst: path.join(COV, '.fe-instrumented'), be: path.join(COV, 'be'), fe: path.join(COV, 'fe'), ev: path.join(COV, '.evidence') };
const INSTALL_HINT = 'npm i -D c8 istanbul-lib-instrument istanbul-lib-coverage istanbul-lib-report istanbul-reports';
const JS_EXT = /\.(?:m?js|cjs)$/;

// 依赖按「被测项目」的 node_modules 解析（用 --root 指向其他目录时也成立）
const req = createRequire(path.join(ROOT, 'package.json'));
const has = (name) => { try { req.resolve(`${name}/package.json`); return true; } catch { return false; } };
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');
const stripAnsi = (s) => String(s || '').replace(/\u001b\[[0-9;]*m/g, '');
const notes = [];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir).sort()) {
    if (name === 'node_modules' || name === '.DS_Store') continue;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

/** istanbul / c8 的 json-summary → summary.json 中统一的结构 */
function normalizeSummary(summary) {
  const pick = (m) => ({ total: m.total, covered: m.covered, pct: typeof m.pct === 'number' && m.total > 0 ? m.pct : null });
  const files = Object.entries(summary).filter(([k]) => k !== 'total').map(([file, m]) => ({
    file: rel(path.isAbsolute(file) ? file : path.join(ROOT, file)), lines: pick(m.lines), statements: pick(m.statements), functions: pick(m.functions), branches: pick(m.branches),
  })).sort((a, b) => a.file.localeCompare(b.file));
  const t = summary.total;
  return { lines: pick(t.lines), statements: pick(t.statements), functions: pick(t.functions), branches: pick(t.branches), files };
}

// ---------------------------------------------------------------- 0. 前置检查
const missing = [];
if (!has('@playwright/test')) missing.push('@playwright/test');
if (!SKIP_BE && !has('c8')) missing.push('c8');
if (!SKIP_FE) for (const p of ['istanbul-lib-instrument', 'istanbul-lib-coverage', 'istanbul-lib-report', 'istanbul-reports']) if (!has(p)) missing.push(p);
if (missing.length) {
  console.error(`✖ 缺少依赖：${missing.join(', ')}\n  请在项目根目录执行：${INSTALL_HINT}`);
  process.exit(2);
}
if (!fs.existsSync(path.join(ROOT, 'playwright.config.mjs'))) { console.error('✖ 缺少 playwright.config.mjs（先完成阶段 4 测试基建）'); process.exit(2); }

for (const d of [DIR.beRaw, DIR.feRaw, DIR.feInst, DIR.ev]) fs.rmSync(d, { recursive: true, force: true });
fs.mkdirSync(DIR.beRaw, { recursive: true });
fs.mkdirSync(DIR.feRaw, { recursive: true });

// ---------------------------------------------------------------- 1. 前端插桩
const baseline = {}; // 每个插件 JS 文件的初始 fileCoverage（计数全为 0），用来把没执行到的文件也计入分母
if (!SKIP_FE) {
  const extDir = path.join(ROOT, 'extension');
  if (!fs.existsSync(extDir)) { notes.push('extension/ 不存在，跳过前端覆盖率'); }
  else {
    const { createInstrumenter } = req('istanbul-lib-instrument');
    const common = { coverageGlobalScope: 'globalThis', coverageGlobalScopeFunc: false, compact: false, preserveComments: true, produceSourceMap: false };
    const asModule = createInstrumenter({ ...common, esModules: true });
    const asScript = createInstrumenter({ ...common, esModules: false });
    for (const src of walk(extDir)) {
      const dest = path.join(DIR.feInst, path.relative(extDir, src));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (!JS_EXT.test(src)) { fs.copyFileSync(src, dest); continue; }
      const code = fs.readFileSync(src, 'utf8');
      let out = null; let inst = asModule;
      try { out = asModule.instrumentSync(code, src); }
      catch (e1) {
        try { out = asScript.instrumentSync(code, src); inst = asScript; }
        catch (e2) { notes.push(`插桩失败，按原文复制（不计入覆盖率）：${rel(src)}：${e2.message.split('\n')[0]}`); fs.copyFileSync(src, dest); continue; }
      }
      if (/new Function\s*\(/.test(out) && !/new Function\s*\(/.test(code)) notes.push(`插桩产物中出现 new Function，可能违反 MV3 CSP：${rel(src)}`);
      fs.writeFileSync(dest, out);
      baseline[src] = inst.lastFileCoverage();
    }
    fs.writeFileSync(path.join(COV, '.fe-baseline.json'), JSON.stringify(baseline));
    console.log(`· 已插桩 ${Object.keys(baseline).length} 个插件 JS 文件 → ${rel(DIR.feInst)}`);
  }
}

// ---------------------------------------------------------------- 2. 全量执行测试
const pwJson = path.join(COV, 'pw-coverage-run.json');
fs.rmSync(pwJson, { force: true });
const env = {
  ...process.env, CI: '1', FORCE_COLOR: '0', TEST_PORT: PORT,
  EVIDENCE_DIR: rel(DIR.ev), EVIDENCE_RUN_ID: `coverage-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  SERVER_LOG_FILE: path.join(DIR.ev, '_runtime', `server-${PORT}.log`), PLAYWRIGHT_JSON_OUTPUT_NAME: pwJson,
};
if (!SKIP_BE) env.BE_COVERAGE_DIR = rel(DIR.beRaw);
if (!SKIP_FE && Object.keys(baseline).length) { env.COLLECT_COVERAGE = '1'; env.EXT_DIR = rel(DIR.feInst); }
console.log(`· 执行测试：projects=${PROJECTS.join(',')} port=${PORT}`);
const pw = spawnSync('npx', ['playwright', 'test', '--reporter=json', ...PROJECTS.map((p) => `--project=${p}`)], { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 1_800_000 });
let run = { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0 };
try {
  const rep = JSON.parse(fs.readFileSync(pwJson, 'utf8'));
  const s = rep.stats || {};
  run = { total: (s.expected || 0) + (s.unexpected || 0) + (s.flaky || 0) + (s.skipped || 0), passed: s.expected || 0, failed: s.unexpected || 0, flaky: s.flaky || 0, skipped: s.skipped || 0 };
  for (const e of rep.errors || []) notes.push(`测试全局错误：${stripAnsi(e.message || e.value).slice(0, 300)}`);
} catch {
  notes.push(`没有生成测试报告：${stripAnsi(pw.stderr).slice(0, 800)}`);
}
if (run.failed) notes.push(`覆盖率采集运行中有 ${run.failed} 个测试失败，覆盖率可能偏低（失败用例没有执行完）`);

// ---------------------------------------------------------------- 3. 后端报告（c8）
let be = null;
if (!SKIP_BE) {
  const rawFiles = fs.readdirSync(DIR.beRaw).filter((f) => f.endsWith('.json'));
  if (!rawFiles.length) {
    notes.push('后端没有产生 V8 覆盖率文件：确认后端收到 SIGTERM 后会调用 process.exit（specs/backend.spec.md BE-RUN-03），且 playwright.config 的 webServer 配置了 gracefulShutdown');
  } else {
    fs.rmSync(DIR.be, { recursive: true, force: true });
    const c8 = spawnSync('npx', ['c8', 'report', `--temp-directory=${rel(DIR.beRaw)}`, `--reports-dir=${rel(DIR.be)}`,
      '--reporter=json-summary', '--reporter=html', '--reporter=text-summary', '--all', '--src=server', '--include=server/**', '--exclude-node-modules=true'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const sumFile = path.join(DIR.be, 'coverage-summary.json');
    if (c8.status !== 0 || !fs.existsSync(sumFile)) notes.push(`c8 report 失败：${stripAnsi(c8.stderr || c8.stdout).slice(0, 800)}`);
    else { be = normalizeSummary(JSON.parse(fs.readFileSync(sumFile, 'utf8'))); process.stdout.write(c8.stdout); }
  }
}

// ---------------------------------------------------------------- 4. 前端报告（istanbul）
let fe = null;
if (!SKIP_FE && Object.keys(baseline).length) {
  const libCoverage = req('istanbul-lib-coverage');
  const libReport = req('istanbul-lib-report');
  const reports = req('istanbul-reports');
  const map = libCoverage.createCoverageMap({});
  for (const fc of Object.values(baseline)) map.addFileCoverage(fc);
  const raws = fs.readdirSync(DIR.feRaw).filter((f) => f.endsWith('.json'));
  for (const f of raws) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(DIR.feRaw, f), 'utf8'));
      // 只合并插件源码（插桩时以原始绝对路径登记），忽略其他来源
      const own = Object.fromEntries(Object.entries(data).filter(([k]) => baseline[k]));
      map.merge(own);
    } catch (e) { notes.push(`无法解析前端覆盖率文件 ${f}：${e.message}`); }
  }
  if (!raws.length) notes.push('UI 测试没有导出任何前端覆盖率：确认 tests/fixtures/extension.mjs 在 COLLECT_COVERAGE=1 时会导出 __coverage__，且 UI 测试实际执行了');
  fs.rmSync(DIR.fe, { recursive: true, force: true });
  const context = libReport.createContext({ dir: DIR.fe, coverageMap: map, defaultSummarizer: 'nested' });
  reports.create('json-summary').execute(context);
  reports.create('html').execute(context);
  reports.create('text-summary', { file: 'summary.txt' }).execute(context);
  fe = normalizeSummary(JSON.parse(fs.readFileSync(path.join(DIR.fe, 'coverage-summary.json'), 'utf8')));
  fe.rawFiles = raws.length;
}

// ---------------------------------------------------------------- 5. 汇总
const summary = { generatedAt: new Date().toISOString(), root: ROOT, port: PORT, projects: PROJECTS, run, be, fe, notes };
fs.mkdirSync(COV, { recursive: true });
fs.writeFileSync(path.join(COV, 'summary.json'), JSON.stringify(summary, null, 2));
const pct = (m) => (m && m.pct !== null ? `${m.pct.toFixed(2)}%` : '未采集');
console.log(`\n测试：${run.passed}/${run.total} 通过，失败 ${run.failed}`);
console.log(`后端：行 ${pct(be?.lines)}  分支 ${pct(be?.branches)}  函数 ${pct(be?.functions)}  语句 ${pct(be?.statements)}`);
console.log(`前端：行 ${pct(fe?.lines)}  分支 ${pct(fe?.branches)}  函数 ${pct(fe?.functions)}  语句 ${pct(fe?.statements)}`);
for (const n of notes) console.log(`⚠ ${n}`);
console.log(`→ ${rel(path.join(COV, 'summary.json'))}（HTML 报告：coverage/be/index.html、coverage/fe/index.html）`);
process.exit(be || fe ? 0 : 1);
