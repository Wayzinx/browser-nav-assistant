import { MSG } from '../../shared/messages.js';
import { SK } from '../../shared/storage-keys.js';
import { handlers as importantHandlers } from '../handlers/important.js';
import { callApi } from './api-client.js';
import { invalidate } from './cache.js';
import { getPrivacyConfig } from './privacy-config.js';
import { classifyUrl } from './privacy.js';
import { storageRemove, storageSet } from './storage.js';

// @code C-FE-MENU-01
function menuOperation(operation) {
  return new Promise((resolve, reject) => {
    operation(() => {
      // create 的同步返回值不能代表注册成功，lastError 也只能在回调内读取。
      const error = chrome.runtime.lastError;
      if (error) {
        reject(Object.assign(new Error(error.message || '右键菜单注册失败'), { code: 'CONTEXT_MENU_FAILED' }));
      } else {
        resolve();
      }
    });
  });
}

async function saveAddAction(result) {
  await storageSet(SK.LAST_MENU_ACTION, {
    kind: 'add',
    accepted: result.accepted,
    reason: result.reason,
    at: Date.now(),
  });
}

/**
 * 由既有 onInstalled 监听器调用，先清理旧菜单，再等待两项注册完成。
 * @returns {Promise<void>}
 */
// @code C-FE-MENU-01
export async function registerContextMenus() {
  await menuOperation((done) => chrome.contextMenus.removeAll(done));
  for (const [id, title] of [['nav-add', '添加到分析'], ['nav-important', '标记为重要']]) {
    await menuOperation((done) => chrome.contextMenus.create({
      id,
      title,
      contexts: ['page'],
      documentUrlPatterns: ['http://*/*', 'https://*/*'],
    }, done));
  }
}

/**
 * 只分发本模块的菜单；无痕事件在进入任何上传路径前拒绝。
 * @param {Object} info Chrome 菜单点击事件。
 * @param {Object} tab 事件所属标签页。
 * @returns {Promise<Object|void>}
 */
// @code C-FE-MENU-01
export async function onMenuClick(info, tab) {
  if (!['nav-add', 'nav-important'].includes(info?.menuItemId)) return;
  const url = info.pageUrl ?? tab?.url;
  const title = tab?.title ?? '';
  if (info.menuItemId === 'nav-important') {
    // 复用重要操作入口，也让无痕拒收经过同一套结果清理和记录流程。
    return importantHandlers[MSG.MARK_IMPORTANT]({ url, title, important: true }, { tab });
  }
  if (tab?.incognito === true) {
    // 消息契约仅含 system / sensitive；无痕拒绝归入不可采集页面，不保存 URL。
    const result = { accepted: false, reason: 'system' };
    await saveAddAction(result);
    return result;
  }
  return addToAnalysis(url, title);
}

/**
 * 菜单与 popup 共用的添加路径；只保存不含 URL 的操作结果。
 * @param {string} url 当前页 URL。
 * @param {string} title 页面标题。
 * @returns {Promise<{accepted: boolean, reason: string|null, created?: boolean, pageCount?: number}>}
 */
// @code C-FE-MENU-01
export async function addToAnalysis(url, title) {
  // 新操作失败时不能在下次打开 popup 后重放上一次的成功提示。
  await storageRemove(SK.LAST_MENU_ACTION);
  const privacy = await getPrivacyConfig();
  const classification = classifyUrl(url, privacy.enabled === false ? [] : privacy.keywords);
  if (!classification.uploadable) {
    const result = { accepted: false, reason: classification.reason === 'sensitive' ? 'sensitive' : 'system' };
    await saveAddAction(result);
    return result;
  }
  const response = await callApi('POST', '/api/pages/manual', { url, title });
  if (!response.ok) throw Object.assign(new Error(response.error.message), response.error);
  if (typeof response.data?.accepted !== 'boolean') {
    throw Object.assign(new Error('添加到分析响应无效'), { code: 'INVALID_RESPONSE' });
  }
  const result = {
    accepted: response.data.accepted,
    reason: response.data.accepted ? null : 'sensitive',
    created: response.data.created,
    pageCount: response.data.pageCount,
  };
  await saveAddAction(result);
  if (result.accepted) await invalidate(['ranked', 'cleanup']);
  return result;
}
