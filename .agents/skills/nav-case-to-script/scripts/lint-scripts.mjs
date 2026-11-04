#!/usr/bin/env node
// 用例脚本静态检查（nav-case-to-script 技能）。
// 用法：node .agents/skills/nav-case-to-script/scripts/lint-scripts.mjs [CaseID ...] [--module=SYNC] [--type=API|E2E|UI] [--json]
// 不带参数时检查全部用例：每个用例都必须有脚本，每个脚本都必须对应一个已登记的用例。
// 退出码：0 表示没有 error（warning 不影响退出码）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = path.resolve(HERE, '../../../..');

const CASE_ID = /TC-(API|E2E|UI)-([A-Z]{2,10})-(\d{3})/;
const CASE_ID_G = /\bTC-(?:API|E2E|UI)-[A-Z]{2,10}-\d{3}\b/g;
export const TYPE_DIR = { API: 'tests/api', E2E: 'tests/e2e', UI: 'tests/ui' };
const FIXTURE_OF = { API: '../fixtures/api.mjs', E2E: '../fixtures/api.mjs', UI: '../fixtures/extension.mjs' };
const MUTATION_OPS = ['status', 'drop-item', 'reverse', 'num-shift', 'str-blank', 'drop-key'];
const WEAK = /\.(?:toBeTruthy|toBeDefined|toBeFalsy)\(\)|\.not\.(?:toBeNull|toBeUndefined)\(\)|\.toBeGreaterThan(?:OrEqual)?\(\s*0\s*\)/;
const STRONG = /\.(?:not\.)?(?:toBe|toEqual|toStrictEqual|toHaveLength|toMatchObject|toContain|toContainEqual|toHaveText|toContainText|toHaveCount|toMatch|toBeCloseTo|toBeLessThan|toBeLessThanOrEqual|toBeGreaterThan|toBeGreaterThanOrEqual|toHaveAttribute|toHaveValue|toBeVisible|toBeHidden|toBeEnabled|toBeDisabled|toHaveProperty|toHaveClass|toBeNull|toBeUndefined)\(/;

export function loadCases(root) {
  const read = (rel) => {
    const f = path.join(root, rel);
    if (!fs.existsSync(f)) return [];
    try { return JSON.parse(fs.readFileSync(f, 'utf8')).cases || []; } catch { return []; }
  };
  return [...read('docs/trace/cases-api.json'), ...read('docs/trace/cases-ui.json')];
}

function contractTestIds(root) {
  try {
    const ui = JSON.parse(fs.readFileSync(path.join(root, 'docs/trace/ui-contract.json'), 'utf8'));
    return new Set((ui.pages || []).flatMap((p) => (p.elements || []).map((e) => e.testId)));
  } catch { return null; }
}

export function specFileOf(c) { return `${TYPE_DIR[c.type]}/${c.id}.spec.mjs`; }

function listSpecFiles(root) {
  return Object.values(TYPE_DIR).flatMap((d) => {
    const abs = path.join(root, d);
    return fs.existsSync(abs) ? fs.readdirSync(abs).filter((f) => f.endsWith('.spec.mjs') || f.endsWith('.spec.js')).map((f) => `${d}/${f}`) : [];
  });
}

/** 去掉注释，保留行号（字符串里的 // 很少见，这里不做完整词法分析） */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function lintFile(root, rel, caseMap, testIds) {
  const errors = [];
  const warnings = [];
  const E = (rule, msg) => errors.push(`[${rule}] ${rel}：${msg}`);
  const W = (rule, msg) => warnings.push(`[${rule}] ${rel}：${msg}`);
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const code = stripComments(src);
  const lines = src.split('\n');
  const base = path.basename(rel).replace(/\.spec\.m?js$/, '');
  const info = { file: rel, caseId: null, expectedCount: 0, tagged: [], missingTags: [], weakTags: [], assertions: 0, steps: 0 };

  // L01 / L02 / L03：一个文件只对应一个 Case ID，文件名就是 Case ID
  const m = base.match(new RegExp(`^${CASE_ID.source}$`));
  if (!m) { E('L01', `文件名必须是 <CaseID>.spec.mjs（AGENTS.md：一个 Case ID 对应一个测试脚本），实际为 ${path.basename(rel)}`); return { errors, warnings, info }; }
  const caseId = base;
  info.caseId = caseId;
  const c = caseMap.get(caseId);
  if (!c) { E('L02', `${caseId} 未在 docs/trace/cases-*.json 中登记`); return { errors, warnings, info }; }
  if (!rel.startsWith(TYPE_DIR[c.type] + '/')) E('L03', `${c.type} 用例必须放在 ${TYPE_DIR[c.type]}/ 下`);

  // L04：test 标题以本文件的 Case ID 开头，且不出现其他 Case ID
  const titles = [...code.matchAll(/\btest(?:\.describe)?\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)].map((x) => x[2]);
  if (!titles.length) E('L04', '没有找到 test(\'<CaseID> …\', …)');
  for (const t of titles) {
    if (!t.trim().startsWith(caseId)) E('L04', `测试标题「${t}」必须以 ${caseId} 开头`);
    const others = (t.match(CASE_ID_G) || []).filter((id) => id !== caseId);
    if (others.length) E('L04', `测试标题「${t}」中出现了其他 Case ID：${others.join(', ')}`);
  }
  const otherIds = [...new Set((code.match(CASE_ID_G) || []).filter((id) => id !== caseId))];
  if (otherIds.length) E('L04', `文件中引用了其他用例 ${otherIds.join(', ')}：每个脚本只能实现一个用例`);

  // L05：必须从公共夹具导入 test / expect（否则不会自动 reset，也不会留痕）
  const fixture = FIXTURE_OF[c.type];
  if (!code.includes(`from '${fixture}'`) && !code.includes(`from "${fixture}"`)) E('L05', `必须 import { test, expect } from '${fixture}'`);
  if (/from\s+['"]@playwright\/test['"]/.test(code)) E('L05', '禁止直接从 @playwright/test 导入：会绕过 reset 和留痕夹具');

  // L06：expected 第 n 条 ↔ 断言标签 [En]
  const expected = Array.isArray(c.expected) ? c.expected : [];
  info.expectedCount = expected.length;
  const tagHits = new Map();
  lines.forEach((line, i) => {
    for (const t of line.matchAll(/\[E(\d+)\]/g)) {
      const n = Number(t[1]);
      const window = lines.slice(i, i + 5).join('\n');
      if (!/\bexpect(?:\.soft)?\s*\(/.test(window)) { E('L06', `第 ${i + 1} 行的 [E${n}] 附近（5 行内）没有 expect 断言`); continue; }
      // 取标签所在的那条语句（到第一个分号为止，最多 4 行）判断断言力度
      const stmtLines = [];
      for (const l of lines.slice(i, i + 4)) { stmtLines.push(l); if (l.includes(';')) break; }
      const stmt = stmtLines.join('\n');
      const strong = STRONG.test(stmt) && !WEAK.test(stmt);
      const prev = tagHits.get(n) || { count: 0, strong: false };
      tagHits.set(n, { count: prev.count + 1, strong: prev.strong || strong });
    }
  });
  for (let n = 1; n <= expected.length; n++) {
    if (!tagHits.has(n)) { info.missingTags.push(`E${n}`); E('L06', `用例 expected 第 ${n} 条（${String(expected[n - 1]).slice(0, 40)}…）没有对应的 [E${n}] 断言`); }
    else { info.tagged.push(`E${n}`); if (!tagHits.get(n).strong) { info.weakTags.push(`E${n}`); W('L15', `[E${n}] 只有弱断言（toBeTruthy / toBeDefined / > 0 等），请断言具体值`); } }
  }
  for (const n of tagHits.keys()) if (n > expected.length) E('L06', `[E${n}] 超出了用例 expected 的条数（${expected.length}），用例或脚本已过时`);

  // L07：步骤
  info.steps = (code.match(/\btest\.step\s*\(/g) || []).length;
  info.assertions = (code.match(/\bexpect(?:\.soft)?\s*\(/g) || []).length;
  if (c.type === 'E2E' && info.steps < 3) E('L07', `E2E 用例至少需要 3 个 test.step（当前 ${info.steps} 个），每步对应用例 steps 中的一步`);
  if (c.type !== 'E2E' && (c.steps || []).length >= 2 && info.steps === 0) W('L07', '用例有多个步骤，建议用 test.step 逐步标注，失败时能直接定位到步骤');

  // L08：禁止跳过、固定等待、非 testId 选择器
  if (/\b(?:test|it|describe)(?:\.describe)?\.(?:only|skip|fixme|fail)\s*\(/.test(code)) E('L08', '禁止 only / skip / fixme / fail');
  if (/\bwaitForTimeout\s*\(/.test(code)) E('L08', '禁止 waitForTimeout 固定等待：用 expect(...).toHaveText / toBeVisible 等自动重试断言，或 expect.poll');
  if (/\bpage\.\$\$?\s*\(|\.\$eval\s*\(|xpath=|css=/.test(code)) E('L08', '禁止 $ / $$ / $eval / xpath / css 选择器，只能用 getByTestId');
  if (/\.(?:getByText|getByRole|getByLabel|getByPlaceholder|getByTitle|getByAltText)\s*\(/.test(code)) E('L08', '只能用 getByTestId 定位元素（CONVENTIONS §5）；需要断言文本时用 expect(getByTestId(..)).toHaveText(..)');
  for (const lm of code.matchAll(/\.locator\s*\(\s*(['"`])([^'"`]*)\1/g)) if (lm[2] !== 'body') E('L08', `禁止 locator('${lm[2]}')，只能用 getByTestId`);

  // L09：testId 必须登记在 ui-contract
  for (const t of code.matchAll(/getByTestId\s*\(\s*(['"`])([^'"`$]+)\1/g)) {
    if (testIds && !testIds.has(t[2])) E('L09', `testId「${t[2]}」未在 docs/trace/ui-contract.json 中登记`);
  }

  // L10：禁止吞异常
  lines.forEach((line, i) => {
    if (/\bcatch\b/.test(stripComments(line)) && !/lint-allow-catch/.test(line + (lines[i - 1] || ''))) E('L10', `第 ${i + 1} 行使用了 catch：禁止用 try/catch 吞掉失败（确有必要时在同一行写 // lint-allow-catch: 理由）`);
  });

  // L11 / L12 / L13：禁止 mock 后端、白盒调用、绕过留痕
  if (c.type !== 'UI' && /\.route\s*\(|route\.fulfill/.test(code)) E('L11', 'API / E2E 用例禁止使用 route');
  if (/route\s*\(\s*['"`/][^\n]*(?:\/api|localhost|127\\?\.0\\?\.0\\?\.1)/.test(code)) E('L11', '禁止 route 后端 /api、localhost、127.0.0.1');
  if (/from\s+['"](?:\.\.\/)+(?:server|extension)\//.test(code)) E('L12', '禁止 import server/ 或 extension/ 的源码做白盒调用，只能走真实 HTTP / 真实插件');
  if (/\brequest\.(?:get|post|put|patch|delete|fetch|head)\s*\(/.test(code) || /(^|[^.\w])fetch\s*\(/m.test(code)) E('L13', '禁止直接使用 request / fetch：统一用 api 夹具，才能自动留痕和参与变异检查');

  // L14：禁止硬编码后端生成的 ID
  if (/['"`]\/api\/rules\/rule_[\w-]+['"`]/.test(code)) E('L14', '禁止硬编码规则 ID：从保存接口的响应中取出 id 再传给删除接口');
  for (const h of code.matchAll(/['"`]((?:page|rule|rec)_\d+)['"`]/g)) W('L14', `出现了疑似后端生成的 ID 字面量「${h[1]}」，请确认不是硬编码`);

  // L16 / L18：条件跳过、恒真断言
  if (/\bif\s*\([^)]*\)\s*(?:\{\s*)?return\b/.test(code)) E('L16', '禁止条件跳过（if (...) return）：前置条件不满足时应该让测试失败');
  if (/\bexpect\s*\(\s*(?:true|false|1|0|null|undefined|['"`][^'"`]*['"`])\s*[,)]/.test(code)) E('L18', '禁止对常量做断言（恒真断言）');

  // L19：变异豁免必须写明理由，且算子名合法
  for (const mi of src.matchAll(/\/\/\s*mutation-ignore:(.*)$/gm)) {
    const mm = /^\s*([a-z,\s-]+?)\s*(?:——|--|:)\s*(.{6,})$/.exec(mi[1]);
    if (!mm) { E('L19', `mutation-ignore 格式应为「// mutation-ignore: reverse —— 理由（至少 6 个字）」：${mi[0].trim()}`); continue; }
    for (const op of mm[1].split(',').map((x) => x.trim()).filter(Boolean)) if (!MUTATION_OPS.includes(op)) E('L19', `mutation-ignore 中的算子「${op}」不存在，可选 ${MUTATION_OPS.join(' / ')}`);
  }

  // L17 / L21：证据和断言力度
  if (c.type === 'UI' && !/\bext\.snap\s*\(/.test(code)) W('L17', 'UI 用例至少调用一次 ext.snap(page, \'步骤名\') 留下关键步骤截图');
  const statusOnly = (code.match(/expect\s*\([^)]*\.status\b[^)]*\)/g) || []).length;
  if (info.assertions && statusOnly === info.assertions) W('L21', '只断言了状态码，没有断言响应内容');

  return { errors, warnings, info };
}

/**
 * @param {{ root?: string, caseIds?: string[], module?: string, type?: string }} [opts]
 */
export function lintScripts({ root = DEFAULT_ROOT, caseIds = [], module, type } = {}) {
  const cases = loadCases(root);
  const caseMap = new Map(cases.map((c) => [c.id, c]));
  const testIds = contractTestIds(root);
  const errors = [];
  const warnings = [];
  if (!cases.length) errors.push('[L00] 没有找到 docs/trace/cases-api.json / cases-ui.json 中的用例');
  if (!testIds) warnings.push('[L00] 没有找到 docs/trace/ui-contract.json，跳过 testId 登记检查');

  const filtered = caseIds.length || module || type;
  const targets = cases.filter((c) => (!caseIds.length || caseIds.includes(c.id)) && (!module || c.module === module) && (!type || c.type === type));
  for (const id of caseIds) if (!caseMap.has(id)) errors.push(`[L02] ${id} 未在 docs/trace/cases-*.json 中登记`);

  const files = new Set(targets.map(specFileOf));
  if (!filtered) for (const f of listSpecFiles(root)) files.add(f); // 全量检查时，把不对应任何用例的脚本也揪出来
  const perCase = {};
  for (const rel of [...files].sort()) {
    if (!fs.existsSync(path.join(root, rel))) {
      const id = path.basename(rel).replace(/\.spec\.mjs$/, '');
      errors.push(`[L01] 用例 ${id} 缺少脚本 ${rel}`);
      perCase[id] = { file: rel, missing: true };
      continue;
    }
    const r = lintFile(root, rel, caseMap, testIds);
    errors.push(...r.errors);
    warnings.push(...r.warnings);
    if (r.info.caseId) perCase[r.info.caseId] = r.info;
  }
  const infos = Object.values(perCase).filter((x) => !x.missing);
  const expectedTotal = infos.reduce((s, x) => s + x.expectedCount, 0);
  const taggedTotal = infos.reduce((s, x) => s + x.tagged.length, 0);
  const weakTotal = infos.reduce((s, x) => s + x.weakTags.length, 0);
  return {
    pass: errors.length === 0,
    errors,
    warnings,
    stats: { files: files.size, cases: targets.length, expectedTotal, taggedTotal, weakTotal, tagCoverage: expectedTotal ? Number((taggedTotal / expectedTotal).toFixed(4)) : null },
    perCase,
  };
}

// ---------------------------------------------------------------- CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (k) => (args.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1];
  const root = opt('root') ? path.resolve(opt('root')) : DEFAULT_ROOT;
  const r = lintScripts({ root, caseIds: args.filter((a) => !a.startsWith('--')), module: opt('module'), type: opt('type') });
  if (args.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else {
    for (const e of r.errors) console.log(`✖ ${e}`);
    for (const w of r.warnings) console.log(`⚠ ${w}`);
    console.log(`\n${r.pass ? '✔ 通过' : '✖ 未通过'}：${r.errors.length} 个错误，${r.warnings.length} 个警告；脚本 ${r.stats.files} 个，expected 断言标签覆盖 ${r.stats.taggedTotal}/${r.stats.expectedTotal}，弱断言 ${r.stats.weakTotal} 处`);
  }
  process.exitCode = r.pass ? 0 : 1;
}
