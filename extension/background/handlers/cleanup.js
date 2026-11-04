import { MSG } from '../../shared/messages.js';
import { SK } from '../../shared/storage-keys.js';
import { projectCleanupResult } from '../../shared/cleanup-result.js';
import { callApi, getApiBase } from '../services/api-client.js';
import { withCache } from '../services/cache.js';
import { storageGet } from '../services/storage.js';

// @code C-FE-CLEAN-01
// 保留既有导出，后台和 popup 的忽略口径由同一个纯函数维护。
export { filterIgnored } from '../../shared/cleanup-result.js';

async function fetchCleanup() {
  const result = await callApi('GET', '/api/pages/cleanup-suggestions');
  if (result.ok && !Array.isArray(result.data.suggestions)) {
    return { ok: false, error: { code: 'INVALID_RESPONSE', message: '后端整理建议格式无效' } };
  }
  if (!result.ok && ['BACKEND_UNREACHABLE', 'TIMEOUT'].includes(result.error?.code)) {
    // 地址只取统一客户端验证后的配置，不把底层网络异常直接展示给用户。
    try {
      const base = await getApiBase();
      result.error = { ...result.error, message: result.error.code === 'TIMEOUT'
        ? `连接后端 ${base} 超时，请检查后端服务`
        : `无法连接后端 ${base}，请检查后端服务和 API 地址` };
    } catch { /* 配置读取失败时保留原始网络错误。 */ }
  }
  return result;
}

async function queryCleanup(source = 'network') {
  const result = await withCache('cleanup', fetchCleanup, { source });
  if (!result.ok) return result;
  const ignored = await storageGet(SK.IGNORED_SUGGESTIONS, {});
  return { ...result, data: projectCleanupResult(result.data, ignored) };
}

/**
 * 走网络刷新原始整理缓存，返回消息所需的过滤结果与缓存元数据。
 * @returns {Promise<Object>} CACHE Result 信封。
 */
export async function refreshCleanup() {
  return queryCleanup('network');
}

/** GET_CLEANUP 的业务处理；异常统一由 CORE 转成消息错误信封。 */
export const handlers = {
  /**
   * @param {{source?: 'cache'|'network'}} [payload={}] 缓存来源。
   * @returns {Promise<Object>} 过滤后的建议、汇总及缓存标记。
   */
  async [MSG.GET_CLEANUP](payload = {}) {
    const result = await queryCleanup(payload.source);
    if (!result.ok) throw Object.assign(new Error(result.error.message), result.error);
    return {
      ...result.data,
      fromCache: result.fromCache === true,
      offline: result.offline === true,
      cachedAt: result.cachedAt ?? null,
    };
  },
};
