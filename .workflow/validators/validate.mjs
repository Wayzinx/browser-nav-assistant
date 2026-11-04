#!/usr/bin/env node
// 工作流确定性校验器（由编排方维护，agent 只运行、不修改）。
// prd / cases / scripts / code / skeleton 阶段还会调用技能和规范自带的检查脚本，结果并入本次校验（见 CONVENTIONS §5）。
// 用法：node .workflow/validators/validate.mjs <stage> [选项]
//   校验：prd | design | cases | scripts | infra | skeleton | code | run | gate | mutation | explore | final
//   工具：merge-cases | pack | q <ID|MOD> | trace | lock | digest | restore
// 选项：--module=MOD（只报告该模块的问题；E2E 用 --module=E2E）  --side=BE|FE  --expect-digest=xxx
//       --project=api,e2e  --port=4100  --file=a,b（restore）  --failures=<gate 报告>（pack）  --brief（只打印摘要）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const abs = (rel) => path.join(ROOT, rel);
const exists = (rel) => fs.existsSync(abs(rel));

const [, , stage = 'help', ...rest] = process.argv;
const positional = rest.filter((a) => !a.startsWith('--'));
const opts = Object.fromEntries(rest.filter((a) => a.startsWith('--')).map((a) => {
  const [k, ...v] = a.slice(2).split('=');
  return [k, v.length ? v.join('=') : true];
}));
const MOD = opts.module ? String(opts.module).toUpperCase() : null;
const SIDE = opts.side ? String(opts.side).toUpperCase() : null;

const R = { stage, pass: true, module: MOD, errors: [], warnings: [], stats: {} };
let section = '';
const err = (m) => R.errors.push(section ? `[${section}] ${m}` : m);
const warn = (m) => R.warnings.push(section ? `[${section}] ${m}` : m);

// ------------------------------------------------------------------ 常量

const RE = {
  F: /^F-([A-Z]{2,10})-\d{2}$/,
  C: /^C-(FE|BE)-([A-Z]{2,10})-\d{2}$/,
  TC: /^TC-(API|E2E|UI)-([A-Z]{2,10})-\d{3}$/,
};
const SCAN = {
  F: /\bF-[A-Z]{2,10}-\d{2}\b/g,
  C: /\bC-(?:FE|BE)-[A-Z]{2,10}-\d{2}\b/g,
  TC: /\bTC-(?:API|E2E|UI)-[A-Z]{2,10}-\d{3}\b/g,
};
const REQUIRED_MODULES = ['CTX', 'SYNC', 'RANK', 'REC', 'CLEAN', 'RULE', 'DIAG', 'PRIV'];
const REQUIRED_ENDPOINTS = [
  'POST /api/sync', 'GET /api/pages/ranked', 'POST /api/recommendations/next',
  'GET /api/pages/cleanup-suggestions', 'POST /api/rules/parse', 'POST /api/rules',
  'GET /api/rules', 'DELETE /api/rules/:id', 'GET /api/health', 'GET /api/config',
];
const DIAG_ANCHORS = [
  ['/api/health'], ['tabs'], ['history'], ['storage'], ['baseurl', 'apibaseurl', 'api地址', '后端地址'],
  ['最近一次同步', '最近同步', 'lastsync'], ['规则数', '规则条数', 'rulecount'],
];
const KINDS = ['action', 'display', 'system', 'api', 'rule', 'nfr'];
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const TYPE_TO_PROJECT = { API: 'api', E2E: 'e2e', UI: 'ui' };
const TYPE_DIR = { API: 'tests/api', E2E: 'tests/e2e', UI: 'tests/ui' };
const LOCK_SCOPE = ['tests/api', 'tests/e2e', 'tests/ui', 'tests/fixtures', 'playwright.config.mjs'];
const LOCK_DIR = '.workflow/locks';
const IGNORE_DIRS = new Set(['node_modules', '.git', 'test-results', 'playwright-report', '.DS_Store', 'coverage']);
const FIXTURES = ['api', 'extension', 'evidence', 'mutation', 'sample'];

// 技能 / 规范自带的检查脚本（门禁中与 validator 自身的检查同等对待）
const SKILL = {
  req: ['需求点检查', '.agents/skills/nav-req-analysis/scripts/check-requirements.mjs'],
  cases: ['用例设计检查', '.agents/skills/nav-test-case-design/scripts/check-cases.mjs'],
  lint: ['脚本检查', '.agents/skills/nav-case-to-script/scripts/lint-scripts.mjs'],
  spec: ['代码规范检查', 'specs/tools/check-spec.mjs'],
};
const RUN_CASES = '.agents/skills/nav-case-to-script/scripts/run-cases.mjs';

const PATHS = {
  prd: 'docs/02-PRD.md', features: 'docs/trace/features.json', requirements: 'docs/trace/requirements.json',
  beDoc: 'docs/03-技术方案-后端.md', beCp: 'docs/trace/code-points-be.json', api: 'docs/trace/api-contract.json',
  feDoc: 'docs/04-技术方案-前端.md', feCp: 'docs/trace/code-points-fe.json', ui: 'docs/trace/ui-contract.json',
  arch: 'docs/05-系统架构.md',
  apiCasesDoc: 'docs/06-测试用例-接口与E2E.md', apiCases: 'docs/trace/cases-api.json',
  uiCasesDoc: 'docs/07-测试用例-UI.md', uiCases: 'docs/trace/cases-ui.json',
  caseFragJson: 'docs/trace/cases', caseFragMd: 'docs/cases',
  matrix: 'docs/trace/matrix.md', caseStatus: '.workflow/reports/case-status.json',
  packs: '.workflow/context/packs',
};

// ------------------------------------------------------------------ 工具

function readText(rel, required = true) {
  if (!exists(rel)) { if (required) err(`缺少文件 ${rel}`); return null; }
  return fs.readFileSync(abs(rel), 'utf8');
}
function readJson(rel, required = true) {
  const t = readText(rel, required);
  if (t == null) return null;
  try { return JSON.parse(t); } catch (e) { err(`${rel} 不是合法 JSON：${e.message}`); return null; }
}
function writeAtomic(rel, content) {
  fs.mkdirSync(path.dirname(abs(rel)), { recursive: true });
  const tmp = `${abs(rel)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, abs(rel));
}
function walk(rel, filter = () => true, out = []) {
  const p = abs(rel);
  if (!fs.existsSync(p)) return out;
  const st = fs.statSync(p);
  if (st.isFile()) { if (filter(rel)) out.push(rel); return out; }
  for (const name of fs.readdirSync(p).sort()) {
    if (IGNORE_DIRS.has(name)) continue;
    walk(path.posix.join(rel, name), filter, out);
  }
  return out;
}
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isStrArr = (v, min = 1) => Array.isArray(v) && v.length >= min && v.every(isStr);
const uniq = (a) => [...new Set(a)];
const scanIds = (text, re) => uniq(String(text).match(re) || []);
const normEndpoint = (s) => String(s).trim().replace(/\s+/g, ' ').replace(/\{[^}]+\}|:[A-Za-z_]+/g, ':id').replace(/\/$/, '');
const stripAnsi = (s) => String(s || '').replace(/\u001b\[[0-9;]*m/g, '');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const short = (s, n = 160) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };
const modOfCase = (id) => (String(id).match(RE.TC) || [])[2] || null;
// 模块过滤：--module=E2E 表示全部 E2E 用例
const inModCase = (t) => !MOD || (MOD === 'E2E' ? t.type === 'E2E' : t.module === MOD && t.type !== 'E2E');
const inModFeature = (f) => !MOD || MOD === 'E2E' || f.module === MOD;
const inModCode = (c) => (!MOD || MOD === 'E2E' || c.module === MOD) && (!SIDE || c.side === SIDE);
const mentionsMod = (msg) => !MOD || (MOD === 'E2E' ? /TC-E2E-/.test(msg) : new RegExp(`-${MOD}-\\d`).test(msg));

function checkDocIds(docRel, kind, knownSet, scopeLabel, mustContain) {
  const text = readText(docRel);
  if (text == null) return;
  const found = new Set(scanIds(text, SCAN[kind]));
  for (const id of mustContain) if (!found.has(id)) err(`${docRel} 中缺少 ${scopeLabel} ${id}`);
  for (const id of found) if (!knownSet.has(id) && mentionsMod(id)) err(`${docRel} 中出现未登记的 ID ${id}`);
}

// 运行技能自带的检查脚本（--json），把它的 errors / warnings 并入本次结果；模块模式下只保留提到该模块的条目
function skillCheck(key, args = []) {
  const [label, rel] = SKILL[key];
  if (!exists(rel)) { warn(`未找到 ${rel}，跳过${label}`); return null; }
  const r = spawnSync(process.execPath, [abs(rel), '--json', ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300000 });
  const out = r.stdout || '';
  let j = null;
  try { j = JSON.parse(out.slice(out.indexOf('{'))); } catch { /* 下面统一报错 */ }
  if (!j) { R.errors.push(`[${label}] 检查脚本输出无法解析（exit ${r.status}）：${short(stripAnsi(r.stderr || out), 500)}`); return null; }
  const fmt = (e) => (typeof e === 'string' ? e : `${e.rule || ''} ${e.file || ''}${e.line ? ':' + e.line : ''} ${e.message || JSON.stringify(e)}`.trim());
  const keep = (m) => !MOD || mentionsMod(m);
  const errs = (j.errors || []).map(fmt).filter(keep);
  for (const e of errs) R.errors.push(`[${label}] ${e}`);
  for (const w of (j.warnings || []).map(fmt).filter(keep).slice(0, 20)) R.warnings.push(`[${label}] ${w}`);
  R.stats.skillChecks = { ...(R.stats.skillChecks || {}), [key]: { script: rel, pass: !errs.length, errors: errs.length, warnings: (j.warnings || []).length } };
  return j;
}

// ------------------------------------------------------------------ 加载

function loadFeatures() {
  const j = readJson(PATHS.features);
  const list = Array.isArray(j?.features) ? j.features : [];
  if (j && !Array.isArray(j.features)) err(`${PATHS.features} 缺少 features 数组`);
  return { json: j, list, map: new Map(list.filter((f) => f && f.id).map((f) => [f.id, f])) };
}
function loadCodePoints(required = true) {
  const be = readJson(PATHS.beCp, required); const fe = readJson(PATHS.feCp, required);
  const list = [
    ...((be?.codePoints) || []).map((c) => ({ ...c, __file: PATHS.beCp, __side: 'BE' })),
    ...((fe?.codePoints) || []).map((c) => ({ ...c, __file: PATHS.feCp, __side: 'FE' })),
  ];
  if (be && !Array.isArray(be.codePoints)) err(`${PATHS.beCp} 缺少 codePoints 数组`);
  if (fe && !Array.isArray(fe.codePoints)) err(`${PATHS.feCp} 缺少 codePoints 数组`);
  return { list, map: new Map(list.filter((c) => c && c.id).map((c) => [c.id, c])) };
}
function loadCases(required = true) {
  const a = readJson(PATHS.apiCases, required); const u = readJson(PATHS.uiCases, required);
  const list = [
    ...((a?.cases) || []).map((c) => ({ ...c, __file: PATHS.apiCases })),
    ...((u?.cases) || []).map((c) => ({ ...c, __file: PATHS.uiCases })),
  ];
  if (a && !Array.isArray(a.cases)) err(`${PATHS.apiCases} 缺少 cases 数组`);
  if (u && !Array.isArray(u.cases)) err(`${PATHS.uiCases} 缺少 cases 数组`);
  return { list, map: new Map(list.filter((c) => c && c.id).map((c) => [c.id, c])) };
}
function listModules() {
  const F = loadFeatures();
  const C = loadCodePoints(false);
  R.modules = uniq(F.list.filter((f) => f?.inScope).map((f) => f.module)).sort();
  R.sharedModules = uniq(C.list.map((c) => c.module)).filter((m) => m && !R.modules.includes(m)).sort();
}

// ------------------------------------------------------------------ 用例分片合并

// 按模块并行设计用例时，每个设计 agent 只写自己的分片：
//   docs/trace/cases/<API|UI>-<MOD>.json、docs/trace/cases/E2E.json；docs/cases/<同名>.md
// cases-api.json / cases-ui.json / docs/06 / docs/07 由这里合并生成。没有分片目录时不做任何事。
function mergeCases() {
  if (!exists(PATHS.caseFragJson)) return false;
  const frags = walk(PATHS.caseFragJson, (f) => f.endsWith('.json'));
  if (!frags.length) return false;
  const api = [], ui = [], wApi = [], wUi = [];
  const seen = new Map();
  for (const f of frags) {
    const j = readJson(f);
    if (!j) continue;
    for (const c of j.cases || []) {
      if (seen.has(c.id)) err(`Case ID ${c.id} 同时出现在分片 ${seen.get(c.id)} 和 ${f}`);
      seen.set(c.id, f);
      (c.type === 'UI' ? ui : api).push(c);
    }
    (path.basename(f).startsWith('UI') ? wUi : wApi).push(...(j.waivers || []));
  }
  const byId = (a, b) => String(a.id).localeCompare(String(b.id));
  const head = (src) => `由 node .workflow/validators/validate.mjs merge-cases 从 ${src} 合并生成，请修改分片，不要直接改本文件`;
  writeAtomic(PATHS.apiCases, JSON.stringify({ _generated: head('docs/trace/cases/{API-*,E2E}.json'), cases: api.sort(byId), waivers: wApi }, null, 2));
  writeAtomic(PATHS.uiCases, JSON.stringify({ _generated: head('docs/trace/cases/UI-*.json'), cases: ui.sort(byId), waivers: wUi }, null, 2));
  const mds = walk(PATHS.caseFragMd, (f) => f.endsWith('.md'));
  const body = (pred) => mds.filter((f) => pred(path.basename(f))).map((f) => fs.readFileSync(abs(f), 'utf8').trim()).join('\n\n---\n\n');
  writeAtomic(PATHS.apiCasesDoc, `# 测试用例：接口与 E2E\n\n> ${head('docs/cases/{API-*,E2E}.md')}\n\n${body((n) => n.startsWith('API') || n.startsWith('E2E'))}\n`);
  writeAtomic(PATHS.uiCasesDoc, `# 测试用例：UI\n\n> ${head('docs/cases/UI-*.md')}\n\n${body((n) => n.startsWith('UI'))}\n`);
  R.stats.merged = { fragments: frags.length, api: api.length, ui: ui.length };
  return true;
}

// ------------------------------------------------------------------ 阶段 1：PRD

function checkPrd() {
  section = 'prd';
  const F = loadFeatures();
  const seen = new Set();
  for (const f of F.list) {
    const id = f?.id;
    if (!isStr(id) || !RE.F.test(id)) { err(`非法 Feature ID：${JSON.stringify(id)}`); continue; }
    if (seen.has(id)) err(`重复的 Feature ID：${id}`); seen.add(id);
    const mod = id.match(RE.F)[1];
    if (f.module !== mod) err(`${id} 的 module(${f.module}) 与 ID 中的模块(${mod}) 不一致`);
    if (!isStr(f.name)) err(`${id} 缺少 name`);
    if (!KINDS.includes(f.kind)) err(`${id} 的 kind 非法(${f.kind})，可选 ${KINDS.join('/')}`);
    if (!Array.isArray(f.layers) || !f.layers.length || !f.layers.every((l) => l === 'FE' || l === 'BE')) err(`${id} 的 layers 必须是 ["FE"] / ["BE"] / ["FE","BE"]`);
    if (!PRIORITIES.includes(f.priority)) err(`${id} 的 priority 非法(${f.priority})`);
    if (typeof f.inScope !== 'boolean') err(`${id} 缺少布尔类型的 inScope`);
    if (!isStr(f.source)) err(`${id} 缺少 source（需求出处）`);
    if (!isStr(f.description)) err(`${id} 缺少 description`);
    if (!isStrArr(f.acceptance)) err(`${id} 至少需要 1 条 acceptance（验收标准）`);
  }
  const inScope = F.list.filter((f) => f?.inScope === true);
  if (inScope.length < 25) err(`inScope 的 Feature 只有 ${inScope.length} 个，粒度过粗（要求每个动作 / 操作一个 ID，至少 25 个）`);
  const mods = new Set(inScope.map((f) => f.module));
  for (const m of REQUIRED_MODULES) if (!mods.has(m)) err(`缺少必备模块 ${m} 的 inScope Feature`);
  if (!Array.isArray(F.json?.decisions) || !F.json.decisions.length) warn('features.json 中没有 decisions（决策记录）');
  if (!exists(PATHS.requirements)) err(`缺少 ${PATHS.requirements}（REQ 原始需求点，见 nav-req-analysis 技能）`);

  const md = readText(PATHS.prd);
  if (md != null) {
    checkDocIds(PATHS.prd, 'F', new Set(F.map.keys()), 'Feature', [...F.map.keys()]);
    const flat = md.toLowerCase().replace(/\s+/g, '');
    for (const ep of REQUIRED_ENDPOINTS.filter((e) => !e.includes(':id') && !e.startsWith('GET /api/rules'))) {
      const p = ep.split(' ')[1];
      if (!md.includes(p)) err(`PRD 未提及接口 ${p}`);
    }
    for (const alts of DIAG_ANCHORS) if (!alts.some((a) => flat.includes(a.toLowerCase()))) err(`PRD 未覆盖诊断项（关键词：${alts.join(' / ')}）`);
    if (!md.includes('resource.json')) err('PRD 未引用 resource.json 样例数据推演');
    if (!/决策/.test(md)) err('PRD 缺少「决策记录」章节');
    if (!/验收/.test(md)) err('PRD 缺少验收相关章节');
  }
  R.stats.prd = { features: F.list.length, inScope: inScope.length, modules: [...mods].sort() };
  section = '';
  return F;
}

// ------------------------------------------------------------------ 阶段 2：技术方案

function fileOwnership(C) {
  const m = {};
  for (const c of C.list) for (const f of c.files || []) (m[f] ||= { modules: new Set(), side: c.side }).modules.add(c.module);
  const out = {};
  for (const [f, v] of Object.entries(m)) {
    const mods = [...v.modules].sort();
    out[f] = { side: v.side, modules: mods, owner: mods.length === 1 ? mods[0] : mods.includes('CORE') ? 'CORE' : 'CONFLICT' };
  }
  return out;
}

function checkDesign() {
  const F = checkPrd();
  section = 'design';
  const C = loadCodePoints();
  const seen = new Set();
  for (const c of C.list) {
    const id = c?.id;
    if (!isStr(id) || !RE.C.test(id)) { err(`${c.__file} 中有非法 Code ID：${JSON.stringify(id)}`); continue; }
    if (seen.has(id)) err(`重复的 Code ID：${id}`); seen.add(id);
    const [, side, mod] = id.match(RE.C);
    if (side !== c.__side) err(`${id} 写在 ${c.__file} 中，但 ID 前缀是 ${side}`);
    if (c.side !== side) err(`${id} 的 side 字段(${c.side}) 与 ID 前缀不一致`);
    if (c.module !== mod) err(`${id} 的 module(${c.module}) 与 ID 中的模块(${mod}) 不一致`);
    if (!isStr(c.name)) err(`${id} 缺少 name`);
    if (!isStr(c.description)) err(`${id} 缺少 description`);
    if (!isStrArr(c.files)) err(`${id} 缺少 files（计划落地的文件路径）`);
    else {
      const okPrefix = side === 'FE' ? ['extension/'] : ['server/', 'scripts/', 'resources/'];
      for (const fp of c.files) if (!okPrefix.some((p) => fp.startsWith(p))) err(`${id} 的文件 ${fp} 不在 ${okPrefix.join(' / ')} 下`);
    }
    if (!isStrArr(c.features)) err(`${id} 未关联任何 Feature`);
    else for (const fid of c.features) {
      const f = F.map.get(fid);
      if (!f) err(`${id} 引用了不存在的 Feature ${fid}`);
      else if (!f.inScope) warn(`${id} 关联了 inScope=false 的 Feature ${fid}`);
      else if (Array.isArray(f.layers) && !f.layers.includes(side)) warn(`${id}(${side}) 关联的 ${fid} 的 layers 为 ${f.layers.join(',')}，不含 ${side}`);
    }
  }
  for (const f of F.list.filter((x) => x?.inScope)) {
    for (const layer of (f.layers || [])) {
      if (!C.list.some((c) => c.side === layer && (c.features || []).includes(f.id))) err(`Feature ${f.id}（${f.name}）的 layers 含 ${layer}，但没有任何 C-${layer} 代码点`);
    }
  }
  const known = new Set(C.map.keys());
  const beIds = C.list.filter((c) => c.__side === 'BE').map((c) => c.id);
  const feIds = C.list.filter((c) => c.__side === 'FE').map((c) => c.id);
  checkDocIds(PATHS.beDoc, 'C', known, 'Code', beIds);
  checkDocIds(PATHS.feDoc, 'C', known, 'Code', feIds);
  for (const doc of [PATHS.beDoc, PATHS.feDoc, PATHS.arch]) {
    const t = readText(doc, false);
    if (t) for (const fid of scanIds(t, SCAN.F)) if (!F.map.has(fid)) err(`${doc} 引用了不存在的 Feature ${fid}`);
    if (t && doc === PATHS.arch) for (const cid of scanIds(t, SCAN.C)) if (!known.has(cid)) err(`${doc} 引用了不存在的 ${cid}`);
  }
  const api = readJson(PATHS.api);
  if (api) {
    if (!Array.isArray(api.endpoints)) err(`${PATHS.api} 缺少 endpoints 数组`);
    const eps = new Map();
    for (const e of api.endpoints || []) {
      const key = normEndpoint(`${String(e.method || '').toUpperCase()} ${e.path || ''}`);
      if (eps.has(key)) err(`api-contract 中有重复接口 ${key}`);
      eps.set(key, e);
      if (!isStrArr(e.codePoints)) err(`接口 ${key} 未关联 Code ID`);
      else for (const cid of e.codePoints) { const c = C.map.get(cid); if (!c) err(`接口 ${key} 引用了不存在的 ${cid}`); else if (c.side !== 'BE') err(`接口 ${key} 只能关联 C-BE，实际关联了 ${cid}`); }
      if (!isStrArr(e.features)) err(`接口 ${key} 未关联 Feature`);
      else for (const fid of e.features) if (!F.map.has(fid)) err(`接口 ${key} 引用了不存在的 ${fid}`);
      if (!e.response || typeof e.response !== 'object' || !Object.keys(e.response).length) err(`接口 ${key} 缺少 response 定义`);
    }
    for (const req of REQUIRED_ENDPOINTS) if (!eps.has(normEndpoint(req))) err(`api-contract 缺少必需接口 ${req}`);
    R.stats.apiEndpoints = eps.size;
  }
  const ui = readJson(PATHS.ui);
  if (ui) {
    if (!Array.isArray(ui.pages) || !ui.pages.length) err(`${PATHS.ui} 缺少 pages`);
    const tids = new Set();
    for (const p of ui.pages || []) {
      if (!isStr(p.path) || !p.path.startsWith('extension/')) err(`ui-contract 页面 ${p.name} 的 path 必须位于 extension/ 下`);
      for (const el of p.elements || []) {
        if (!isStr(el.testId) || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(el.testId)) err(`ui-contract 中有非法 testId：${JSON.stringify(el.testId)}`);
        if (tids.has(el.testId)) err(`ui-contract 中 testId 重复：${el.testId}`); tids.add(el.testId);
        if (!isStrArr(el.codePoints)) err(`testId ${el.testId} 未关联 Code ID`);
        else for (const cid of el.codePoints) { const c = C.map.get(cid); if (!c) err(`testId ${el.testId} 引用了不存在的 ${cid}`); else if (c.side !== 'FE') err(`testId ${el.testId} 只能关联 C-FE（实际为 ${cid}）`); }
      }
    }
    if (!Array.isArray(ui.messages) || !ui.messages.length) err('ui-contract 缺少 messages（popup ↔ background 消息协议）');
    for (const m of ui.messages || []) {
      if (!isStr(m.type)) err('ui-contract 中有 message 缺少 type');
      if (!isStrArr(m.codePoints)) err(`message ${m.type} 未关联 Code ID`);
    }
    R.stats.uiTestIds = tids.size;
  }
  const arch = readText(PATHS.arch);
  if (arch != null) {
    if (arch.length < 3000) err(`${PATHS.arch} 内容过少（${arch.length} 字符）`);
    const need = [['时序', '流程'], ['数据模型'], ['部署', '启动'], ['持久化'], ['追溯', 'Code ID', 'Feature ID'], ['所有权', '归属']];
    for (const alts of need) if (!alts.some((a) => arch.includes(a))) err(`${PATHS.arch} 缺少章节（关键词：${alts.join(' / ')}）`);
  }
  // 文件所有权：被多个业务模块共用的文件必须拆分或登记为 CORE，否则按模块并行开发时会互相覆盖
  const owners = fileOwnership(C);
  const conflicts = Object.entries(owners).filter(([, o]) => o.owner === 'CONFLICT');
  for (const [file, o] of conflicts) err(`文件 ${file} 被多个业务模块的代码点共用（${o.modules.join(', ')}）：拆分文件，或增加一个 CORE 代码点负责该文件`);
  R.stats.design = { codePoints: C.list.length, be: beIds.length, fe: feIds.length, coreFiles: Object.values(owners).filter((o) => o.owner === 'CORE').length };
  section = '';
  return { F, C };
}

// ------------------------------------------------------------------ 阶段 3：测试用例

function checkCases() {
  mergeCases();
  const { F, C } = checkDesign();
  section = 'cases';
  const T = loadCases();
  const seen = new Set();
  for (const t of T.list) {
    const id = t?.id;
    if (!isStr(id) || !RE.TC.test(id)) { err(`${t.__file} 中有非法 Case ID：${JSON.stringify(id)}`); continue; }
    if (seen.has(id)) err(`重复的 Case ID：${id}`); seen.add(id);
    if (!inModCase(t)) continue;
    const [, type, mod] = id.match(RE.TC);
    if (t.type !== type) err(`${id} 的 type(${t.type}) 与 ID 不一致`);
    if (t.module !== mod) err(`${id} 的 module(${t.module}) 与 ID 不一致`);
    const expectFile = type === 'UI' ? PATHS.uiCases : PATHS.apiCases;
    if (t.__file !== expectFile) err(`${id} 应写在 ${expectFile} 中`);
    if (!isStr(t.title)) err(`${id} 缺少 title`);
    if (!PRIORITIES.includes(t.priority)) err(`${id} 的 priority 非法`);
    if (!isStrArr(t.steps)) err(`${id} 缺少 steps`);
    if (!isStrArr(t.expected)) err(`${id} 缺少 expected`);
    if (t.preconditions != null && !Array.isArray(t.preconditions)) err(`${id} 的 preconditions 必须是数组`);
    if (!isStrArr(t.features)) err(`${id} 未关联 Feature`);
    if (!isStrArr(t.codePoints)) err(`${id} 未关联 Code ID`);
    const fset = new Set(t.features || []);
    for (const fid of t.features || []) { const f = F.map.get(fid); if (!f) err(`${id} 引用了不存在的 ${fid}`); else if (!f.inScope) warn(`${id} 测试的是 inScope=false 的 ${fid}`); }
    const cps = (t.codePoints || []).map((cid) => [cid, C.map.get(cid)]);
    for (const [cid, c] of cps) {
      if (!c) { err(`${id} 引用了不存在的 ${cid}`); continue; }
      if ((type === 'API' || type === 'E2E') && c.side !== 'BE') err(`${id}（${type}）只能引用 C-BE，实际引用了 ${cid}`);
      if (!(c.features || []).some((fid) => fset.has(fid))) err(`${id} 引用的 ${cid} 与用例的 Feature 没有交集（${cid}.features=${(c.features || []).join(',')}）`);
    }
    if (type === 'UI' && !cps.some(([, c]) => c?.side === 'FE')) err(`${id}（UI）至少要引用 1 个 C-FE`);
    if (type === 'E2E') {
      if ((t.steps || []).length < 3) err(`${id}（E2E）至少需要 3 步`);
      const mods = new Set(cps.map(([, c]) => c?.module).filter(Boolean));
      if (mods.size < 2) err(`${id}（E2E）引用的代码点需跨至少 2 个模块，实际只有 ${[...mods].join(',') || '0 个'}`);
    }
  }
  if (!MOD) {
    const e2e = T.list.filter((t) => t.type === 'E2E').length;
    if (e2e < 3) err(`E2E 用例只有 ${e2e} 个，至少需要 3 个`);
  }
  if (MOD !== 'E2E') {
    for (const f of F.list.filter((x) => x?.inScope && inModFeature(x))) {
      const cs = T.list.filter((t) => (t.features || []).includes(f.id));
      if (!cs.length) { err(`Feature ${f.id}（${f.name}）没有任何测试用例`); continue; }
      if ((f.layers || []).includes('BE') && !cs.some((t) => t.type === 'API' || t.type === 'E2E')) err(`Feature ${f.id} 含 BE 层，但没有 API / E2E 用例`);
      if ((f.layers || []).includes('FE') && !cs.some((t) => t.type === 'UI')) err(`Feature ${f.id} 含 FE 层，但没有 UI 用例`);
    }
    for (const c of C.list.filter(inModCode)) {
      if (!(c.features || []).some((fid) => F.map.get(fid)?.inScope)) continue;
      if (!T.list.some((t) => (t.codePoints || []).includes(c.id))) err(`代码点 ${c.id}（${c.name}）没有被任何用例引用`);
    }
  }
  const known = new Set(T.map.keys());
  checkDocIds(PATHS.apiCasesDoc, 'TC', known, 'Case', T.list.filter((t) => t.type !== 'UI' && inModCase(t)).map((t) => t.id));
  checkDocIds(PATHS.uiCasesDoc, 'TC', known, 'Case', T.list.filter((t) => t.type === 'UI' && inModCase(t)).map((t) => t.id));
  const byType = {}; for (const t of T.list) byType[t.type] = (byType[t.type] || 0) + 1;
  R.stats.cases = { total: T.list.length, byType, uiModules: uniq(T.list.filter((t) => t.type === 'UI').map((t) => t.module)).sort() };
  section = '';
  skillCheck('cases');
  return { F, C, T };
}

// ------------------------------------------------------------------ 阶段 4：测试基建 + 自动化脚本

function playwrightList(files = []) {
  const r = spawnSync('npx', ['playwright', 'test', '--list', '--reporter=json', ...files], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 180000,
    env: { ...process.env, TEST_PORT: process.env.TEST_PORT || '4199', CI: '1', FORCE_COLOR: '0' },
  });
  const out = r.stdout || '';
  const start = out.indexOf('{');
  if (start < 0) { err(`playwright --list 没有输出 JSON：${short(stripAnsi(r.stderr), 800)}`); return null; }
  try { return JSON.parse(out.slice(start)); } catch (e) { err(`playwright --list 输出无法解析：${e.message}；stderr=${short(stripAnsi(r.stderr), 500)}`); return null; }
}
function collectSpecs(suites, out = []) {
  for (const s of suites || []) {
    for (const sp of s.specs || []) out.push(sp);
    collectSpecs(s.suites, out);
  }
  return out;
}
function uiTestIdsFromContract() {
  const ui = readJson(PATHS.ui, false);
  return new Set((ui?.pages || []).flatMap((p) => (p.elements || []).map((e) => e.testId)));
}

function checkInfra() {
  section = 'infra';
  const pkg = readJson('package.json');
  const deps = { ...pkg?.devDependencies, ...pkg?.dependencies };
  if (pkg && !deps['@playwright/test']) err('package.json 未声明 @playwright/test');
  for (const d of ['pngjs', 'gifenc']) if (pkg && !deps[d]) err(`package.json 未声明 ${d}（evidence 的 flow.gif 依赖它）`);
  for (const d of ['@playwright/test', 'pngjs', 'gifenc']) if (!exists(`node_modules/${d}`)) err(`未安装 ${d}（在项目根目录执行 npm install）`);
  if (!exists('playwright.config.mjs')) err('缺少 playwright.config.mjs');
  for (const f of FIXTURES) if (!exists(`tests/fixtures/${f}.mjs`)) err(`缺少夹具 tests/fixtures/${f}.mjs（从 .agents/skills/nav-case-to-script/assets/fixtures/ 复制）`);
  if (!exists('scripts/test.sh')) err('缺少 scripts/test.sh');
  else if (!(fs.statSync(abs('scripts/test.sh')).mode & 0o111)) err('scripts/test.sh 没有可执行权限');
  if (exists('playwright.config.mjs') && exists('node_modules/@playwright/test')) {
    const list = playwrightList();
    for (const e of list?.errors || []) err(`playwright 加载错误：${short(stripAnsi(e.message), 400)}`);
    const projects = (list?.config?.projects || []).map((p) => p.name);
    for (const p of ['api', 'e2e', 'ui']) if (list && !projects.includes(p)) err(`playwright.config 缺少 project「${p}」`);
    for (const p of list?.config?.projects || []) if (p.retries !== 0) err(`project ${p.name} 的 retries=${p.retries}，必须为 0`);
  }
  section = '';
}

function checkScripts() {
  const { T } = checkCases();
  checkInfra();
  section = 'scripts';
  const targets = T.list.filter(inModCase);
  const contractIds = uiTestIdsFromContract();
  // AGENTS.md 约定 2：一个 Case ID 对应一个测试脚本，文件名就是 Case ID
  const specFiles = ['tests/api', 'tests/e2e', 'tests/ui'].flatMap((d) => walk(d, (f) => /\.spec\.m?js$/.test(f)));
  for (const f of specFiles) {
    const id = path.basename(f).replace(/\.spec\.m?js$/, '');
    if (!RE.TC.test(id)) { err(`${f}：脚本文件名必须是 <CaseID>.spec.mjs（一个 Case ID 对应一个测试脚本）`); continue; }
    if (MOD && !mentionsMod(id)) continue;
    const tc = T.map.get(id);
    if (!tc) { err(`${f} 对应的 ${id} 未在用例中登记`); continue; }
    if (`${TYPE_DIR[tc.type]}/${id}.spec.mjs` !== f) err(`${f}：${id} 必须放在 ${TYPE_DIR[tc.type]}/ 下`);
  }
  for (const t of targets) if (!exists(`${TYPE_DIR[t.type]}/${t.id}.spec.mjs`)) err(`用例 ${t.id}（${t.title}）缺少脚本 ${TYPE_DIR[t.type]}/${t.id}.spec.mjs`);
  // 静态扫描
  const scan = walk('tests', (f) => /\.m?js$/.test(f) && !f.startsWith('tests/explore/')).filter((f) => !MOD || f.startsWith('tests/fixtures/') || mentionsMod(f));
  for (const f of scan) {
    const src = readText(f);
    if (/\b(?:test|it|describe)\.(?:only|skip|fixme|fail)\s*\(/.test(src) || /\btest\.describe\.(?:only|skip|fixme)\s*\(/.test(src)) err(`${f} 使用了 only / skip / fixme / fail，禁止跳过用例`);
    if (/\bnock\b|\bmsw\b|\bsinon\b/.test(src)) err(`${f} 使用了 mock 库（禁止 mock 后端）`);
    if (/route\(\s*['"`][^'"`]*(?:\/api|localhost|127\.0\.0\.1)/.test(src)) err(`${f} 对后端 / localhost 做了 route 拦截，禁止 mock 后端`);
    if ((f.startsWith('tests/api/') || f.startsWith('tests/e2e/')) && /\.route\(|route\.fulfill/.test(src)) err(`${f} API / E2E 测试中禁止使用 route`);
    if (f.startsWith('tests/ui/') || f.startsWith('tests/fixtures/')) {
      for (const m of src.matchAll(/getByTestId\(\s*['"`]([^'"`$]+)['"`]/g)) if (!contractIds.has(m[1])) err(`${f} 使用了 ui-contract 中未登记的 testId「${m[1]}」`);
    }
  }
  // playwright --list：配置可加载、标题以 Case ID 开头、文件与用例一一对应、project 正确
  const files = MOD ? targets.map((t) => `${TYPE_DIR[t.type]}/${t.id}.spec.mjs`).filter(exists) : [];
  const list = (!MOD || files.length) ? playwrightList(files) : null;
  const covered = new Map();
  if (list) {
    for (const e of list.errors || []) err(`playwright 加载错误：${short(stripAnsi(e.message), 400)}`);
    for (const sp of collectSpecs(list.suites)) {
      const ids = scanIds(sp.title, SCAN.TC);
      const where = `${sp.file}:${sp.line}「${sp.title}」`;
      const fileId = path.basename(sp.file).replace(/\.spec\.m?js$/, '');
      if (!ids.length) { err(`测试 ${where} 的标题中没有 Case ID`); continue; }
      if (ids.length > 1 || ids[0] !== fileId) err(`测试 ${where} 属于 ${ids.join(',')}，但所在文件是 ${fileId}.spec.mjs（一个文件只能实现一个用例）`);
      if (!sp.title.trim().startsWith(ids[0])) err(`测试 ${where} 的标题必须以 Case ID 开头`);
      const tc = T.map.get(ids[0]);
      if (!tc) { err(`测试 ${where} 引用了未登记的 Case ID ${ids[0]}`); continue; }
      for (const t of sp.tests || []) if (t.projectName !== TYPE_TO_PROJECT[tc.type]) err(`${ids[0]}（${tc.type}）的测试应位于 project ${TYPE_TO_PROJECT[tc.type]}，实际在 ${t.projectName}`);
      covered.set(ids[0], (covered.get(ids[0]) || 0) + 1);
    }
    for (const t of targets) if (!covered.has(t.id) && exists(`${TYPE_DIR[t.type]}/${t.id}.spec.mjs`)) err(`用例 ${t.id} 的脚本中没有可执行的 test`);
  }
  R.stats.scripts = { casesAutomated: covered.size, casesInScope: targets.length };
  section = '';
  skillCheck('lint', MOD ? (MOD === 'E2E' ? ['--type=E2E'] : [`--module=${MOD}`]) : []);
  return { T };
}

// ------------------------------------------------------------------ 锁：测试防篡改

function lockFiles() {
  return LOCK_SCOPE.flatMap((p) => walk(p)).filter((f) => !f.includes('/explore/')).sort();
}
function computeDigest() {
  const files = {};
  for (const f of lockFiles()) files[f] = sha(fs.readFileSync(abs(f)));
  return { digest: sha(JSON.stringify(files)), files };
}
function doLock() {
  const { digest, files } = computeDigest();
  const snap = path.join(LOCK_DIR, 'snapshot');
  fs.rmSync(abs(snap), { recursive: true, force: true });
  for (const f of Object.keys(files)) {
    fs.mkdirSync(path.dirname(abs(path.join(snap, f))), { recursive: true });
    fs.copyFileSync(abs(f), abs(path.join(snap, f)));
  }
  fs.mkdirSync(abs(LOCK_DIR), { recursive: true });
  fs.writeFileSync(abs(path.join(LOCK_DIR, 'tests.lock.json')), JSON.stringify({ digest, files }, null, 2));
  R.digest = digest; R.stats.lockedFiles = Object.keys(files).length;
}
function diffAgainstLock() {
  const lock = readJson(path.join(LOCK_DIR, 'tests.lock.json'), false);
  const cur = computeDigest();
  R.digest = cur.digest;
  if (!lock) return { lock: null, cur, changed: [], added: [], removed: [] };
  const changed = Object.keys(cur.files).filter((f) => lock.files[f] && lock.files[f] !== cur.files[f]);
  const added = Object.keys(cur.files).filter((f) => !lock.files[f]);
  const removed = Object.keys(lock.files).filter((f) => !cur.files[f]);
  return { lock, cur, changed, added, removed };
}
function checkDigest() {
  section = 'lock';
  const d = diffAgainstLock();
  if (!d.lock) { warn('测试尚未锁定（.workflow/locks/tests.lock.json 不存在）'); section = ''; return; }
  const expect = opts['expect-digest'];
  if (expect && d.cur.digest !== expect) err(`测试摘要与编排方记录的不一致（期望 ${expect.slice(0, 12)}，实际 ${d.cur.digest.slice(0, 12)}）`);
  if (expect && d.lock.digest !== expect) err('锁文件本身被改动过（lock digest 与编排方记录的不一致）');
  for (const f of d.changed) err(`锁定后测试文件被修改：${f}`);
  for (const f of d.added) err(`锁定后新增了测试文件：${f}`);
  for (const f of d.removed) err(`锁定后删除了测试文件：${f}`);
  R.stats.tamper = { changed: d.changed, added: d.added, removed: d.removed };
  R.tampered = d.changed.length + d.added.length + d.removed.length > 0;
  section = '';
}
function doRestore() {
  const d = diffAgainstLock();
  if (!d.lock) { err('没有锁文件，无法还原'); return; }
  const only = opts.file ? new Set(String(opts.file).split(',')) : null;
  const snap = path.join(LOCK_DIR, 'snapshot');
  const restored = [];
  for (const f of [...d.changed, ...d.removed]) {
    if (only && !only.has(f)) continue;
    fs.mkdirSync(path.dirname(abs(f)), { recursive: true });
    fs.copyFileSync(abs(path.join(snap, f)), abs(f)); restored.push(f);
  }
  for (const f of d.added) {
    if (only && !only.has(f)) continue;
    const q = path.join(LOCK_DIR, 'quarantine', f);
    fs.mkdirSync(path.dirname(abs(q)), { recursive: true });
    fs.renameSync(abs(f), abs(q)); restored.push(`${f}（已移至 ${q}）`);
  }
  R.stats.restored = restored;
  R.digest = computeDigest().digest;
}

// ------------------------------------------------------------------ 阶段 5：骨架 + 代码

function checkManifest() {
  const man = readJson('extension/manifest.json');
  if (!man) return;
  if (man.manifest_version !== 3) err('manifest_version 必须为 3');
  for (const p of ['tabs', 'history', 'storage', 'activeTab']) if (!(man.permissions || []).includes(p)) err(`manifest 缺少权限 ${p}`);
  const sw = man.background?.service_worker;
  if (!sw) err('manifest 缺少 background.service_worker'); else if (!exists(`extension/${sw}`)) err(`service_worker 文件不存在：extension/${sw}`);
  const pop = man.action?.default_popup;
  if (!pop) err('manifest 缺少 action.default_popup'); else if (!exists(`extension/${pop}`)) err(`popup 文件不存在：extension/${pop}`);
  if (!(man.host_permissions || []).some((h) => /localhost|127\.0\.0\.1/.test(h))) err('manifest 的 host_permissions 未包含本地后端（localhost / 127.0.0.1）');
  for (const f of walk('extension', (x) => x.endsWith('.html'))) {
    const src = readText(f);
    for (const m of src.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (!/\bsrc\s*=/.test(m[1]) && m[2].trim()) err(`${f} 含有内联 <script>（违反 MV3 CSP）`);
      if (/\bsrc\s*=\s*["']https?:/i.test(m[1])) err(`${f} 加载了远程脚本（违反 MV3 规定）`);
    }
    if (/\son[a-z]+\s*=\s*["']/i.test(src)) err(`${f} 含有内联事件处理器 on*=（违反 MV3 CSP）`);
  }
}
function syntaxCheck(dirs) {
  const jsFiles = dirs.flatMap((d) => walk(d, (x) => /\.(m?js|cjs)$/.test(x)));
  for (const f of jsFiles) {
    const r = spawnSync(process.execPath, ['--check', abs(f)], { encoding: 'utf8' });
    if (r.status !== 0) err(`语法错误 ${f}：${stripAnsi(r.stderr).split('\n').slice(0, 4).join(' ')}`);
  }
  return jsFiles;
}

// 开发骨架（lead 交付）：能启动、/api/health 可用、SIGTERM 正常退出、插件 manifest 合法、规范机检通过
async function checkSkeleton() {
  section = 'skeleton';
  const doBE = !SIDE || SIDE === 'BE'; const doFE = !SIDE || SIDE === 'FE';
  syntaxCheck([doBE && 'server', doBE && 'scripts', doFE && 'extension'].filter(Boolean));
  if (doFE) { if (!exists('extension/manifest.json')) err('缺少 extension/manifest.json'); else checkManifest(); }
  if (doBE) {
    if (!exists('server/src/index.js')) err('缺少后端入口 server/src/index.js（BE-DIR-01）');
    else {
      const port = Number(opts.port || 4198);
      const logFile = abs(`.workflow/reports/skeleton-server-${port}.log`);
      try { fs.rmSync(logFile); } catch { /* 首次执行 */ }
      const child = spawn(process.execPath, [abs('server/src/index.js')], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ENABLE_TEST_API: '1', LOG_FILE: logFile }, stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = ''; child.stderr.on('data', (d) => { stderr += d; });
      let ok = false, status = 0;
      for (let i = 0; i < 30 && !ok; i++) {
        await new Promise((r) => setTimeout(r, 500));
        try { const res = await fetch(`http://127.0.0.1:${port}/api/health`); status = res.status; ok = res.ok; } catch { /* 还没起来 */ }
      }
      if (!ok) err(`后端启动后 15 秒内 /api/health 不可用（status=${status}）：${short(stripAnsi(stderr), 500)}`);
      const exited = new Promise((r) => child.once('exit', (code) => r(code)));
      child.kill('SIGTERM');
      const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r('timeout'), 5000))]);
      if (code === 'timeout') { err('后端收到 SIGTERM 后 5 秒内没有退出（BE-RUN-03）'); child.kill('SIGKILL'); }
      if (ok && (!fs.existsSync(logFile) || !fs.statSync(logFile).size)) err('设置 LOG_FILE 后没有写出日志（BE-LOG-02），evidence 会缺少 server.log');
    }
  }
  section = '';
  skillCheck('spec', [`--side=${SIDE ? SIDE.toLowerCase() : 'all'}`]);
}

function checkCode() {
  const { C, T } = checkCases();
  section = 'code';
  const doFE = !SIDE || SIDE === 'FE';
  if (doFE) checkManifest();
  const jsFiles = syntaxCheck(['server', 'extension', 'scripts']);
  if (!jsFiles.some((f) => f.startsWith('server/'))) err('server/ 下没有任何 JS 源码');
  if (!jsFiles.some((f) => f.startsWith('extension/'))) err('extension/ 下没有任何 JS 源码');
  // @code 注释追溯（模块 / 端模式下只要求本模块 / 本端的代码点已标注）
  const srcFiles = [...walk('server'), ...walk('extension'), ...walk('scripts')].filter((x) => /\.(m?js|cjs|html|css|sh)$/.test(x));
  const where = new Map();
  for (const f of srcFiles) {
    const src = readText(f);
    for (const m of src.matchAll(/@code\s+((?:C-(?:FE|BE)-[A-Z]{2,10}-\d{2}[\s,，、]*)+)/g)) {
      for (const id of m[1].match(SCAN.C) || []) { if (!where.has(id)) where.set(id, new Set()); where.get(id).add(f); }
    }
  }
  for (const id of where.keys()) if (!C.map.has(id)) err(`源码中的 @code ${id} 未在技术方案中登记（位于 ${[...where.get(id)].join(', ')}）`);
  const scoped = C.list.filter(inModCode);
  const missing = [];
  for (const c of scoped) {
    const files = where.get(c.id);
    if (!files) { missing.push(c.id); continue; }
    if (isStrArr(c.files) && !c.files.some((f) => files.has(f))) warn(`${c.id} 的 @code 标注位于 ${[...files].join(', ')}，不在方案登记的文件 ${c.files.join(', ')} 中（请同步更新 code-points 的 files）`);
  }
  for (const id of missing) err(`代码点 ${id} 在源码中没有 @code 标注（未实现或未标注）`);
  if (doFE) {
    const extSrc = walk('extension', (x) => /\.(html|m?js)$/.test(x)).map((f) => readText(f)).join('\n');
    const ui = readJson(PATHS.ui, false);
    for (const p of ui?.pages || []) for (const el of p.elements || []) {
      if (MOD && !(el.codePoints || []).some((cid) => C.map.get(cid)?.module === MOD)) continue;
      if (!new RegExp(`["'\`]${el.testId}["'\`]`).test(extSrc)) err(`ui-contract 中的 testId「${el.testId}」在 extension/ 源码中不存在`);
    }
  }
  const api = readJson(PATHS.api, false);
  const srvSrc = walk('server', (x) => /\.m?js$/.test(x)).map((f) => readText(f)).join('\n');
  for (const e of api?.endpoints || []) {
    const p = String(e.path || '').split('/:')[0];
    if (p && !srvSrc.includes(p)) warn(`api-contract 接口 ${e.method} ${e.path} 在 server/ 源码中找不到路径字符串`);
  }
  if (!exists('scripts/start.sh')) warn('缺少 scripts/start.sh');
  R.stats.code = { annotated: scoped.length - missing.length, codePoints: scoped.length, jsFiles: jsFiles.length };
  section = '';
  skillCheck('spec', [`--side=${SIDE ? SIDE.toLowerCase() : 'all'}`]);
  checkDigest();
  return { C, T };
}

// ------------------------------------------------------------------ 执行测试 + 证据完整性

async function loadRunCases() {
  if (!exists(RUN_CASES)) return null;
  try { return await import(pathToFileURL(abs(RUN_CASES)).href); } catch (e) { warn(`无法加载 ${RUN_CASES}（${e.message}），改用内置的证据检查`); return null; }
}
function builtinEvidence(c, runId) {
  const dir = `evidence/${c.id}`;
  const result = readJson(`${dir}/result.json`, false);
  const missing = [];
  if (!result) missing.push('result.json'); else if (runId && result.runId !== runId) missing.push('result.json 不是本次运行产生的');
  if (c.type !== 'UI' && !walk(`${dir}/api`).length) missing.push('api/');
  if (c.type === 'UI' && !walk(`${dir}/screenshots`, (f) => f.endsWith('.png')).length) missing.push('screenshots/');
  if (c.type === 'UI' && !exists(`${dir}/flow.gif`)) missing.push('flow.gif');
  if (!exists(`${dir}/server.log`)) missing.push('server.log');
  return { complete: !missing.length, missing };
}

async function runTests() {
  section = 'run';
  const T = loadCases();
  const port = String(opts.port || process.env.TEST_PORT || '4100');
  const runId = `${stage}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const out = `.workflow/reports/pw-results-${MOD || 'all'}${opts.project ? '-' + opts.project : ''}-${port}.json`;
  fs.mkdirSync(abs('.workflow/reports'), { recursive: true });
  try { fs.rmSync(abs(out)); } catch { /* 首次执行 */ }
  const args = ['playwright', 'test', '--reporter=json'];
  if (opts.project) for (const p of String(opts.project).split(',')) args.push(`--project=${p}`);
  if (MOD) args.push(...T.list.filter(inModCase).map((t) => `${TYPE_DIR[t.type]}/${t.id}.spec.mjs`).filter(exists));
  const r = spawnSync('npx', args, {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: Number(opts.timeout || 1500000),
    env: { ...process.env, TEST_PORT: port, CI: '1', FORCE_COLOR: '0', PLAYWRIGHT_JSON_OUTPUT_NAME: abs(out), EVIDENCE_RUN_ID: runId },
  });
  if (r.error) err(`执行 playwright 失败：${r.error.message}`);
  const rep = readJson(out, false);
  if (!rep) { err(`没有生成测试报告；stderr=${short(stripAnsi(r.stderr), 1500)}`); section = ''; return; }
  const globalErrors = (rep.errors || []).map((e) => short(stripAnsi(e.message || e.value || JSON.stringify(e)), 1200));
  const failures = []; const perCase = new Map();
  let total = 0, passed = 0, failed = 0, skipped = 0, flaky = 0;
  for (const sp of collectSpecs(rep.suites)) {
    const id = scanIds(sp.title, SCAN.TC)[0] || null;
    for (const t of sp.tests || []) {
      total++;
      const last = (t.results || [])[t.results.length - 1] || {};
      const st = t.status;
      if (st === 'expected') passed++; else if (st === 'skipped') skipped++; else if (st === 'flaky') flaky++; else failed++;
      const ok = st === 'expected';
      if (id) perCase.set(id, (perCase.get(id) ?? true) && ok);
      if (!ok) {
        const msg = stripAnsi((last.errors || []).map((e) => e.message).join('\n') || last.error?.message || st);
        failures.push({ caseId: id, module: id ? modOfCase(id) : null, project: t.projectName, file: `${sp.file}:${sp.line}`, status: st, error: msg.slice(0, 700), evidence: id ? `evidence/${id}/` : null });
      }
    }
  }
  const scope = T.list.filter(inModCase).filter((t) => !opts.project || String(opts.project).split(',').includes(TYPE_TO_PROJECT[t.type]));
  const missingCases = scope.filter((t) => !perCase.has(t.id)).map((t) => t.id);
  for (const g of globalErrors) err(`全局错误：${g}`);
  if (failed) err(`${failed} 个测试失败`);
  if (skipped) err(`${skipped} 个测试被跳过`);
  if (flaky) err(`${flaky} 个测试不稳定（flaky）`);
  if (missingCases.length) err(`${missingCases.length} 个用例没有被执行：${missingCases.slice(0, 20).join(', ')}${missingCases.length > 20 ? ' …' : ''}`);
  // 证据完整性（AGENTS.md 约定 3）：只检查本次执行过的用例
  const rc = await loadRunCases();
  const incomplete = [];
  for (const id of perCase.keys()) {
    const c = T.map.get(id);
    if (!c) continue;
    const st = rc?.evidenceStatus ? rc.evidenceStatus(ROOT, c, runId) : builtinEvidence(c, runId);
    if (!st.complete) incomplete.push({ caseId: id, missing: st.missing });
  }
  for (const x of incomplete.slice(0, 30)) err(`证据不完整 ${x.caseId}：${x.missing.join('；')}`);
  if (incomplete.length > 30) err(`另有 ${incomplete.length - 30} 个用例证据不完整`);
  if (rc?.buildEvidenceIndex) { try { rc.buildEvidenceIndex(ROOT); } catch (e) { warn(`生成 evidence/index.json 失败：${e.message}`); } }
  const status = Object.fromEntries([...perCase.entries()].map(([k, v]) => [k, v ? 'pass' : 'fail']));
  for (const id of missingCases) status[id] = 'not_run';
  if (!opts.project && !MOD) fs.writeFileSync(abs(PATHS.caseStatus), JSON.stringify(status, null, 2));
  R.run = { runId, total, passed, failed, skipped, flaky, casesTotal: scope.length, casesPassed: Object.values(status).filter((s) => s === 'pass').length, globalErrors, failures, missingCases, evidenceIncomplete: incomplete };
  R.stats.run = { total, passed, failed, skipped, flaky, evidenceIncomplete: incomplete.length };
  section = '';
}

// 断言有效性：调用 run-cases.mjs --mutation，对已通过的 API / E2E 用例做响应变异
function checkMutation() {
  section = 'mutation';
  if (!exists(RUN_CASES)) { err(`缺少 ${RUN_CASES}`); section = ''; return; }
  const args = [abs(RUN_CASES), '--all', '--mutation', '--no-lint', `--port=${opts.port || 4105}`, '--json'];
  if (opts['min-kill']) args.push(`--min-kill=${opts['min-kill']}`);
  const started = Date.now();
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 2400000 });
  const out = r.stdout || '';
  // 优先读 run-cases 写出的 mutation-latest.json（stdout 中 JSON 之后可能还有其他输出，不可靠）
  const mf = 'evidence/_runs/mutation-latest.json';
  let m = null;
  if (exists(mf) && fs.statSync(abs(mf)).mtimeMs >= started - 1000) m = readJson(mf, false);
  if (!m) { try { m = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1))?.steps?.mutation; } catch { /* 下面报错 */ } }
  if (!m) { err(`变异检查没有结果（exit ${r.status}）：${short(stripAnsi(r.stderr || out), 800)}`); section = ''; return; }
  if (m.skipped) warn(`变异检查跳过：${m.skipped}`);
  const survivors = (m.rows || []).filter((row) => row.baseline === 'pass' && (row.survived || []).length);
  // 准出口径是总杀死率（CONVENTIONS §6.5）；达标时存活变异只作为改进提示，不达标时列为错误，供补强 agent 处理
  for (const row of survivors.slice(0, m.pass === false ? 200 : 20)) (m.pass === false ? err : warn)(`${row.caseId} 存活变异：${row.survived.join(', ')}（补强对应的 [En] 断言）`);
  if (m.pass === false) err(`变异杀死率 ${m.killRate == null ? '-' : (m.killRate * 100).toFixed(1) + '%'} 低于阈值 ${((m.minKill || 0.8) * 100).toFixed(0)}%`);
  R.stats.mutation = { killRate: m.killRate, killed: m.killed, applicable: m.applicable, minKill: m.minKill };
  section = '';
}

// ------------------------------------------------------------------ UI 探索记录

function checkExplore() {
  section = 'explore';
  const T = loadCases();
  const ui = T.list.filter((t) => t.type === 'UI' && inModCase(t));
  const verdicts = {};
  for (const t of ui) {
    const rel = `evidence/${t.id}/explore.json`;
    const rec = readJson(rel, false);
    if (!rec) { err(`UI 用例 ${t.id} 没有探索记录 ${rel}`); continue; }
    if (rec.caseId !== t.id) err(`${rel} 中的 caseId 不匹配`);
    verdicts[t.id] = rec.verdict;
    if (rec.verdict !== 'pass') err(`UI 用例 ${t.id} 探索结论为 ${rec.verdict}：${short(rec.observed, 200)}`);
    if (!isStrArr(rec.screenshots)) err(`${rel} 缺少截图证据`);
    else for (const s of rec.screenshots) if (!exists(s)) err(`${rel} 引用的截图不存在：${s}`);
    if (!isStr(rec.observed)) err(`${rel} 缺少 observed（实际观察）`);
  }
  R.stats.explore = { uiCases: ui.length, recorded: Object.keys(verdicts).length, pass: Object.values(verdicts).filter((v) => v === 'pass').length };
  section = '';
}

// ------------------------------------------------------------------ 交付物

function checkDeliverables() {
  section = 'final';
  const readme = readText('README.md');
  if (readme) {
    const need = [['启动'], ['安装', '加载'], ['架构'], ['API', '接口'], ['数据模型'], ['评分'], ['规则解析', '规则'], ['诊断'], ['测试']];
    for (const alts of need) if (!alts.some((a) => readme.includes(a))) err(`README.md 缺少章节（关键词：${alts.join(' / ')}）`);
  }
  for (const s of ['scripts/start.sh', 'scripts/test.sh']) {
    if (!exists(s)) { err(`缺少 ${s}`); continue; }
    if (!(fs.statSync(abs(s)).mode & 0o111)) err(`${s} 没有可执行权限`);
  }
  const sample = readJson('resources/sample-history.json');
  if (sample && !Array.isArray(sample.history)) err('resources/sample-history.json 缺少 history 数组');
  if (!exists('docs/08-测试报告.md')) warn('缺少 docs/08-测试报告.md');
  else if (!/<!-- METRICS:BEGIN -->[\s\S]*<!-- METRICS:END -->/.test(readText('docs/08-测试报告.md'))) warn('docs/08-测试报告.md 中没有 METRICS 自动区块（按 nav-quality-report 技能用 collect-metrics.mjs --inject 生成）');
  section = '';
}

// ------------------------------------------------------------------ 上下文包：按模块切片，供各节点 agent 按需加载

function docLineRange(rel, ids) {
  const t = readText(rel, false);
  if (!t || !ids.length) return null;
  const hit = [];
  t.split('\n').forEach((l, i) => { if (ids.some((id) => l.includes(id))) hit.push(i + 1); });
  return hit.length ? `${rel} 第 ${hit[0]}–${hit[hit.length - 1]} 行（命中 ${hit.length} 行）` : null;
}
const compact = (v, n = 500) => short(typeof v === 'string' ? v : JSON.stringify(v), n);

function writePacks() {
  const F = loadFeatures(); const C = loadCodePoints(false); const T = loadCases(false);
  const api = readJson(PATHS.api, false); const ui = readJson(PATHS.ui, false);
  const status = readJson(PATHS.caseStatus, false) || {};
  const failures = opts.failures ? (readJson(String(opts.failures), false)?.run?.failures || []) : [];
  const owners = fileOwnership(C);
  const mods = uniq([...F.list.filter((f) => f.inScope).map((f) => f.module), ...C.list.map((c) => c.module)]).filter(Boolean).sort();
  if (T.list.some((t) => t.type === 'E2E')) mods.push('E2E');
  const index = [];
  for (const m of mods) {
    const feats = m === 'E2E' ? [] : F.list.filter((f) => f.module === m);
    const fids = new Set(feats.map((f) => f.id));
    const cps = m === 'E2E' ? [] : C.list.filter((c) => c.module === m || (c.features || []).some((x) => fids.has(x)));
    const cids = new Set(cps.map((c) => c.id));
    const cases = T.list.filter((t) => (m === 'E2E' ? t.type === 'E2E' : t.module === m && t.type !== 'E2E'));
    const deps = uniq(cases.flatMap((t) => t.codePoints || [])).filter((id) => !cids.has(id)).map((id) => C.map.get(id)).filter(Boolean);
    const eps = (api?.endpoints || []).filter((e) => (e.codePoints || []).some((x) => cids.has(x)) || (e.features || []).some((x) => fids.has(x)));
    const els = (ui?.pages || []).flatMap((p) => (p.elements || []).map((e) => ({ ...e, page: p.name }))).filter((e) => (e.codePoints || []).some((x) => cids.has(x)));
    const msgs = (ui?.messages || []).filter((x) => (x.codePoints || []).some((y) => cids.has(y)));
    const ownFiles = Object.entries(owners).filter(([, o]) => o.owner === m).map(([f]) => f);
    const sharedFiles = Object.entries(owners).filter(([, o]) => o.owner !== m && o.modules.includes(m)).map(([f, o]) => `${f}（${o.owner}）`);
    const fails = failures.filter((x) => (m === 'E2E' ? /^TC-E2E-/.test(x.caseId || '') : x.module === m && !/^TC-E2E-/.test(x.caseId || '')));
    const L = [`# 上下文包：${m}`, '', '> 由 `node .workflow/validators/validate.mjs pack` 生成，勿手改。只包含本模块需要的信息；需要原文时按「文档定位」读取对应行。', ''];
    if (feats.length) {
      L.push('## 1. Feature 与验收标准');
      for (const f of feats) { L.push(`- **${f.id}** ${f.name}［${(f.layers || []).join('+')}｜${f.priority}｜${f.inScope ? 'inScope' : '不在范围'}｜${f.kind}］`); for (const a of f.acceptance || []) L.push(`  - ${a}`); }
      L.push('');
    }
    if (cps.length) {
      L.push('## 2. 代码点');
      for (const c of cps) L.push(`- **${c.id}** ${c.name} — 文件：${(c.files || []).join(', ')}；符号：${(c.symbols || []).join(', ') || '-'}；Feature：${(c.features || []).join(', ')}${c.interfaces ? '；接口：' + c.interfaces.join(', ') : ''}`);
      L.push('');
    }
    if (ownFiles.length || sharedFiles.length) {
      L.push('## 3. 文件所有权（并行开发时只改「本模块文件」）');
      if (ownFiles.length) L.push(`- 本模块文件：${ownFiles.join(', ')}`);
      if (sharedFiles.length) L.push(`- 共享文件（括号内为负责模块；需要改动时写进 blockedBy 交给负责人）：${sharedFiles.join(', ')}`);
      L.push('');
    }
    if (eps.length) {
      L.push('## 4. 接口契约（api-contract 摘录）');
      for (const e of eps) L.push(`- **${e.method} ${e.path}**（${(e.codePoints || []).join(', ')}）`, `  - request：${compact(e.request)}`, `  - response：${compact(e.response)}`, ...(e.errors ? [`  - errors：${compact(e.errors, 300)}`] : []));
      L.push('');
    }
    if (els.length || msgs.length) {
      L.push('## 5. UI 契约（ui-contract 摘录）');
      for (const e of els) L.push(`- testId \`${e.testId}\`（${e.page}）：${short(e.description, 120)}［${(e.codePoints || []).join(', ')}］`);
      for (const x of msgs) L.push(`- 消息 \`${x.type}\`：request ${compact(x.request, 200)} → response ${compact(x.response, 200)}［${(x.codePoints || []).join(', ')}］`);
      L.push('');
    }
    if (cases.length) {
      L.push('## 6. 测试用例');
      for (const t of cases) {
        L.push(`- **${t.id}** ${t.title}［${t.type}｜${t.priority}｜${t.category || '-'}｜状态：${status[t.id] || '未执行'}］→ \`${TYPE_DIR[t.type]}/${t.id}.spec.mjs\`，证据 \`evidence/${t.id}/\``);
        for (const e of t.expected || []) L.push(`  - ${short(e, 200)}`);
      }
      L.push('');
    }
    if (deps.length) { L.push('## 7. 本模块用例依赖的其他代码点'); for (const c of deps) L.push(`- ${c.id} ${c.name}（${c.module}）— ${(c.files || []).join(', ')}`); L.push(''); }
    const refs = [
      docLineRange(PATHS.prd, [...fids]), docLineRange(PATHS.beDoc, cps.filter((c) => c.side === 'BE').map((c) => c.id)),
      docLineRange(PATHS.feDoc, cps.filter((c) => c.side === 'FE').map((c) => c.id)),
      docLineRange(PATHS.apiCasesDoc, cases.filter((t) => t.type !== 'UI').map((t) => t.id)), docLineRange(PATHS.uiCasesDoc, cases.filter((t) => t.type === 'UI').map((t) => t.id)),
    ].filter(Boolean);
    if (refs.length) { L.push('## 8. 文档定位（用 sed -n \'起,止p\' 读取，不要整篇读）'); for (const x of refs) L.push(`- ${x}`); L.push(''); }
    if (fails.length) {
      L.push(`## 9. 当前失败（${fails.length} 条，来自 ${opts.failures}）`);
      for (const x of fails) L.push(`- **${x.caseId || '-'}**［${x.project}］${x.file}：${short(x.error, 400)} → 证据 ${x.evidence || '-'}`);
      L.push('');
    }
    writeAtomic(`${PATHS.packs}/${m}.md`, L.join('\n') + '\n');
    index.push({ module: m, features: feats.length, codePoints: cps.length, cases: cases.length, ownFiles: ownFiles.length, failures: fails.length });
  }
  writeAtomic(`${PATHS.packs}/ownership.json`, JSON.stringify(owners, null, 2));
  writeAtomic(`${PATHS.packs}/index.json`, JSON.stringify(index, null, 2));
  R.stats.packs = index;
  R.modules = mods.filter((m) => m !== 'E2E' && F.list.some((f) => f.inScope && f.module === m));
  R.sharedModules = mods.filter((m) => m !== 'E2E' && !R.modules.includes(m));
}

// ------------------------------------------------------------------ q：按 ID 查追溯关系（给 agent 用的轻量检索，避免整篇读文档）

function query(key) {
  const F = loadFeatures(); const C = loadCodePoints(false); const T = loadCases(false);
  const status = readJson(PATHS.caseStatus, false) || {};
  const out = [];
  const caseLine = (t) => `${t.id} ${t.title}［${t.type}｜${status[t.id] || '未执行'}］ ${TYPE_DIR[t.type]}/${t.id}.spec.mjs`;
  if (RE.F.test(key)) {
    const f = F.map.get(key); if (!f) return `未找到 ${key}`;
    out.push(`${f.id} ${f.name}［${(f.layers || []).join('+')}｜${f.priority}｜inScope=${f.inScope}］`, `来源：${f.source}`, `描述：${f.description}`, ...(f.acceptance || []).map((a) => `  ${a}`));
    out.push('代码点：', ...C.list.filter((c) => (c.features || []).includes(key)).map((c) => `  ${c.id} ${c.name} — ${(c.files || []).join(', ')}`));
    out.push('用例：', ...T.list.filter((t) => (t.features || []).includes(key)).map((t) => `  ${caseLine(t)}`));
  } else if (RE.C.test(key)) {
    const c = C.map.get(key); if (!c) return `未找到 ${key}`;
    out.push(`${c.id} ${c.name}`, `描述：${c.description}`, `文件：${(c.files || []).join(', ')}；符号：${(c.symbols || []).join(', ')}`, `Feature：${(c.features || []).join(', ')}`);
    out.push('用例：', ...T.list.filter((t) => (t.codePoints || []).includes(key)).map((t) => `  ${caseLine(t)}`));
    const hits = [...walk('server'), ...walk('extension')].filter((f) => /\.(m?js|html)$/.test(f) && readText(f).includes(`@code ${key}`));
    out.push(`@code 标注位置：${hits.join(', ') || '（尚未标注）'}`);
  } else if (RE.TC.test(key)) {
    const t = T.map.get(key); if (!t) return `未找到 ${key}`;
    out.push(caseLine(t), `Feature：${(t.features || []).join(', ')}；AC：${(t.acceptanceRefs || []).join(', ')}；Code：${(t.codePoints || []).join(', ')}`, '前置：', ...(t.preconditions || []).map((x) => `  ${x}`), '步骤：', ...(t.steps || []).map((x) => `  ${x}`), '预期：', ...(t.expected || []).map((x) => `  ${x}`));
    const res = readJson(`evidence/${key}/result.json`, false);
    out.push(`证据：evidence/${key}/ ${res ? `（最近一次：${res.status || ''} runId=${res.runId || ''}）` : '（暂无）'}`);
  } else if (exists(`${PATHS.packs}/${key.toUpperCase()}.md`)) {
    return readText(`${PATHS.packs}/${key.toUpperCase()}.md`);
  } else return `无法识别：${key}（支持 F- / C- / TC- 开头的 ID，或已生成上下文包的模块名）`;
  return out.join('\n');
}

// ------------------------------------------------------------------ 追溯矩阵

function writeMatrix() {
  const F = loadFeatures(); const C = loadCodePoints(false); const T = loadCases(false);
  const status = readJson(PATHS.caseStatus, false) || {};
  const icon = (id) => ({ pass: '✅', fail: '❌', not_run: '⏸' }[status[id]] || '·');
  const lines = [
    '# 追溯矩阵（Feature ⇄ Code ⇄ Case）', '',
    '> 由 `.workflow/validators/validate.mjs trace` 自动生成，请勿手改。✅ 通过 ❌ 失败 ⏸ 未执行 · 尚无执行结果', '',
    '| Feature ID | 名称 | 优先级 | 端 | C-FE | C-BE | 用例 | 覆盖 |', '|---|---|---|---|---|---|---|---|',
  ];
  let ok = 0, scope = 0;
  for (const f of F.list) {
    const cps = C.list.filter((c) => (c.features || []).includes(f.id));
    const cs = T.list.filter((t) => (t.features || []).includes(f.id));
    const fe = cps.filter((c) => c.side === 'FE').map((c) => c.id); const be = cps.filter((c) => c.side === 'BE').map((c) => c.id);
    const layers = f.layers || [];
    const covered = (!layers.includes('FE') || (fe.length && cs.some((t) => t.type === 'UI'))) && (!layers.includes('BE') || (be.length && cs.some((t) => t.type !== 'UI')));
    const allPass = cs.length && cs.every((t) => status[t.id] === 'pass');
    if (f.inScope) { scope++; if (covered) ok++; }
    const cov = !f.inScope ? '不在范围' : !covered ? '❌ 缺失' : allPass ? '✅ 已验证' : '🟡 已覆盖';
    lines.push(`| ${f.id} | ${f.name} | ${f.priority} | ${layers.join('+')} | ${fe.join('<br>') || '—'} | ${be.join('<br>') || '—'} | ${cs.map((t) => `${icon(t.id)} [${t.id}](../../evidence/${t.id}/)`).join('<br>') || '—'} | ${cov} |`);
  }
  lines.push('', `**覆盖率**：${ok}/${scope} 个 inScope Feature 满足「代码点 + 用例」双覆盖。`, '');
  const reqs = readJson(PATHS.requirements, false)?.requirements || [];
  if (reqs.length) {
    const need = reqs.filter((q) => q.mandatory && q.inScope);
    const miss = need.filter((q) => !(q.features || []).some((fid) => F.map.get(fid)?.inScope));
    lines.push(`**需求点覆盖**：${need.length - miss.length}/${need.length} 个 mandatory 且 inScope 的 REQ 已映射到 inScope Feature${miss.length ? `；未映射：${miss.map((q) => q.id).join(', ')}` : ''}。`, '');
    R.stats.matrix = { ...(R.stats.matrix || {}), reqMandatory: need.length, reqCovered: need.length - miss.length };
  }
  lines.push('## 代码点 → 用例', '', '| Code ID | 名称 | Feature | 用例 |', '|---|---|---|---|');
  for (const c of C.list) {
    const cs = T.list.filter((t) => (t.codePoints || []).includes(c.id));
    lines.push(`| ${c.id} | ${c.name} | ${(c.features || []).join(', ')} | ${cs.map((t) => `${icon(t.id)} ${t.id}`).join(', ') || '—'} |`);
  }
  writeAtomic(PATHS.matrix, lines.join('\n') + '\n');
  R.stats.matrix = { ...(R.stats.matrix || {}), file: PATHS.matrix, inScope: scope, covered: ok };
}

// ------------------------------------------------------------------ 主流程

const handlers = {
  prd: () => { checkPrd(); skillCheck('req'); },
  design: () => checkDesign(),
  'merge-cases': () => { if (!mergeCases()) warn('没有找到用例分片（docs/trace/cases/*.json）'); },
  cases: () => { checkCases(); writeMatrix(); },
  infra: () => checkInfra(),
  scripts: () => checkScripts(),
  skeleton: () => checkSkeleton(),
  code: () => checkCode(),
  run: async () => { await runTests(); writeMatrix(); },
  gate: async () => { checkCode(); await runTests(); writeMatrix(); },
  mutation: () => checkMutation(),
  explore: () => checkExplore(),
  final: async () => { checkScripts(); checkCode(); await runTests(); checkExplore(); checkDeliverables(); writeMatrix(); },
  pack: () => writePacks(),
  trace: () => writeMatrix(),
  lock: () => doLock(),
  digest: () => checkDigest(),
  restore: () => doRestore(),
};

if (stage === 'q') { console.log(query(String(positional[0] || ''))); process.exit(0); }
if (!handlers[stage]) {
  console.log(`用法：node .workflow/validators/validate.mjs <${[...Object.keys(handlers), 'q'].join('|')}> [--module=] [--side=] [--expect-digest=] [--project=] [--port=] [--file=] [--failures=] [--brief]`);
  process.exit(2);
}
try { await handlers[stage](); } catch (e) { R.errors.push(`validator 自身异常：${e.stack || e.message}`); }
try { if (!R.modules && exists(PATHS.features)) listModules(); } catch { /* 早期阶段 */ }
R.pass = R.errors.length === 0;
if (!R.digest && ['code', 'gate', 'final', 'scripts'].includes(stage)) { try { R.digest = computeDigest().digest; } catch { /* 还没有测试 */ } }
const reportName = MOD ? `${stage}-${MOD}` : stage;
fs.mkdirSync(abs('.workflow/reports'), { recursive: true });
fs.writeFileSync(abs(`.workflow/reports/validate-${reportName}.json`), JSON.stringify(R, null, 2));
if (opts.brief) {
  const b = { stage, module: MOD, pass: R.pass, errors: R.errors.length, warnings: R.warnings.length, report: `.workflow/reports/validate-${reportName}.json`, topErrors: R.errors.slice(0, 15).map((e) => short(e, 240)) };
  if (R.run) Object.assign(b, { tests: `${R.run.passed}/${R.run.total}`, failing: R.run.failures.map((f) => `${f.caseId || '-'} ${short(f.error, 160)}`).slice(0, 25), evidenceIncomplete: R.run.evidenceIncomplete.length });
  console.log(JSON.stringify(b, null, 2));
} else console.log(JSON.stringify(R, null, 2));
process.exit(R.pass ? 0 : 1);
