import { MSG } from '../../shared/messages.js';
import { SK } from '../../shared/storage-keys.js';
import { callApi } from '../services/api-client.js';
import { invalidate } from '../services/cache.js';
import { addToAnalysis } from '../services/context-menu.js';
import { getPrivacyConfig } from '../services/privacy-config.js';
import { classifyUrl } from '../services/privacy.js';
import { storageGet, storagePatch, storageRemove, storageSet } from '../services/storage.js';

// @code C-FE-MENU-02
async function readImportantUrls() {
  const urls = await storageGet(SK.IMPORTANT_URLS, []);
  return Array.isArray(urls) ? urls : [];
}

function rejectedImportant(url, importantUrls, reason) {
  return { accepted: false, reason, important: importantUrls.includes(url), importantUrls };
}

function isIncognito(sender) {
  return sender?.tab?.incognito === true || sender?.incognito === true;
}

// @code C-FE-MENU-02
async function runImportantAction(operation) {
  // 在读取隐私配置等依赖之前清理，异常不能使重开 popup 重放旧的成功结果。
  await storageRemove(SK.LAST_MENU_ACTION);
  const result = await operation();
  await storageSet(SK.LAST_MENU_ACTION, {
    kind: 'important',
    accepted: result.accepted,
    reason: result.reason,
    at: Date.now(),
  });
  return result;
}

async function updateImportant({ url, title, important }) {
  const privacy = await getPrivacyConfig();
  const classification = classifyUrl(url, privacy.enabled === false ? [] : privacy.keywords);
  const previousUrls = await readImportantUrls();
  if (!classification.uploadable) {
    return rejectedImportant(url, previousUrls, classification.reason === 'sensitive' ? 'sensitive' : 'system');
  }
  const response = await callApi('POST', '/api/pages/important', { url, title, important });
  if (!response.ok) throw Object.assign(new Error(response.error.message), response.error);
  if (typeof response.data?.accepted !== 'boolean'
    || (response.data.accepted && typeof response.data.isImportant !== 'boolean')) {
    throw Object.assign(new Error('重要标记响应无效'), { code: 'INVALID_RESPONSE' });
  }
  if (!response.data.accepted) return rejectedImportant(url, previousUrls, 'sensitive');
  const savedUrls = await storagePatch(SK.IMPORTANT_URLS, (current) => {
    // 使用 CORE 的同 key 队列读改写，避免同时标记不同页面时丢失其他 URL。
    const urls = new Set(Array.isArray(current) ? current : []);
    if (response.data.isImportant) urls.add(url);
    else urls.delete(url);
    return [...urls];
  });
  await invalidate(['ranked', 'recommendations', 'cleanup']);
  return { accepted: true, reason: null, important: response.data.isImportant, importantUrls: savedUrls };
}

/**
 * 后端确认前保留原重要状态；统一清理旧操作结果并保存本次成功或拒收元数据。
 * @param {{url: string, title: string, important: boolean}} options 标记输入。
 * @returns {Promise<{accepted: boolean, reason?: string|null, important: boolean, importantUrls: string[]}>}
 */
// @code C-FE-MENU-02
export async function markImportant({ url, title, important = true } = {}) {
  return runImportantAction(() => updateImportant({ url, title, important }));
}

export const handlers = {
  /**
   * @param {{url: string, title: string, important: boolean}} [payload={}]
   * @param {Object} [sender={}] Chrome 消息发送方。
   * @returns {Promise<{accepted: boolean, reason: string|null, important: boolean, importantUrls: string[]}>}
   */
  // @code C-FE-MENU-02
  async [MSG.MARK_IMPORTANT](payload = {}, sender = {}) {
    if (isIncognito(sender)) {
      return runImportantAction(async () => rejectedImportant(payload.url, await readImportantUrls(), 'system'));
    }
    return markImportant(payload);
  },
  /**
   * @param {{url: string, title: string}} [payload={}]
   * @param {Object} [sender={}] Chrome 消息发送方。
   * @returns {Promise<{accepted: boolean, reason: string|null, created?: boolean, pageCount?: number}>}
   */
  // @code C-FE-MENU-02
  async [MSG.ADD_TO_ANALYSIS](payload = {}, sender = {}) {
    if (isIncognito(sender)) {
      const result = { accepted: false, reason: 'system' };
      await storageSet(SK.LAST_MENU_ACTION, { kind: 'add', ...result, at: Date.now() });
      return result;
    }
    return addToAnalysis(payload.url, payload.title);
  },
};
