import { DEFAULTS } from '../../shared/constants.js';
import { SK } from '../../shared/storage-keys.js';
import { log } from '../../shared/logger.js';
import { storageGet } from './storage.js';
import { callApi, getApiBase } from './api-client.js';
import { resolveCurrentPage } from './current-page.js';
import { listAllNormalTabs, readHistory } from './collector.js';
import { getPrivacyConfig } from './privacy-config.js';
import { filterForUpload } from './privacy.js';
import { resolveHistoryWindow } from './cursor.js';
import { loadSyncState, markSyncing, markSuccess, markError } from './sync-state.js';
import { buildSyncPayload } from './sync-payload.js';
import { refreshRanked } from '../handlers/ranked.js';
import { refreshRecommendations } from '../handlers/recommend.js';
import { refreshCleanup } from '../handlers/cleanup.js';
import { refreshRules } from '../handlers/rules.js';

// @code C-FE-SYNC-03
let inFlight = null;

function syncError(error) {
  return {
    code: typeof error?.code === 'string' && error.code ? error.code : 'INTERNAL',
    message: typeof error?.message === 'string' && error.message ? error.message : '同步失败，请重试',
  };
}

async function probeHealth() {
  try {
    const response = await callApi('GET', '/api/health', undefined, {
      timeoutMs: DEFAULTS.HEALTH_TIMEOUT_MS, retry: false,
    });
    if (response.ok) return response.data;
    log('sync.health-failed', { code: response.error?.code }, 'warn');
  } catch (error) {
    log('sync.health-failed', { code: error?.code || 'INTERNAL' }, 'warn');
  }
  return null;
}

async function refreshCaches() {
  const tasks = [
    ['ranked', refreshRanked], ['recommendations', refreshRecommendations],
    ['cleanup', refreshCleanup], ['rules', refreshRules], ['config', getPrivacyConfig],
  ];
  // 包一层微任务，让同步抛错和失败信封也都能独立记录，不改变已成功的上报结果。
  const settled = await Promise.allSettled(tasks.map(([, refresh]) => Promise.resolve().then(refresh)));
  settled.forEach((result, index) => {
    if (result.status === 'rejected' || result.value?.ok === false) {
      const error = result.status === 'rejected' ? result.reason : result.value.error;
      log('sync.refresh-failed', { cache: tasks[index][0], code: error?.code || 'INTERNAL' }, 'warn');
    }
  });
}

async function doSync({ mode = 'auto', trigger = 'user' } = {}) {
  let stats;
  try {
    const state = await loadSyncState();
    const startedAt = Date.now();
    await markSyncing({ startedAt, trigger, mode: mode === 'full' || state.cursor === null ? 'full' : 'incremental' });
    // 隐私配置或过滤器未实现时必须失败，不能绕过 PRIV 继续上行。
    const privacy = await getPrivacyConfig();
    const apiBaseUrl = await getApiBase();
    const health = await probeHealth();
    const cache = await storageGet(SK.CACHE, {});
    const config = cache?.config?.data;
    const win = resolveHistoryWindow({
      syncState: state, mode, now: startedAt, health, apiBaseUrl,
      lookbackDays: config?.historyLookbackDays ?? DEFAULTS.HISTORY_LOOKBACK_DAYS,
      maxResults: config?.maxHistoryItems ?? DEFAULTS.MAX_HISTORY_ITEMS,
    });
    const [active, tabs, history] = await Promise.all([
      resolveCurrentPage(), listAllNormalTabs(), readHistory(win),
    ]);
    const { payload, filteredCount } = filterForUpload({ active, tabs, history }, privacy);
    const body = buildSyncPayload(payload, {
      ...win, clientVersion: globalThis.chrome?.runtime?.getManifest?.()?.version,
    });
    stats = { uploaded: (body.activeTab ? 1 : 0) + body.openTabs.length + body.history.length, filtered: filteredCount };
    const response = await callApi('POST', '/api/sync', body, {
      timeoutMs: DEFAULTS.SYNC_TIMEOUT_MS, retry: false,
    });
    if (!response.ok) throw response.error;
    const syncState = await markSuccess({
      startedAt, lastSyncAt: response.data.syncedAt, mode: win.mode,
      cursorBase: { apiBaseUrl, serverStartedAt: health?.startedAt }, fullReason: win.fullReason,
      stats: { ...response.data, ...stats },
    });
    await refreshCaches();
    return { ok: true, data: { syncState, result: response.data, fullReason: win.fullReason ?? null } };
  } catch (cause) {
    const error = syncError(cause);
    try {
      await markError(error, stats);
    } catch (storageError) {
      log('sync.state-write-failed', { code: storageError?.code || 'STORAGE_FAILED' }, 'error');
    }
    log('sync.failed', { code: error.code }, 'warn');
    return { ok: false, error };
  }
}

/**
 * 所有同步入口共用同一个 Promise；先占住单飞位置，再开始异步读取状态。
 * @param {{mode?: string, trigger?: string}} [options={}] 并发加入者的参数被忽略。
 * @returns {Promise<{ok: true, data: Object}|{ok: false, error: Object}>} 同一批次的结果信封。
 */
export function runSync(options = {}) {
  if (inFlight) return inFlight;
  inFlight = Promise.resolve().then(() => doSync(options ?? {})).finally(() => { inFlight = null; });
  return inFlight;
}

/** @returns {boolean} 本 SW 是否仍持有正在执行的同步；不读取持久化的展示状态。 */
export function isSyncInFlight() {
  return inFlight !== null;
}
