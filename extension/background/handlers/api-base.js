import { MSG } from '../../shared/messages.js';
import { SK } from '../../shared/storage-keys.js';
import { DEFAULT_API_BASE } from '../../shared/constants.js';
import { storageGet, storageSet, storagePatch } from '../services/storage.js';
import { getApiBase } from '../services/api-client.js';
import { resetCursor } from '../services/cursor.js';

// @code C-FE-DIAG-03
/** @param {string} apiBaseUrl 输入地址。 @returns {string} 与 api-client 相同的规范化地址。 @throws {Error} INVALID_URL。 */
export function validateApiBaseUrl(apiBaseUrl) {
  try {
    if (typeof apiBaseUrl !== 'string' || !apiBaseUrl.trim()) throw new Error();
    const url = new URL(apiBaseUrl.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error();
    }
    return url.href.replace(/\/+$/, '');
  } catch {
    throw Object.assign(new Error('地址格式错误'), { code: 'INVALID_URL' });
  }
}

async function saveBase(apiBaseUrl) {
  const normalized = validateApiBaseUrl(apiBaseUrl);
  const previous = await storageGet(SK.API_BASE_URL, DEFAULT_API_BASE);
  const warnings = [];
  let permissionGranted = false;
  try {
    permissionGranted = await chrome.permissions.contains({ origins: [`${new URL(normalized).origin}/*`] });
  } catch {
    warnings.push('无法确认地址授权，请检查 manifest 的 host_permissions');
  }
  if (!permissionGranted) warnings.push('该地址未授权，请在 manifest 的 host_permissions 中加入该地址并重新加载插件');
  await storageSet(SK.API_BASE_URL, normalized);
  if (previous !== normalized) {
    try {
      await resetCursor();
    } catch (error) {
      warnings.push(`地址已保存，但同步游标重置失败：${error?.message || '请重新加载插件后全量同步'}`);
    }
    try {
      await storagePatch(SK.CONNECTION, { status: 'unknown', since: Date.now(), lastCheckedAt: Date.now(), lastErrorCode: null });
    } catch {
      warnings.push('地址已保存，但连接状态暂未更新，请重新检测');
    }
  }
  return { apiBaseUrl: normalized, permissionGranted, warning: warnings.length ? warnings.join('；') : null };
}

// @code C-FE-DIAG-03
/** API 地址消息实现；统一错误信封由 CORE dispatchMessage 负责。 */
export const handlers = {
  /** @param {object} [payload={}] @param {object} [sender={}] @returns {Promise<{apiBaseUrl:string,isDefault:boolean}>} */
  async [MSG.GET_API_BASE_URL](payload = {}, sender = {}) {
    const apiBaseUrl = await getApiBase();
    return { apiBaseUrl, isDefault: apiBaseUrl === DEFAULT_API_BASE };
  },
  /** @param {{apiBaseUrl:string}} [payload={}] @param {object} [sender={}] @returns {Promise<object>} 保存结果与真实授权/游标告警。 */
  async [MSG.SET_API_BASE_URL](payload = {}, sender = {}) {
    return saveBase(payload.apiBaseUrl);
  },
};
