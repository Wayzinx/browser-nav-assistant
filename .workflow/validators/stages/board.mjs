// 跨角色看板：docs/trace/board/<ID>.json，一条记录一个文件（并行 agent 各写各的文件，互不冲突）。
// 用途：任何角色发现需要别的角色澄清或修改的问题（接口定义不清、契约冲突、用例无法自动化……），
// 都写成看板记录，由 workflow 按 to 路由给负责人；负责人修订后回填 status / resolution / changedFiles。
// 格式说明见 docs/trace/board/README.md。

export const BOARD_DIR = 'docs/trace/board';
export const BOARD_STAGES = ['prd', 'design', 'cases', 'align', 'scripts', 'dev', 'final'];
export const BOARD_ROLES = ['PM', 'BE', 'FE', 'ARCH', 'TEST', 'AUTO', 'DEV-BE', 'DEV-FE', 'HUMAN'];
export const BOARD_TYPES = ['clarify', 'change', 'conflict', 'blocker'];
export const BOARD_STATUSES = ['open', 'answered', 'accepted', 'rejected', 'wontfix'];
const ID_RE = /^B-[A-Z0-9-]+$/;
const AC_REF = /^(F-[A-Z]{2,10}-\d{2})#AC(\d+)$/;
const REQ_RE = /^REQ-\d{3}$/;

/** 读取全部看板记录（不做校验） */
export function loadBoard(ctx) {
  const files = ctx.walk(BOARD_DIR, (f) => f.endsWith('.json'));
  const items = [];
  for (const f of files) {
    let j = null;
    try { j = JSON.parse(ctx.readText(f, false) || 'null'); } catch (e) { items.push({ __file: f, __parseError: e.message }); continue; }
    if (j && typeof j === 'object') items.push({ ...j, __file: f });
    else items.push({ __file: f, __parseError: '不是 JSON 对象' });
  }
  return items;
}

/** AC 编号集合：features.json 中 acceptance 的「AC<n>：」前缀（没有前缀时按顺序编号） */
function acIndex(F) {
  const m = new Map();
  for (const f of F.list) {
    const set = new Set();
    (f.acceptance || []).forEach((a, i) => { const x = /^AC(\d+)/.exec(String(a)); set.add(Number(x ? x[1] : i + 1)); });
    m.set(f.id, set);
  }
  return m;
}

/** 校验一条引用（F / C / TC / REQ / AC）是否真实存在；返回错误描述或 null */
export function refProblem(ref, idx) {
  const s = String(ref || '').trim();
  if (!s) return '空引用';
  const ac = AC_REF.exec(s);
  if (ac) {
    if (!idx.features.has(ac[1])) return `引用的 Feature ${ac[1]} 不存在`;
    if (!idx.acs.get(ac[1])?.has(Number(ac[2]))) return `引用的验收标准 ${s} 不存在`;
    return null;
  }
  if (/^F-[A-Z]{2,10}-\d{2}$/.test(s)) return idx.features.has(s) ? null : `引用的 Feature ${s} 不存在`;
  if (/^C-(?:FE|BE)-[A-Z]{2,10}-\d{2}$/.test(s)) return idx.codes.has(s) ? null : `引用的代码点 ${s} 不存在`;
  if (/^TC-(?:API|E2E|UI)-[A-Z]{2,10}-\d{3}$/.test(s)) return idx.cases.has(s) ? null : `引用的用例 ${s} 不存在`;
  if (REQ_RE.test(s)) return idx.reqs.has(s) ? null : `引用的需求点 ${s} 不存在`;
  return `无法识别的引用「${s}」（只能是 F- / C- / TC- / REQ- / F-XXX-NN#ACn）`;
}

export function buildIndex(ctx) {
  const F = ctx.loadFeatures(false);
  const C = ctx.loadCodePoints(false);
  const T = ctx.loadCases(false);
  const reqs = ctx.readJson(ctx.PATHS.requirements, false)?.requirements || [];
  return { F, C, T, features: new Set(F.map.keys()), codes: new Set(C.map.keys()), cases: new Set(T.map.keys()), reqs: new Set(reqs.map((r) => r.id)), acs: acIndex(F) };
}

/**
 * 校验看板，并把待处理记录写入 R.board（供 workflow 路由）。
 * @param {object} ctx validator 上下文
 * @param {{ freeze?: string, report?: (msg: string) => void, quiet?: boolean }} [o]
 *   freeze：该阶段及之前所有 blocking=true 且 status=open 的记录报 error；report：自定义 error 输出（align 用）
 */
export function checkBoard(ctx, { freeze, report } = {}) {
  const E = report || ((m) => ctx.err(m));
  const items = loadBoard(ctx);
  const idx = buildIndex(ctx);
  const seen = new Map();
  let schemaErrors = 0;
  const bad = (it, msg) => { schemaErrors++; E(`${it.__file}：${msg}`); };
  for (const it of items) {
    if (it.__parseError) { bad(it, `不是合法 JSON：${it.__parseError}`); continue; }
    const stem = it.__file.split('/').pop().replace(/\.json$/, '');
    if (!ID_RE.test(stem)) bad(it, `文件名必须是 B-[A-Z0-9-]+.json（当前 ${stem}）`);
    if (it.id !== stem) bad(it, `id(${it.id}) 必须与文件名(${stem}) 一致`);
    if (seen.has(it.id)) bad(it, `id 重复（另见 ${seen.get(it.id)}）`); seen.set(it.id, it.__file);
    if (!BOARD_STAGES.includes(it.stage)) bad(it, `stage 非法(${it.stage})，可选 ${BOARD_STAGES.join(' / ')}`);
    if (!BOARD_ROLES.includes(it.from)) bad(it, `from 非法(${it.from})，可选 ${BOARD_ROLES.join(' / ')}`);
    if (!BOARD_ROLES.includes(it.to)) bad(it, `to 非法(${it.to})，可选 ${BOARD_ROLES.join(' / ')}`);
    if (!BOARD_TYPES.includes(it.type)) bad(it, `type 非法(${it.type})，可选 ${BOARD_TYPES.join(' / ')}`);
    if (typeof it.blocking !== 'boolean') bad(it, 'blocking 必须是布尔值');
    if (!ctx.isStr(it.target)) bad(it, '缺少 target（文件#锚点或 ID）');
    if (!ctx.isStr(it.question)) bad(it, '缺少 question');
    if (!ctx.isStr(it.createdBy)) bad(it, '缺少 createdBy（提出方的任务键，例如 case-API-RULE#1）');
    if (it.refs != null && !Array.isArray(it.refs)) bad(it, 'refs 必须是数组');
    for (const r of it.refs || []) { const p = refProblem(r, idx); if (p) bad(it, p); }
    if (!BOARD_STATUSES.includes(it.status)) bad(it, `status 非法(${it.status})，可选 ${BOARD_STATUSES.join(' / ')}`);
    if (it.status && it.status !== 'open') {
      if (!ctx.isStr(it.resolution)) bad(it, `status=${it.status} 时必须填写 resolution`);
      if (!ctx.isStr(it.resolvedBy)) bad(it, `status=${it.status} 时必须填写 resolvedBy`);
    }
    if (it.changedFiles != null && !Array.isArray(it.changedFiles)) bad(it, 'changedFiles 必须是数组');
    for (const f of it.changedFiles || []) if (!ctx.exists(String(f).split('#')[0])) bad(it, `changedFiles 中的文件不存在：${f}`);
  }
  const valid = items.filter((it) => !it.__parseError);
  const open = valid.filter((it) => it.status === 'open');
  let frozenBlockers = 0;
  if (freeze) {
    const lim = BOARD_STAGES.indexOf(freeze);
    if (lim < 0) E(`--freeze 的阶段非法(${freeze})，可选 ${BOARD_STAGES.join(' / ')}`);
    for (const it of open) {
      if (it.blocking === true && BOARD_STAGES.indexOf(it.stage) <= lim) {
        frozenBlockers++;
        E(`${it.id}：阻塞项未关闭（stage=${it.stage}，${it.from} → ${it.to}，target=${it.target}）：${ctx.short(it.question, 160)}`);
      }
    }
  }
  const countBy = (k) => valid.reduce((m, it) => { const v = it[k] ?? '-'; m[v] = (m[v] || 0) + 1; return m; }, {});
  const counts = {
    total: valid.length, open: open.length, blockingOpen: open.filter((it) => it.blocking === true).length,
    byStatus: countBy('status'), byTo: open.reduce((m, it) => { m[it.to] = (m[it.to] || 0) + 1; return m; }, {}),
    schemaErrors, frozenBlockers,
  };
  ctx.R.board = {
    dir: BOARD_DIR,
    freeze: freeze || null,
    open: open.map((it) => ({ id: it.id, to: it.to, from: it.from, blocking: it.blocking === true, stage: it.stage, type: it.type, target: it.target, question: it.question })),
    counts,
  };
  ctx.R.stats.board = counts;
  return { items: valid, open, counts };
}
