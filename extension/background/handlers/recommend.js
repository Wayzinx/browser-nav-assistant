import { MSG } from '../../shared/messages.js';
import { DAY_MS, DEFAULTS } from '../../shared/constants.js';
import { isHttpUrl } from '../../shared/url.js';
import { callApi } from '../services/api-client.js';
import { resolveCurrentPage } from '../services/current-page.js';
import { listAllNormalTabs, readHistory } from '../services/collector.js';
import { getCachedPrivacyConfig, getPrivacyConfig } from '../services/privacy-config.js';
import { filterForUpload } from '../services/privacy.js';
import { withCache } from '../services/cache.js';

// @code C-FE-REC-01
function pageFields(page) {
  return { url: page.url, ...(typeof page.title === 'string' ? { title: page.title } : {}) };
}

/** 过滤必须先于字段投影和缓存 key 计算，避免隐私 URL 进入请求或持久化。 */
async function buildRequest(source) {
  const now = Date.now();
  const [active, tabs, history, privacy] = await Promise.all([
    resolveCurrentPage(),
    listAllNormalTabs(),
    readHistory({
      startTime: now - DEFAULTS.HISTORY_LOOKBACK_DAYS * DAY_MS,
      maxResults: DEFAULTS.MAX_HISTORY_ITEMS,
    }),
    source === 'cache' ? getCachedPrivacyConfig() : getPrivacyConfig(),
  ]);
  const { payload } = filterForUpload({
    active: active && !active.isSystem && !active.incognito && isHttpUrl(active.url) ? active : null,
    tabs,
    history,
  }, privacy);
  const currentPage = payload.active ? pageFields(payload.active) : null;
  const body = {
    currentPage,
    openTabs: payload.tabs.slice(0, DEFAULTS.MAX_OPEN_TABS).map(pageFields),
    recentHistory: [...payload.history]
      .sort((left, right) => right.lastVisitTime - left.lastVisitTime)
      .slice(0, 20)
      // 契约为 number(ms)，保留 Chrome 的小数毫秒，避免改变访问先后顺序。
      .map((page) => ({ ...pageFields(page), lastVisitTime: page.lastVisitTime })),
  };
  let key = '__none__';
  if (currentPage) {
    const url = new URL(currentPage.url);
    url.hash = '';
    key = url.href;
  }
  return { body, key, contextUrl: currentPage?.url ?? null };
}

/** 上游失败保持错误信封，不能把未实现、断连或无缓存当成空推荐。 */
async function loadRecommendations(source) {
  try {
    if (!['cache', 'network'].includes(source)) {
      throw Object.assign(new Error('推荐来源必须是 cache 或 network'), { code: 'VALIDATION_FAILED' });
    }
    const { body, key, contextUrl } = await buildRequest(source);
    const result = await withCache('recommendations', async () => {
      const response = await callApi('POST', '/api/recommendations/next', body);
      if (!response.ok) return response;
      if (!Array.isArray(response.data?.recommendations)) {
        return { ok: false, error: { code: 'INVALID_RESPONSE', message: '推荐响应格式无效' } };
      }
      return response;
    }, { source, key });
    // 上下文属于本次消息的元信息，缓存 data 保持后端响应原样。
    return { ...result, contextUrl };
  } catch (error) {
    return { ok: false, error: {
      code: error?.code || 'INTERNAL',
      message: error?.code ? error.message : '无法读取推荐，请稍后重试',
    } };
  }
}

/**
 * 同步成功后刷新推荐，与消息的网络路径共用上下文和缓存 key。
 * @returns {Promise<{ok: boolean, data?: Object, error?: Object}>} 缓存服务的 Result 信封。
 */
export async function refreshRecommendations() {
  return loadRecommendations('network');
}

export const handlers = {
  /**
   * @param {{source?: 'cache'|'network'}} [payload={}]
   * @returns {Promise<{recommendations: Object[], contextUrl: string|null, fromCache: boolean, offline: boolean, cachedAt: number|null}>}
   */
  async [MSG.GET_RECOMMENDATIONS](payload = {}) {
    const result = await loadRecommendations(payload?.source ?? 'network');
    if (!result.ok) {
      throw Object.assign(new Error(result.error.message), result.error);
    }
    return {
      recommendations: result.data.recommendations,
      contextUrl: result.contextUrl ?? null,
      fromCache: result.fromCache === true,
      offline: result.offline === true,
      cachedAt: result.cachedAt ?? null,
    };
  },
};
