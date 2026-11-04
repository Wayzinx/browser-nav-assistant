import { DEFAULTS } from '../../shared/constants.js';
import { SK } from '../../shared/storage-keys.js';
import { storageGet, storagePatch } from './storage.js';
import { isSyncInFlight } from './sync.js';

// @code C-FE-SYNC-04
const COUNT_FIELDS = ['uploaded', 'filtered', 'received', 'created', 'updated', 'rejected'];
const INTERRUPTED = { code: 'SYNC_INTERRUPTED', message: '同步中断（超过 30 秒未完成），请重试' };

function counts(stats = {}) {
  return Object.fromEntries(COUNT_FIELDS.map((key) => [key,
    Number.isFinite(stats?.[key]) && stats[key] >= 0 ? stats[key] : 0,
  ]));
}

function withDefaults(state) {
  return {
    status: 'idle', startedAt: null, lastSyncAt: null, lastSuccessAt: null,
    lastError: null, cursor: null, cursorBase: null, fullReason: null,
    mode: 'full', trigger: 'user', ...state, stats: counts(state?.stats),
  };
}

function interrupted(state) {
  // 循环依赖只在调用时读取；活着的单飞任务不受陈旧的 storage 状态影响。
  return state.status === 'syncing' && Number.isFinite(state.startedAt)
    && Date.now() - state.startedAt > DEFAULTS.SYNC_INTERRUPTED_MS && !isSyncInFlight();
}

function errorState(current, error, stats) {
  return {
    ...current, status: 'error',
    lastError: {
      code: typeof error?.code === 'string' && error.code ? error.code : 'INTERNAL',
      message: typeof error?.message === 'string' && error.message ? error.message : '同步失败，请重试',
    },
    ...(stats === undefined ? {} : { stats: counts(stats) }),
  };
}

/** @returns {Promise<Object>} 默认 idle；仅恢复本 SW 已失去的超时任务，并持久化中断错误。 */
export async function loadSyncState() {
  const state = withDefaults(await storageGet(SK.SYNC_STATE, {}));
  if (!interrupted(state)) return state;
  // 进入 CORE 队列后重新判定，避免覆盖期间刚写入的新批次。
  return storagePatch(SK.SYNC_STATE, (saved) => {
    const current = withDefaults(saved);
    return interrupted(current) ? errorState(current, INTERRUPTED) : current;
  });
}

/**
 * 开始新批次时保留成功游标和缓存，失败后仍可按旧游标重试。
 * @param {{startedAt?: number, trigger?: string, mode?: string}} [state={}] 本批元数据。
 * @returns {Promise<Object>} 持久化的同步中状态。
 */
export function markSyncing(state = {}) {
  return storagePatch(SK.SYNC_STATE, (saved) => ({
    ...withDefaults(saved), status: 'syncing', startedAt: state.startedAt ?? Date.now(),
    trigger: state.trigger ?? 'user', lastError: null, stats: counts(),
    mode: state.mode === 'incremental' ? 'incremental' : 'full', fullReason: null,
  }));
}

/**
 * 成功游标以客户端开始时间为准；上次同步时间保留服务端 syncedAt 的展示语义。
 * @param {Object} [state={}] stats、mode、cursorBase、fullReason 和 lastSyncAt。
 * @returns {Promise<Object>} 持久化的成功状态。
 */
export function markSuccess(state = {}) {
  return storagePatch(SK.SYNC_STATE, (saved) => {
    const current = withDefaults(saved);
    const startedAt = state.startedAt ?? current.startedAt ?? Date.now();
    return {
      ...current, status: 'success', startedAt,
      lastSyncAt: state.lastSyncAt ?? state.stats?.syncedAt ?? Date.now(),
      lastSuccessAt: startedAt, cursor: startedAt, lastError: null,
      cursorBase: state.cursorBase ? {
        apiBaseUrl: state.cursorBase.apiBaseUrl,
        serverStartedAt: state.cursorBase.serverStartedAt ?? null,
      } : null,
      mode: (state.mode ?? current.mode) === 'incremental' ? 'incremental' : 'full',
      fullReason: state.fullReason ?? null, stats: counts(state.stats),
    };
  });
}

/**
 * 只更新失败元数据和可选计数，不推进游标，也不覆盖上次成功时间。
 * @param {{code: string, message: string}} error 归一化错误。
 * @param {Object} [stats] 本批统计；只保存白名单数字。
 * @returns {Promise<Object>} 持久化的失败状态。
 */
export function markError(error, stats) {
  return storagePatch(SK.SYNC_STATE, (saved) => errorState(withDefaults(saved), error, stats));
}
