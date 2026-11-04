import { MSG } from '../../shared/messages.js';
import { SK } from '../../shared/storage-keys.js';
import { log } from '../../shared/logger.js';
import { callApi, getApiBase } from '../services/api-client.js';
import { invalidate } from '../services/cache.js';
import { storagePatch, storageRemove, storageSet } from '../services/storage.js';

// @code C-FE-CLEAN-02
async function postAction(path, body) {
  const result = await callApi('POST', path, body);
  if (result.ok) return result.data;
  let error = result.error;
  if (result.status === 404 && error.code === 'NOT_FOUND') {
    try {
      await invalidate(['cleanup']);
    } catch (localError) {
      log('cleanup.stale-invalidation-failed', { code: localError?.code || 'STORAGE_FAILED' }, 'warn');
    }
    error = { ...error, message: '建议已失效，已刷新列表' };
  } else if (['BACKEND_UNREACHABLE', 'TIMEOUT'].includes(error.code)) {
    try {
      const base = await getApiBase();
      error = { ...error, message: error.code === 'TIMEOUT'
        ? `连接后端 ${base} 超时，请检查后端服务`
        : `无法连接后端 ${base}，请检查后端服务和 API 地址` };
    } catch { /* 保留网络错误，不以配置读取错误取代操作失败。 */ }
  }
  throw Object.assign(new Error(error.message), error);
}

async function finishAction(undoToken, clearUndo = false) {
  let failure;
  try {
    if (undoToken) await storageSet(SK.LAST_CLEANUP_ACTION, { ...undoToken, at: Date.now() });
    else if (clearUndo) await storageRemove(SK.LAST_CLEANUP_ACTION);
  } catch (error) {
    failure = error;
  }
  try {
    await invalidate(['ranked', 'recommendations', 'cleanup']);
  } catch (error) {
    failure ??= error;
  }
  if (failure) {
    // POST 已成功，不能把本地持久化故障当作后端未执行，更不能自动重试写请求。
    throw Object.assign(new Error('操作已成功，但本地状态更新失败，请刷新列表'), {
      code: 'LOCAL_STATE_FAILED', details: { applied: true, ...(undoToken ? { undoToken } : {}) },
    });
  }
}

/** 整理写操作使用真实后端响应，失败时不创建撤销记录。 */
export const handlers = {
  /**
   * @param {{urls: string[]}} [payload={}] 要归档的 URL。
   * @returns {Promise<{archived: number, notFound: number, undoToken: Object}>} 归档结果。
   */
  async [MSG.CLEANUP_ARCHIVE](payload = {}) {
    const data = await postAction('/api/pages/archive', { urls: payload.urls });
    const undoToken = { kind: 'archive', urls: [...payload.urls] };
    await finishAction(undoToken);
    return { archived: data.affected, notFound: data.notFound, undoToken };
  },
  /**
   * @param {{urls: string[]}} [payload={}] 撤销记录中的 URL。
   * @returns {Promise<{unarchived: number, notFound: number}>} 撤销结果。
   */
  async [MSG.CLEANUP_UNARCHIVE](payload = {}) {
    const data = await postAction('/api/pages/unarchive', { urls: payload.urls });
    await finishAction(null, true);
    return { unarchived: data.affected, notFound: data.notFound };
  },
  /**
   * @param {{urls: string[], keepUrl: string}} [payload={}] 后端返回的重复分组。
   * @returns {Promise<{archived: number, keepUrl: string, undoToken: Object}>} 合并结果。
   */
  async [MSG.CLEANUP_MERGE](payload = {}) {
    const data = await postAction('/api/pages/merge', { urls: payload.urls, keepUrl: payload.keepUrl });
    const undoToken = { kind: 'merge', urls: payload.urls.filter((url) => url !== payload.keepUrl) };
    await finishAction(undoToken);
    return { archived: data.merged, keepUrl: data.keepUrl, undoToken };
  },
  /**
   * @param {{key: string}} [payload={}] 后端建议的原始 key。
   * @returns {Promise<{ignoredAt: number}>} 已持久化的忽略时间。
   */
  async [MSG.CLEANUP_IGNORE](payload = {}) {
    if (typeof payload.key !== 'string' || !payload.key.trim()) {
      throw Object.assign(new Error('建议标识不能为空'), { code: 'VALIDATION_FAILED' });
    }
    const ignoredAt = Date.now();
    // 多个建议同时忽略时共用 CORE 的逐 key 更新队列，避免后写覆盖先写。
    await storagePatch(SK.IGNORED_SUGGESTIONS, (current) => ({ ...current, [payload.key]: ignoredAt }));
    await finishAction(null);
    return { ignoredAt };
  },
};
