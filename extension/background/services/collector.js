import { DAY_MS, DEFAULTS } from '../../shared/constants.js';
import { SK } from '../../shared/storage-keys.js';
import { isHttpUrl, isOwnExtensionUrl } from '../../shared/url.js';
import { log } from '../../shared/logger.js';
import { storageGet } from './storage.js';
import { pickByLastAccessed } from './current-page.js';

// @code C-FE-CTX-02
function isVisibleTab(tab) {
  return !tab.incognito && !isOwnExtensionUrl(tab.url);
}

/**
 * 优先读取消息发送方窗口，未指定时使用最后聚焦窗口，保留系统页供界面标注。
 * 仅未指定窗口且无可见标签时跨普通窗口回退，按最近网页（无网页则系统页）选定一个窗口。
 * @param {number} [windowId] 消息发送方所在窗口。
 * @returns {Promise<Object[]>}
 */
// @code C-FE-CTX-02
export async function listWindowTabs(windowId) {
  const hasWindowId = Number.isInteger(windowId) && windowId >= 0;
  const query = hasWindowId ? { windowId } : { lastFocusedWindow: true };
  const tabs = (await chrome.tabs.query(query)).filter(isVisibleTab);
  if (hasWindowId || tabs.length) return tabs;

  const candidates = (await chrome.tabs.query({ windowType: 'normal' })).filter(isVisibleTab);
  const selected = pickByLastAccessed(candidates.filter((tab) => isHttpUrl(tab.url)))
    || pickByLastAccessed(candidates);
  return selected ? candidates.filter((tab) => tab.windowId === selected.windowId) : [];
}

/**
 * 跨普通窗口采集；先去无痕及本插件页，再应用数量上限。
 * @returns {Promise<Object[]>}
 */
// @code C-FE-CTX-02
export async function listAllNormalTabs() {
  const tabs = await chrome.tabs.query({ windowType: 'normal' });
  return tabs.filter(isVisibleTab).slice(0, DEFAULTS.MAX_OPEN_TABS);
}

/**
 * 显式查询时间窗口与条数；完整参数由调用方提供时不再读取配置。
 * @param {{startTime?: number, maxResults?: number}} [options={}] 历史查询窗口。
 * @returns {Promise<Object[]>} 按最后访问时间从新到旧排列的 HistoryItem 数组。
 */
// @code C-FE-CTX-03
export async function readHistory({ startTime, maxResults } = {}) {
  const cache = startTime === undefined || maxResults === undefined
    ? await storageGet(SK.CACHE, {}) : null;
  const config = cache?.config?.data;
  const query = {
    text: '',
    startTime: startTime ?? Date.now()
      - (config?.historyLookbackDays ?? DEFAULTS.HISTORY_LOOKBACK_DAYS) * DAY_MS,
    maxResults: maxResults ?? config?.maxHistoryItems ?? DEFAULTS.MAX_HISTORY_ITEMS,
  };
  log('history.query', { startTime: query.startTime, maxResults: query.maxResults });
  const history = [];
  const seen = new Set();
  let endTime;
  // 本插件页会占用查询名额；保持原时间范围和单页上限，向前翻页补足可见历史。
  while (history.length < query.maxResults) {
    const page = await chrome.history.search({
      ...query,
      ...(endTime === undefined ? {} : { endTime }),
    });
    const previousSize = seen.size;
    for (const item of page) {
      const key = item.id ?? item.url;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!isOwnExtensionUrl(item.url)) history.push(item);
    }
    if (history.length >= query.maxResults || page.length < query.maxResults
      || seen.size === previousSize) break;
    const oldestTime = Math.min(...page.map((item) => item.lastVisitTime)
      .filter(Number.isFinite));
    // endTime 是排他上界；取下一整毫秒，避免毫秒/微秒转换后漏掉同一时间的记录。
    const nextEndTime = Math.floor(oldestTime) + 1;
    // 重叠记录由 seen 去重；游标不再向前推进时结束，避免反复查询同一页。
    if (!Number.isFinite(nextEndTime) || nextEndTime < query.startTime
      || (endTime !== undefined && nextEndTime >= endTime)) break;
    endTime = nextEndTime;
  }
  return history.sort((left, right) => (right.lastVisitTime ?? 0) - (left.lastVisitTime ?? 0))
    .slice(0, query.maxResults);
}
