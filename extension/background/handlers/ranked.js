import { MSG } from '../../shared/messages.js';
import { DEFAULTS } from '../../shared/constants.js';
import { callApi } from '../services/api-client.js';
import { withCache } from '../services/cache.js';

// @code C-FE-RANK-01
const OFFLINE_ERRORS = new Set(['BACKEND_UNREACHABLE', 'TIMEOUT']);

function onlineRequired() {
  return { ok: false, error: { code: 'NO_CACHE', message: '筛选需要在线' } };
}

function fetchRanked({ limit, openOnly, domain }) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (openOnly) query.set('openOnly', 'true');
  if (domain) query.set('domain', domain);
  return callApi('GET', `/api/pages/ranked?${query}`);
}

async function queryRanked({
  limit = DEFAULTS.RANKED_LIMIT, openOnly = false, domain = null, source = 'network',
} = {}) {
  const fetcher = () => fetchRanked({ limit, openOnly, domain });
  // 只有默认完整列表可进入共享缓存，筛选不能污染首页与离线结果。
  if (!openOnly && !domain && limit === DEFAULTS.RANKED_LIMIT) {
    return withCache('ranked', fetcher, { source });
  }
  if (source === 'cache') return onlineRequired();
  const result = await fetcher();
  if (!result.ok) return OFFLINE_ERRORS.has(result.error?.code) ? onlineRequired() : result;
  return { ok: true, data: result.data, fromCache: false, offline: false, cachedAt: null };
}

/**
 * 用默认完整列表刷新排序缓存，供同步编排复用同一请求口径。
 * @returns {Promise<Object>} 共享缓存服务的 Result 信封。
 */
export async function refreshRanked() {
  return queryRanked();
}

export const handlers = {
  /**
   * 将后端排序和缓存标记转换为消息 data，筛选与域名均由后端决定。
   * @param {{limit?: number, openOnly?: boolean, domain?: string|null, source?: 'cache'|'network'}} [payload={}]
   * @returns {Promise<{pages: Object[], total: number, domains: string[], fromCache: boolean, offline: boolean, cachedAt: number|null}>}
   */
  async [MSG.GET_RANKED](payload = {}) {
    const result = await queryRanked(payload);
    if (!result.ok) {
      throw Object.assign(new Error(result.error.message), result.error);
    }
    return {
      pages: result.data.pages,
      total: result.data.total,
      domains: result.data.domains,
      fromCache: result.fromCache === true,
      offline: result.offline === true,
      cachedAt: result.cachedAt ?? null,
    };
  },
};
