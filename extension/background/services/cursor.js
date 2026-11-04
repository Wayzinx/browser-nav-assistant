import { DAY_MS, DEFAULTS } from '../../shared/constants.js';
import { SK } from '../../shared/storage-keys.js';
import { storagePatch } from './storage.js';

// @code C-FE-INCR-01
function invalidationReason({ syncState, health, apiBaseUrl }) {
  // 无法确认后端身份时不重置游标，失败重试仍使用原来的历史窗口。
  if (!health) return null;
  if (syncState.cursorBase?.apiBaseUrl !== apiBaseUrl) return 'api_base_changed';
  if (health.persistence === 'memory' && health.startedAt > syncState.cursor) {
    return 'server_restarted';
  }
  if (health.lastSyncAt === null || health.pageCount === 0) return 'server_empty';
  return null;
}

/**
 * 判断本地游标能否继续用于当前后端；不修改同步状态。
 * @param {{syncState: Object, health: Object|null, apiBaseUrl: string}} options 游标与健康信息。
 * @returns {boolean} 是否可以增量同步。
 */
export function isCursorValid({ syncState = {}, health = null, apiBaseUrl } = {}) {
  return Number.isFinite(syncState?.cursor) && syncState.cursor >= 0
    && invalidationReason({ syncState, health, apiBaseUrl }) === null;
}

/**
 * 计算本批历史查询参数；全量结果不带 cursor，时间基准由同步开始时固定。
 * @param {{syncState?: Object, mode?: string, now?: number, lookbackDays?: number, maxResults?: number, health?: Object|null, apiBaseUrl: string}} options 同步参数。
 * @returns {{mode: string, startTime: number, maxResults: number, cursor?: number, fullReason?: string}} 历史窗口。
 */
export function resolveHistoryWindow({
  syncState = {}, mode = 'auto', now = Date.now(),
  lookbackDays = DEFAULTS.HISTORY_LOOKBACK_DAYS, maxResults = DEFAULTS.MAX_HISTORY_ITEMS,
  health = null, apiBaseUrl,
} = {}) {
  const full = { mode: 'full', startTime: now - lookbackDays * DAY_MS, maxResults };
  if (mode === 'full' || !Number.isFinite(syncState?.cursor) || syncState.cursor < 0) return full;
  if (!isCursorValid({ syncState, health, apiBaseUrl })) {
    return { ...full, fullReason: invalidationReason({ syncState, health, apiBaseUrl }) };
  }
  return {
    mode: 'incremental', cursor: syncState.cursor,
    startTime: syncState.cursor - DEFAULTS.INCREMENTAL_OVERLAP_MS, maxResults,
  };
}

/**
 * 地址保存成功后仅清空游标绑定，保留上次成功时间、统计和错误供诊断。
 * @returns {Promise<void>} 持久化完成后返回。
 */
export async function resetCursor() {
  await storagePatch(SK.SYNC_STATE, { cursor: null, cursorBase: null });
}
