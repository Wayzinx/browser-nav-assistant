import { log } from '../../shared/logger.js';

const pendingByContext = new WeakMap();

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function activeView(render) {
  try { return !render.isActive || render.isActive(); }
  catch { log('popup.cache-consumer-failed', { phase: 'active' }, 'warn'); return false; }
}

function hasView(pair) {
  return [...pair.views.keys()].some(activeView);
}

function replay(pair, render) {
  const view = pair.views.get(render);
  while (view.next < pair.stages.length) {
    const stage = pair.stages[view.next++];
    if (!activeView(render)) continue;
    try {
      if (stage.kind === 'cache') {
        if (stage.result?.ok) render(stage.result);
      } else if (!stage.freshOnly || render.fresh) render(stage.result);
    } catch { log('popup.cache-consumer-failed', { phase: 'render' }, 'warn'); }
    if (stage.kind === 'cache') {
      try { render.cacheReady?.(); }
      catch { log('popup.cache-consumer-failed', { phase: 'cache-ready' }, 'warn'); }
    }
  }
}

function deliver(pair, stage) {
  pair.stages.push(stage);
  for (const render of pair.views.keys()) replay(pair, render);
}

async function refreshPair(ctx, type, payload, pair) {
  if (!hasView(pair)) return;
  let cached;
  try { cached = await ctx.send(type, { ...payload, source: 'cache' }); }
  catch (error) { deliver(pair, { kind: 'cache', result: null }); throw error; }
  const hasCache = cached.ok === true;
  deliver(pair, { kind: 'cache', result: cached });
  if (!hasView(pair)) return cached;
  const refreshed = await ctx.send(type, { ...payload, source: 'network' });
  const offlineRefresh = refreshed.ok === true
    ? refreshed.data?.offline === true
    : ['BACKEND_UNREACHABLE', 'TIMEOUT'].includes(refreshed.error?.code);
  if (!hasCache || !offlineRefresh) deliver(pair, { kind: 'network', result: refreshed });
  else {
    // 失效后的视图拒绝旧缓存，离线时仍需结束加载并显示错误。
    deliver(pair, { kind: 'network', freshOnly: true, result: refreshed.ok ? { ok: false, error: {
      code: 'NO_CACHE', message: '后端未连接，缓存已失效，请恢复连接后刷新',
    } } : refreshed });
  }
  return refreshed;
}

/**
 * 首屏先完成缓存渲染，再发网络消息；仅断连、超时或离线成功响应保留缓存。
 * @param {{send: Function}} ctx popup 上下文。
 * @param {string} type 消息类型。
 * @param {Object} payload 消息参数。
 * @param {Function} render 同步渲染信封；isActive() 控制卸载，fresh 标识失效，cacheReady() 结束缓存阶段。
 * @returns {Promise<Object|undefined>} 网络响应信封；卸载后可在发送前结束。
 */
// @code C-FE-CACHE-04
export async function loadCacheFirst(ctx, type, payload, render) {
  let pending = pendingByContext.get(ctx);
  if (!pending) { pending = new Map(); pendingByContext.set(ctx, pending); }
  const key = JSON.stringify([type, canonical(payload)]);
  let pair = pending.get(key);
  if (!pair || !hasView(pair)) {
    pair = { views: new Map(), stages: [] };
    pending.set(key, pair);
    pair.task = Promise.resolve().then(() => refreshPair(ctx, type, payload, pair))
      .finally(() => { if (pending.get(key) === pair) pending.delete(key); });
  }
  if (!pair.views.has(render)) pair.views.set(render, { next: 0 });
  // 在最终释放前加入的消费者也按 cache→network 重放所有已交付阶段。
  replay(pair, render);
  return pair.task;
}

/**
 * 单个视图串行刷新；真实失效撤销旧响应，并合并成一次后继刷新。
 * @param {Function} run 接收 isCurrent() 和 fresh，失效后的刷新不应展示旧缓存。
 * @returns {{request: Function, replace: Function, invalidate: Function, dispose: Function, acceptsSnapshot: Function}} 生命周期内的刷新队列。
 */
// @code C-FE-CACHE-04
export function createRefreshQueue(run) {
  let active = true;
  let version = 0;
  let pending = false;
  let needsFresh = false;
  let task = null;
  const start = () => {
    task = Promise.resolve().then(() => {
      if (!active) return;
      pending = false;
      const current = version;
      return run(() => active && current === version, needsFresh);
    }).catch((error) => {
      log('popup.refresh-failed', { code: error?.code || 'INTERNAL' }, 'warn');
    }).finally(() => {
      task = null;
      if (active && pending) return start();
      needsFresh = false;
    });
    return task;
  };
  const restart = (fresh) => {
      if (!active) return Promise.resolve();
      version++;
      needsFresh ||= fresh;
      if (task) { pending = true; return task; }
      return start();
  };
  return {
    request: () => active ? (task ?? start()) : Promise.resolve(),
    replace: () => restart(false),
    invalidate: () => restart(true),
    acceptsSnapshot: () => active && !needsFresh,
    dispose() { active = false; version++; pending = false; },
  };
}

/**
 * 缓存首帧前暂存最新快照；以事件版本隔离迟到消息，时间戳只作为元数据。
 * @returns {{begin: Function, snapshot: Function, reset: Function, dispose: Function}} 单个视图的阶段屏障。
 */
// @code C-FE-CACHE-04
export function createSnapshotGate() {
  let active = true;
  let version = 0;
  let waiting = false;
  let buffered = null;
  const reset = () => { version++; waiting = false; buffered = null; };
  return {
    begin() {
      waiting = true;
      const started = version;
      return {
        accepts: () => active && (waiting || started === version),
        ready() {
          if (!active || !waiting) return;
          waiting = false;
          const apply = buffered;
          buffered = null;
          apply?.();
        },
      };
    },
    snapshot(apply) {
      if (!active) return;
      version++;
      if (waiting) buffered = apply;
      else apply();
    },
    reset,
    dispose() { active = false; reset(); },
  };
}
