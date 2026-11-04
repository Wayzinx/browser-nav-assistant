import { MSG } from '../../shared/messages.js';
import { DAY_MS, DEFAULTS } from '../../shared/constants.js';
import { SK } from '../../shared/storage-keys.js';
import { isSystemUrl } from '../../shared/url.js';
import { storageGet } from '../services/storage.js';
import { resolveCurrentPage } from '../services/current-page.js';
import { listWindowTabs, readHistory } from '../services/collector.js';
import { getPrivacyConfig } from '../services/privacy-config.js';
import { classifyUrl, privacyLabel } from '../services/privacy.js';

// @code C-FE-CTX-04
function badgeFor(url, keywords) {
  const classification = classifyUrl(url, keywords);
  if (classification.reason !== 'system' && classification.reason !== 'sensitive') return null;
  return {
    kind: classification.reason,
    ...(classification.keyword === undefined ? {} : { keyword: classification.keyword }),
    label: privacyLabel(classification),
  };
}

export const handlers = {
  /**
   * 配置兜底由 PRIV 负责；依赖异常交给统一路由，不能伪造空上下文。
   * @param {Object} [payload={}]
   * @param {Object} [sender={}] Chrome 消息发送方。
   * @returns {Promise<{currentPage: Object, tabs: Object[], history: Object[], historyQuery: Object, privacy: Object}>}
   */
  // @code C-FE-CTX-04
  async [MSG.GET_CONTEXT](payload = {}, sender = {}) {
    const privacy = await getPrivacyConfig();
    const cache = await storageGet(SK.CACHE, {});
    const config = cache?.config?.data;
    // 同一个对象传给采集器并返回界面，避免展示参数与实际查询漂移。
    const historyQuery = {
      startTime: Date.now()
        - (config?.historyLookbackDays ?? DEFAULTS.HISTORY_LOOKBACK_DAYS) * DAY_MS,
      maxResults: config?.maxHistoryItems ?? DEFAULTS.MAX_HISTORY_ITEMS,
    };
    const [currentPage, tabs, history] = await Promise.all([
      resolveCurrentPage(),
      listWindowTabs(sender?.tab?.windowId),
      readHistory(historyQuery),
    ]);
    const keywords = privacy.enabled ? privacy.keywords : [];
    return {
      currentPage: { ...currentPage, badge: badgeFor(currentPage.url, keywords) },
      tabs: tabs.map((tab) => ({
        tabId: tab.id,
        url: tab.url ?? '',
        title: tab.title || tab.url || '',
        isSystem: isSystemUrl(tab.url),
        badge: badgeFor(tab.url, keywords),
      })),
      history: history.map((item) => ({
        url: item.url ?? '',
        title: item.title || item.url || '',
        lastVisitTime: item.lastVisitTime,
        visitCount: item.visitCount,
        badge: badgeFor(item.url, keywords),
      })),
      historyQuery,
      privacy,
    };
  },
};
