import { isHttpUrl } from '../../shared/url.js';

// @code C-FE-SYNC-05
function canUpload(entry) {
  return Boolean(entry && !entry.incognito && !entry.isSystem && isHttpUrl(entry.url));
}

function pageFields(entry) {
  return {
    url: entry.url,
    title: typeof entry.title === 'string' && entry.title.trim() ? entry.title : entry.url,
  };
}

function tabFields(entry) {
  return {
    ...pageFields(entry),
    ...(Number.isFinite(entry.lastAccessed) ? { lastAccessed: entry.lastAccessed } : {}),
  };
}

function historyFields(entry) {
  return {
    ...pageFields(entry),
    lastVisitTime: entry.lastVisitTime,
    ...(Number.isFinite(entry.visitCount) ? { visitCount: entry.visitCount } : {}),
  };
}

/**
 * 只投影上行白名单字段；敏感词过滤由调用方先执行，内部标记不得随对象展开泄漏。
 * @param {{active: Object|null, tabs: Object[], history: Object[]}} snapshot 已过滤的快照。
 * @param {{mode?: string, cursor?: number, clientVersion?: string}} [options={}] 上行元数据。
 * @returns {{activeTab: Object|null, openTabs: Object[], history: Object[], mode: string, cursor?: number, clientVersion?: string}} 请求体。
 */
export function buildSyncPayload(snapshot, options = {}) {
  const mode = options.mode === 'incremental' ? 'incremental' : 'full';
  if (mode === 'incremental' && (!Number.isFinite(options.cursor) || options.cursor < 0)) {
    throw Object.assign(new Error('增量同步缺少有效游标'), { code: 'VALIDATION_FAILED' });
  }
  return {
    activeTab: canUpload(snapshot.active) ? tabFields(snapshot.active) : null,
    openTabs: snapshot.tabs.filter(canUpload).map(tabFields),
    history: snapshot.history.filter(canUpload).map(historyFields),
    mode,
    ...(mode === 'incremental' ? { cursor: options.cursor } : {}),
    ...(typeof options.clientVersion === 'string' ? { clientVersion: options.clientVersion } : {}),
  };
}
