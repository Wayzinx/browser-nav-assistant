// 基线冻结：对齐评审通过后记录上游产物的指纹（--record=<name>）；之后每次 --check 都与最新基线比较，
// 列出变化的文件和 ID、受影响的下游用例与脚本。每一处变化都必须有 status=accepted、type=change 的看板记录覆盖，
// 否则视为「未经变更请求的基线修改」。
import { loadBoard } from './board.mjs';
import { MODULES_FILE } from './modules.mjs';

export const BASELINE_DIR = '.workflow/baseline';
const ENDPOINT_RE = /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/api\/[A-Za-z0-9_\-\/:{}<>$.]*)/g;

function upstreamFiles(ctx) {
  const P = ctx.PATHS;
  return [P.prd, P.requirements, P.features, P.api, P.ui, P.beCp, P.feCp, MODULES_FILE, P.apiCases, P.uiCases];
}

const h = (ctx, v) => ctx.sha(JSON.stringify(v ?? null)).slice(0, 16);
const acKey = (fid, a, i) => { const m = /^AC(\d+)/.exec(String(a)); return `${fid}#AC${m ? m[1] : i + 1}`; };

/** 计算全部指纹：files（文件级）+ items（ID 级，按类型分组） */
function fingerprint(ctx) {
  const files = {};
  for (const f of upstreamFiles(ctx)) if (ctx.exists(f)) files[f] = ctx.sha(ctx.readText(f, false));
  const F = ctx.loadFeatures(false); const C = ctx.loadCodePoints(false); const T = ctx.loadCases(false);
  const api = ctx.readJson(ctx.PATHS.api, false); const ui = ctx.readJson(ctx.PATHS.ui, false);
  const reqs = ctx.readJson(ctx.PATHS.requirements, false)?.requirements || [];
  const mods = ctx.readJson(MODULES_FILE, false)?.modules || [];
  const items = { feature: {}, ac: {}, requirement: {}, endpoint: {}, codePoint: {}, testId: {}, message: {}, storageKey: {}, module: {}, case: {} };
  for (const f of F.list) {
    items.feature[f.id] = h(ctx, { name: f.name, kind: f.kind, layers: f.layers, priority: f.priority, inScope: f.inScope });
    (f.acceptance || []).forEach((a, i) => { items.ac[acKey(f.id, a, i)] = h(ctx, a); });
  }
  for (const r of reqs) items.requirement[r.id] = h(ctx, { quote: r.quote, mandatory: r.mandatory, inScope: r.inScope, features: r.features });
  for (const e of api?.endpoints || []) {
    const k = ctx.normEndpoint(`${String(e.method || '').toUpperCase()} ${e.path || ''}`);
    items.endpoint[`${k}.request`] = h(ctx, { request: e.request, query: e.query, params: e.params });
    items.endpoint[`${k}.response`] = h(ctx, e.response);
    items.endpoint[`${k}.errors`] = h(ctx, e.errors);
  }
  if (api?.common) items.endpoint['common'] = h(ctx, api.common);
  for (const c of C.list) items.codePoint[c.id] = h(ctx, { files: c.files, symbols: c.symbols, features: c.features, interfaces: c.interfaces });
  for (const p of ui?.pages || []) for (const el of p.elements || []) items.testId[el.testId] = h(ctx, { page: p.name, codePoints: el.codePoints });
  for (const m of ui?.messages || []) items.message[m.type] = h(ctx, { request: m.request, response: m.response });
  for (const s of ui?.storageKeys || []) items.storageKey[s.key] = h(ctx, s.description);
  for (const m of mods) items.module[m.id] = h(ctx, { sides: m.sides, dependsOn: m.dependsOn });
  for (const t of T.list) items.case[t.id] = h(ctx, { steps: t.steps, expected: t.expected, preconditions: t.preconditions, features: t.features, acceptanceRefs: t.acceptanceRefs, codePoints: t.codePoints });
  return { files, items };
}

const FILE_OF = (ctx) => ({
  feature: ctx.PATHS.features, ac: ctx.PATHS.features, requirement: ctx.PATHS.requirements, endpoint: ctx.PATHS.api,
  codePoint: 'docs/trace/code-points-*.json', testId: ctx.PATHS.ui, message: ctx.PATHS.ui, storageKey: ctx.PATHS.ui,
  module: MODULES_FILE, case: 'docs/trace/cases-*.json',
});

export function recordBaseline(ctx, name) {
  if (!ctx.isStr(name) || !/^[A-Za-z0-9._-]+$/.test(name)) { ctx.err('baseline --record 需要一个名称，例如 --record=align-1（字母、数字、. _ -）'); return; }
  const fp = fingerprint(ctx);
  const rel = `${BASELINE_DIR}/${name}.json`;
  ctx.writeAtomic(rel, JSON.stringify({ name, recordedAt: new Date().toISOString(), ...fp }, null, 2));
  ctx.R.baseline = { name, file: rel, files: Object.keys(fp.files).length, items: Object.fromEntries(Object.entries(fp.items).map(([k, v]) => [k, Object.keys(v).length])) };
}

function latestBaseline(ctx, name) {
  if (name) return ctx.readJson(`${BASELINE_DIR}/${name}.json`, false);
  const all = ctx.walk(BASELINE_DIR, (f) => f.endsWith('.json')).map((f) => ctx.readJson(f, false)).filter(Boolean);
  all.sort((a, b) => String(a.recordedAt).localeCompare(String(b.recordedAt)));
  return all[all.length - 1] || null;
}

/** 看板中 status=accepted、type=change 的记录给出的「覆盖令牌」：refs、target、target 的文件部分和锚点部分 */
function approvals(ctx) {
  const tokens = [];
  for (const it of loadBoard(ctx)) {
    if (it.__parseError || it.status !== 'accepted' || it.type !== 'change') continue;
    const t = String(it.target || '');
    const [file, anchor] = t.split('#');
    tokens.push({ id: it.id, refs: (it.refs || []).map(String), target: t, file, anchor: anchor || null });
  }
  return tokens;
}

function covered(change, approvalsList) {
  for (const a of approvalsList) {
    // 1. 精确引用 ID（或 ID 的前缀，例如 F-SYNC-01 覆盖 F-SYNC-01#AC2；POST /api/rules 覆盖 POST /api/rules.errors）
    for (const tok of [...a.refs, a.anchor].filter(Boolean)) {
      if (change.key === tok || change.key.startsWith(tok + '#') || change.key.startsWith(tok + '.')) return a.id;
    }
    // 2. target 只写文件、不带锚点：视为批准对整个文件的修改
    if (!a.anchor && a.file && (a.file === change.file || (change.file.includes('*') && new RegExp('^' + change.file.replace(/[.]/g, '\\.').replace('*', '.*') + '$').test(a.file)))) return a.id;
    if (change.kind === 'file' && a.file === change.key) return a.id;
  }
  return null;
}

export function checkBaseline(ctx, name) {
  const base = latestBaseline(ctx, name);
  if (!base) { ctx.warn(`尚未记录基线（${BASELINE_DIR}/ 为空）：对齐评审通过后运行 baseline --record=<name>`); ctx.R.baseline = { name: null, changes: [], impacted: { cases: [], scripts: [] }, uncovered: [] }; return; }
  const cur = fingerprint(ctx);
  const fileOf = FILE_OF(ctx);
  const changes = [];
  const changedFiles = Object.keys({ ...base.files, ...cur.files }).filter((f) => base.files[f] !== cur.files[f]);
  for (const kind of Object.keys(cur.items)) {
    const a = base.items?.[kind] || {}; const b = cur.items[kind];
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (a[k] === b[k]) continue;
      changes.push({ kind, key: k, change: !(k in a) ? 'added' : !(k in b) ? 'removed' : 'changed', file: fileOf[kind] });
    }
  }
  // 文件变了但没有任何 ID 级变化（例如 PRD 正文、契约注释）：按文件级变化处理
  for (const f of changedFiles) {
    const kinds = Object.entries(fileOf).filter(([, v]) => v === f || (v.includes('*') && new RegExp('^' + v.replace(/[.]/g, '\\.').replace('*', '.*') + '$').test(f))).map(([k]) => k);
    if (!changes.some((c) => kinds.includes(c.kind))) changes.push({ kind: 'file', key: f, change: base.files[f] ? (cur.files[f] ? 'changed' : 'removed') : 'added', file: f });
  }
  // 受影响的下游：引用变化的 Feature / AC / 代码点 / 接口 / testId / 消息的用例，以及这些用例的脚本
  const T = ctx.loadCases(false);
  const hit = new Set();
  const changedKeys = new Set(changes.map((c) => c.key));
  const changedFeatures = new Set(changes.filter((c) => c.kind === 'feature').map((c) => c.key));
  const changedAcs = new Set(changes.filter((c) => c.kind === 'ac').map((c) => c.key));
  const changedCps = new Set(changes.filter((c) => c.kind === 'codePoint').map((c) => c.key));
  const changedEps = new Set(changes.filter((c) => c.kind === 'endpoint').map((c) => c.key.replace(/\.(request|response|errors)$/, '')));
  const changedUi = changes.filter((c) => ['testId', 'message', 'storageKey'].includes(c.kind)).map((c) => c.key);
  for (const t of T.list) {
    const text = [...(t.steps || []), ...(t.expected || []), ...(t.preconditions || []), t.testData || ''].join('\n');
    const eps = new Set([...text.matchAll(ENDPOINT_RE)].map((m) => ctx.normEndpoint(`${m[1]} ${m[2].replace(/<[^>]*>|\$\{[^}]*\}/g, ':id')}`)));
    if (changedKeys.has(t.id) || (t.features || []).some((f) => changedFeatures.has(f)) || (t.acceptanceRefs || []).some((a) => changedAcs.has(a))
      || (t.codePoints || []).some((c) => changedCps.has(c)) || [...eps].some((e) => changedEps.has(e)) || changedUi.some((k) => text.includes(k))) hit.add(t.id);
  }
  const typeDir = { API: 'tests/api', E2E: 'tests/e2e', UI: 'tests/ui' };
  const impactedCases = [...hit].sort();
  const scripts = impactedCases.map((id) => { const t = T.map.get(id); return t ? `${typeDir[t.type]}/${id}.spec.mjs` : null; }).filter((f) => f && ctx.exists(f));
  const ap = approvals(ctx);
  const uncovered = [];
  for (const c of changes) {
    const by = covered(c, ap);
    if (by) c.approvedBy = by; else uncovered.push(c);
  }
  for (const c of uncovered.slice(0, 80)) ctx.err(`${c.file} ${c.kind} ${c.key} ${c.change}：未经变更请求的基线修改（需要一条 status=accepted、type=change 的看板记录，refs 或 target 覆盖它）`);
  if (uncovered.length > 80) ctx.err(`另有 ${uncovered.length - 80} 处未经变更请求的基线修改`);
  ctx.R.baseline = { name: base.name, recordedAt: base.recordedAt, changedFiles, changes, impacted: { cases: impactedCases, scripts }, uncovered: uncovered.map((c) => `${c.kind}:${c.key}`) };
  ctx.R.stats.baseline = { name: base.name, changedFiles: changedFiles.length, changes: changes.length, uncovered: uncovered.length, impactedCases: impactedCases.length, impactedScripts: scripts.length };
}
