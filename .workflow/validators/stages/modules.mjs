// 模块依赖：docs/trace/modules.json（后端架构师维护）。workflow 按 stats.layers 的拓扑分层顺序开发，
// 避免下游模块在上游未就绪时大面积失败（v2 运行时第 1 轮 126 条失败都是同步功能尚未实现导致的）。
// 格式：{ "modules": [{ "id": "SYNC", "sides": ["BE","FE"], "dependsOn": ["CORE"], "reasons": { "CORE": "依据……" } }] }
// dependsOn 的含义：「本模块的用例要能转绿，必须先完成的模块」（测试数据依赖为主）；
// 源码 import 依赖由 lead 骨架提供的占位文件满足，不作为排期依据。

export const MODULES_FILE = 'docs/trace/modules.json';

/**
 * 校验 modules.json 并计算拓扑分层，写入 R.stats.layers（二维数组，元素为模块 id）。
 * @param {object} ctx validator 上下文
 * @param {{ required?: boolean }} [o] required=true 时文件缺失报 error，否则报 warning
 * @returns {string[][] | null}
 */
export function checkModules(ctx, { required = true } = {}) {
  const j = ctx.readJson(MODULES_FILE, false);
  if (!j) {
    (required ? ctx.err : ctx.warn)(`缺少 ${MODULES_FILE}（模块依赖，后端架构师负责；workflow 按它的拓扑分层顺序开发）`);
    return null;
  }
  if (!Array.isArray(j.modules) || !j.modules.length) { ctx.err(`${MODULES_FILE} 缺少 modules 数组`); return null; }
  const F = ctx.loadFeatures(false);
  const C = ctx.loadCodePoints(false);
  const inScopeMods = new Set(F.list.filter((f) => f.inScope).map((f) => f.module));
  const knownMods = new Set([...F.list.map((f) => f.module), ...C.list.map((c) => c.module)]);
  const byId = new Map();
  for (const m of j.modules) {
    if (!ctx.isStr(m?.id) || !/^[A-Z]{2,10}$/.test(m.id)) { ctx.err(`${MODULES_FILE} 中有非法模块 id：${JSON.stringify(m?.id)}`); continue; }
    if (byId.has(m.id)) ctx.err(`${MODULES_FILE} 中模块 ${m.id} 重复`);
    byId.set(m.id, m);
    if (!Array.isArray(m.sides) || !m.sides.length || !m.sides.every((s) => s === 'BE' || s === 'FE')) ctx.err(`模块 ${m.id} 的 sides 必须是 ["BE"] / ["FE"] / ["BE","FE"]`);
    if (!Array.isArray(m.dependsOn)) ctx.err(`模块 ${m.id} 的 dependsOn 必须是数组`);
    if (!knownMods.has(m.id) && m.id !== 'CORE') ctx.warn(`模块 ${m.id} 在 features / code-points 中都不存在`);
    const sidesInCode = new Set(C.list.filter((c) => c.module === m.id).map((c) => c.side));
    for (const s of sidesInCode) if (Array.isArray(m.sides) && !m.sides.includes(s)) ctx.warn(`模块 ${m.id} 有 C-${s} 代码点，但 sides 中没有 ${s}`);
  }
  for (const mod of inScopeMods) if (!byId.has(mod)) ctx.err(`${MODULES_FILE} 缺少 inScope 模块 ${mod}`);
  for (const m of byId.values()) {
    for (const d of m.dependsOn || []) {
      if (d === m.id) ctx.err(`模块 ${m.id} 不能依赖自己`);
      else if (!byId.has(d)) ctx.err(`模块 ${m.id} 依赖的 ${d} 不在 ${MODULES_FILE} 中`);
      if (!ctx.isStr(m.reasons?.[d])) ctx.warn(`模块 ${m.id} 对 ${d} 的依赖没有在 reasons 中写明依据`);
    }
  }
  // 环检测（DFS），报出一条完整的环路径
  const state = new Map(); const stack = [];
  let cycle = null;
  const dfs = (id) => {
    if (cycle) return;
    state.set(id, 1); stack.push(id);
    for (const d of byId.get(id)?.dependsOn || []) {
      if (!byId.has(d)) continue;
      if (state.get(d) === 1) { cycle = [...stack.slice(stack.indexOf(d)), d]; return; }
      if (!state.get(d)) dfs(d);
      if (cycle) return;
    }
    stack.pop(); state.set(id, 2);
  };
  for (const id of byId.keys()) if (!state.get(id)) dfs(id);
  if (cycle) { ctx.err(`${MODULES_FILE} 存在依赖环：${cycle.join(' → ')}`); return null; }
  // Kahn 分层：同一层内的模块可以并行开发
  const layers = [];
  const done = new Set();
  let rest = [...byId.keys()];
  while (rest.length) {
    const layer = rest.filter((id) => (byId.get(id).dependsOn || []).filter((d) => byId.has(d)).every((d) => done.has(d))).sort();
    if (!layer.length) break;
    layers.push(layer);
    layer.forEach((id) => done.add(id));
    rest = rest.filter((id) => !done.has(id));
  }
  ctx.R.stats.layers = layers;
  ctx.R.stats.modules = { total: byId.size, inScope: [...inScopeMods].sort(), layerCount: layers.length };
  return layers;
}
