import { MSG } from '../../shared/messages.js';
import { callApi } from '../services/api-client.js';
import { invalidate, withCache } from '../services/cache.js';
import { log } from '../../shared/logger.js';

function unwrap(result) {
  if (result.ok) return result.data;
  throw Object.assign(new Error(result.error.message), result.error);
}

// @code C-FE-RULE-01
async function loadRules(source = 'network') {
  return withCache('rules', async () => {
    const response = await callApi('GET', '/api/rules');
    if (!response.ok) return response;
    if (!Array.isArray(response.data?.rules)) {
      return { ok: false, error: { code: 'INVALID_RESPONSE', message: '规则列表响应格式无效' } };
    }
    return response;
  }, { source });
}

/**
 * 同步成功后刷新完整规则列表，保留后端响应中的 total 等字段。
 * @returns {Promise<Object>} 共享缓存服务的 Result 信封。
 */
export async function refreshRules() {
  try {
    return await loadRules('network');
  } catch (error) {
    return { ok: false, error: { code: error?.code || 'STORAGE_FAILED', message: error?.message || '规则缓存刷新失败' } };
  }
}

// 写入已经成功，附属刷新失败不能让用户误以为未写入并重复提交。
async function afterWrite() {
  try {
    await invalidate(['rules', 'ranked', 'recommendations', 'cleanup']);
  } catch (error) {
    log('rules.invalidate-failed', { code: error?.code || 'STORAGE_FAILED' }, 'warn');
  }
  const refreshed = await refreshRules();
  if (refreshed.ok && !refreshed.fromCache) return;
  try {
    await invalidate(['rules']);
  } catch (error) {
    log('rules.stale-cache-remove-failed', { code: error?.code || 'STORAGE_FAILED' }, 'warn');
  }
  log('rules.refresh-failed-after-write', { code: refreshed.error?.code || 'BACKEND_UNREACHABLE' }, 'warn');
}

export const handlers = {
  /**
   * @param {{text: string}} [payload={}]
   * @param {Object} [sender={}] Chrome 消息发送方。
   * @returns {Promise<{rules: Object[], unparsed: Object[], warnings: string[]}>}
   * @throws {Error} 后端返回的统一错误。
   */
  async [MSG.PARSE_RULE](payload = {}, sender = {}) {
    return unwrap(await callApi('POST', '/api/rules/parse', { text: payload.text }));
  },
  /**
   * @param {{rules: Object[]}} [payload={}]
   * @param {Object} [sender={}] Chrome 消息发送方。
   * @returns {Promise<{rules: Object[], ruleCount: number}>}
   * @throws {Error} 后端返回的统一错误。
   */
  async [MSG.SAVE_RULES](payload = {}, sender = {}) {
    const saved = unwrap(await callApi('POST', '/api/rules', { rules: payload.rules }));
    await afterWrite();
    return saved;
  },
  /**
   * @param {{source?: 'cache'|'network'}} [payload={}]
   * @param {Object} [sender={}] Chrome 消息发送方。
   * @returns {Promise<{rules: Object[], fromCache: boolean, offline: boolean, cachedAt: number|null}>}
   * @throws {Error} 保留 API 或缓存错误的 code 和 message，由 CORE 包装信封。
   */
  async [MSG.LIST_RULES](payload = {}, sender = {}) {
    const result = await loadRules(payload?.source ?? 'network');
    if (!result.ok) throw Object.assign(new Error(result.error.message), result.error);
    return {
      rules: result.data.rules,
      fromCache: result.fromCache === true,
      offline: result.offline === true,
      cachedAt: result.cachedAt ?? null,
    };
  },
  /**
   * @param {{id: string}} [payload={}]
   * @param {Object} [sender={}] Chrome 消息发送方。
   * @returns {Promise<{id: string, deleted: boolean, ruleCount: number}>}
   * @throws {Error} 后端返回的统一错误。
   */
  async [MSG.DELETE_RULE](payload = {}, sender = {}) {
    const result = unwrap(await callApi('DELETE', `/api/rules/${encodeURIComponent(payload.id)}`));
    await afterWrite();
    return { id: result.deleted, deleted: true, ruleCount: result.ruleCount };
  },
  /**
   * @param {{id: string, enabled: boolean}} [payload={}]
   * @param {Object} [sender={}] Chrome 消息发送方。
   * @returns {Promise<{rule: Object}>}
   * @throws {Error} 后端返回的统一错误。
   */
  async [MSG.TOGGLE_RULE](payload = {}, sender = {}) {
    const rule = unwrap(await callApi('PATCH', `/api/rules/${encodeURIComponent(payload.id)}`, { enabled: payload.enabled }));
    await afterWrite();
    return { rule };
  },
};
