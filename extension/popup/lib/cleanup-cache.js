import { SK } from '../../shared/storage-keys.js';
import { projectCleanupResult } from '../../shared/cleanup-result.js';
import { log } from '../../shared/logger.js';
import { createSnapshotGate } from './cache-first.js';

function valid(entry) {
  return Number.isSafeInteger(entry?.cachedAt) && entry.cachedAt > 0
    && Array.isArray(entry.data?.suggestions);
}

/**
 * 只消费完整快照与本地忽略表；初读和事件按版本隔离，不发业务消息或写缓存。
 * @param {Object} ctx popup 上下文。
 * @param {Function} render 接收投影后的消息信封。
 * @param {Function} invalidate 原有有效 entry 被删除时调用。
 * @param {{initial?: boolean, accepts?: Function}} [options={}] 初读维护计数；失效刷新期间隔离旧快照。
 * @returns {{begin: Function, accepts: Function, note: Function, dispose: Function}} 缓存阶段、迟到保护与卸载接口。
 */
// @code C-FE-CLEAN-03
// @code C-FE-CLEAN-04
export function observeCleanupCache(ctx, render, invalidate, { initial = false, accepts = () => true } = {}) {
  let active = true;
  let revision = 0;
  let noted = 0;
  let latestTime = 0;
  const snapshots = createSnapshotGate();
  const paint = (entry, ignored, request) => {
    if (!active || !accepts() || request !== revision || !valid(entry) || entry.cachedAt < latestTime) return;
    latestTime = Math.max(latestTime, entry.cachedAt);
    render({ ok: true, data: {
      ...projectCleanupResult(entry.data, ignored), fromCache: true,
      offline: ctx.getState().connection?.status === 'offline', cachedAt: entry.cachedAt,
    } });
  };
  const consume = async (entry, request) => {
    if (entry.cachedAt < latestTime) return;
    const stored = await chrome.storage.local.get(SK.IGNORED_SUGGESTIONS);
    paint(entry, stored[SK.IGNORED_SUGGESTIONS] ?? {}, request);
  };
  const failed = (error) => log('cleanup.snapshot-read-failed', { code: error?.code || 'STORAGE_FAILED' }, 'warn');
  const off = ctx.bus.on('storage:cache', ({ newValue, oldValue }) => {
    const next = newValue?.cleanup;
    const previous = oldValue?.cleanup;
    if (JSON.stringify(next?.data) === JSON.stringify(previous?.data)) return;
    if (valid(next)) {
      if (accepts() && next.cachedAt >= latestTime) {
        const request = ++revision;
        snapshots.snapshot(() => { void consume(next, request).catch(failed); });
      }
    }
    else if (valid(previous)) { revision++; latestTime = 0; snapshots.reset(); invalidate(); }
  });
  if (initial) {
    const request = revision;
    const previousNote = noted;
    void chrome.storage.local.get([SK.CACHE, SK.IGNORED_SUGGESTIONS]).then((stored) => {
      if (!active || request !== revision || previousNote !== noted) return;
      snapshots.snapshot(() => paint(stored[SK.CACHE]?.cleanup, stored[SK.IGNORED_SUGGESTIONS] ?? {}, request));
    }).catch(failed);
  }
  return {
    begin: () => snapshots.begin(),
    accepts: (result) => !result?.ok || !Number.isFinite(result.data.cachedAt) || result.data.cachedAt >= latestTime,
    note(result) { if (result?.ok) { noted++; latestTime = Math.max(latestTime, result.data.cachedAt ?? 0); } },
    dispose() { active = false; revision++; snapshots.dispose(); off(); },
  };
}
