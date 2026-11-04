import { SK } from '../../shared/storage-keys.js';
import { storageGet, storagePatch } from './storage.js';
import { callApi } from './api-client.js';
import { runSync } from './sync.js';
import { loadSyncState } from './sync-state.js';

// @code C-FE-CACHE-03
const NETWORK_ERRORS = new Set(['BACKEND_UNREACHABLE', 'TIMEOUT']);
let inFlight = null;

async function recover() {
  const connection = await storageGet(SK.CONNECTION, {});
  if (connection?.recoverPending !== true) {
    const syncState = await loadSyncState();
    if (!NETWORK_ERRORS.has(syncState?.lastError?.code)) {
      return { resynced: false, reason: 'not-needed' };
    }
    // lastError 也能触发恢复，先保留标记，避免本次失败后丢失重试条件。
    await storagePatch(SK.CONNECTION, { recoverPending: true });
  }
  const health = await callApi('GET', '/api/health', undefined, { retry: false });
  if (!health.ok) return { resynced: false, reason: 'backend-down' };
  const result = await runSync({ trigger: 'auto' });
  if (!result.ok) return { resynced: false, reason: 'sync-failed' };
  // 上传成功后，缓存刷新仍可能断连；以队列中最新状态决定是否清除恢复标记。
  await storagePatch(SK.CONNECTION, (current) => current.status === 'online'
    ? { ...current, recoverPending: false } : current);
  return { resynced: true, reason: 'synced' };
}

/**
 * 按持久标记恢复；并发调用共享探测和同步，SYNC 自身负责复用手动同步。
 * @returns {Promise<{resynced: boolean, reason: string}>}
 */
// @code C-FE-CACHE-03
export function maybeAutoResync() {
  if (!inFlight) {
    // 将工作排入微任务，确保第一次 await 之前已设置共享 Promise。
    inFlight = Promise.resolve().then(recover).finally(() => { inFlight = null; });
  }
  return inFlight;
}
