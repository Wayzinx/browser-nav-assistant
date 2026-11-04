import { createPageRecord, mergeObservation } from '../domain/page-merge.js';
import { sanitizeEntry } from '../domain/sync-sanitize.js';
import { now } from '../lib/clock.js';
import { log } from '../lib/logger.js';
import { countPages, getPage, upsertPage } from '../store/page-repo.js';
import { appendSyncLog, bumpDataVersion } from '../store/state.js';
import { applyOpenSnapshot } from './open-snapshot.js';
import { getEffectiveKeywords, isPrivacyFilterEnabled, summarizeRejected } from './privacy-service.js';

// @code C-BE-SYNC-04
/**
 * history → openTabs → activeTab；每条有效重复观测计为 updated，重复同步不累加次数。
 * @param {{activeTab:object|null,openTabs:unknown[],history:unknown[],mode:string,clientVersion?:string,cursor?:number}} input 路由已校验的上下文
 * @param {{now?:number,reqId?:string}} [options] 本批服务器时刻和请求日志关联 ID
 * @returns {object} 同步统计；页面总数包含归档页，拒收仅返回原因计数
 */
export function syncContext(input, { now: syncedAt = now(), reqId } = {}) {
  const startedAt = performance.now();
  const cleaning = { keywords: getEffectiveKeywords(), privacyEnabled: isPrivacyFilterEnabled(), now: syncedAt };
  const batches = [[input.history, 'history'], [input.openTabs, 'open_tab'], [input.activeTab ? [input.activeTab] : [], 'active_tab']];
  const openUrls = new Set();
  const rejectedEntries = [];
  let activeUrl = null;
  let created = 0;
  let updated = 0;
  for (const [records, source] of batches) {
    for (const raw of records) {
      const result = sanitizeEntry(raw, { ...cleaning, source });
      if (!result.ok) {
        rejectedEntries.push({ url: raw?.url, reason: result.reason });
        continue;
      }
      const previous = getPage(result.entry.normalizedUrl);
      upsertPage(previous
        ? mergeObservation(previous, result.entry, source, syncedAt)
        : createPageRecord(result.entry, source, syncedAt));
      if (previous) updated += 1;
      else created += 1;
      if (source === 'open_tab' || source === 'active_tab') openUrls.add(result.entry.normalizedUrl);
      if (source === 'active_tab') activeUrl = result.entry.normalizedUrl;
    }
  }
  applyOpenSnapshot({ openUrls, activeUrl });
  const { rejectedByReason, rejectedDomains } = summarizeRejected(rejectedEntries);
  const result = {
    ok: true,
    syncedAt,
    received: input.history.length + input.openTabs.length + (input.activeTab ? 1 : 0),
    created,
    updated,
    rejected: rejectedEntries.length,
    rejectedByReason,
    pageCount: countPages(),
    mode: input.mode,
  };
  const durationMs = performance.now() - startedAt;
  appendSyncLog({ ...result, clientVersion: input.clientVersion, cursor: input.cursor, durationMs });
  // 统一变更事件供 RANK 异步重建和入口的持久化订阅使用；整批只递增一次。
  bumpDataVersion();
  log('info', 'sync done', { reqId, ...result, rejectedDomains, durationMs });
  return result;
}
