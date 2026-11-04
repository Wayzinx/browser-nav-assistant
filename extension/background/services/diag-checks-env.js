import { storageGet, storageSet, storageRemove } from './storage.js';
import { SK } from '../../shared/storage-keys.js';
import { DAY_MS } from '../../shared/constants.js';

const permissionHints = (permission) => [
  `检查 manifest 的 permissions 是否包含 ${permission}`,
  '在 chrome://extensions 中重新加载插件',
];

async function probe(id, name, hint, check) {
  try {
    return { id, name, status: 'ok', hint: [], ...await check() };
  } catch (error) {
    return { id, name, status: 'fail', detail: error?.message || '检查失败，请重新检测', hint };
  }
}

async function requirePermission(permission) {
  const allowed = await chrome.permissions.contains({ permissions: [permission] });
  if (!allowed) throw new Error(`缺少 ${permission} 权限`);
}

// @code C-FE-DIAG-04
/** @returns {Promise<object>} 权限声明与真实标签页 URL 读取检查。 */
export async function checkTabs() {
  return probe('tabs', 'tabs 权限', permissionHints('tabs'), async () => {
    await requirePermission('tabs');
    const tabs = await chrome.tabs.query({});
    if (!Array.isArray(tabs)) throw new Error('tabs.query 返回值无效');
    const readable = tabs.some((tab) => /^https?:\/\//i.test(tab.url || ''));
    const systemOnly = tabs.every((tab) => typeof tab.url === 'string' && !/^https?:\/\//i.test(tab.url));
    if (!readable && !systemOnly) throw new Error('tabs.query 无法读取标签页 URL');
    return { detail: readable ? 'tabs 权限已授权，标签页 URL 可读' : 'tabs 权限已授权，当前仅有系统页或没有标签页' };
  });
}

// @code C-FE-DIAG-04
/** @returns {Promise<object>} history 权限与真实历史查询检查，不保留浏览记录。 */
export async function checkHistory() {
  return probe('history', 'history 权限', permissionHints('history'), async () => {
    await requirePermission('history');
    const entries = await chrome.history.search({ text: '', startTime: Date.now() - DAY_MS, maxResults: 1 });
    if (!Array.isArray(entries)) throw new Error('history.search 返回值无效');
    return { detail: 'history 权限已授权，历史查询可用' };
  });
}

// @code C-FE-DIAG-04
/** @returns {Promise<object>} activeTab 权限检查。 */
export async function checkActiveTab() {
  return probe('activeTab', 'activeTab 权限', permissionHints('activeTab'), async () => {
    await requirePermission('activeTab');
    return { detail: 'activeTab 权限已授权' };
  });
}

// @code C-FE-DIAG-05
/** @returns {Promise<object>} 写读比对及实际字节数；任何分支均尝试删除探测 key。 */
export async function checkStorage() {
  return probe('storage', 'storage 可用', ['检查磁盘空间或 storage 配额', '在 chrome://extensions 中重新加载插件后重试'], async () => {
    const value = `${Date.now()}_${Math.random()}`;
    try {
      await storageSet(SK.DIAG_PROBE, value);
      if (await storageGet(SK.DIAG_PROBE) !== value) throw new Error('storage 写入与读取结果不一致');
    } finally {
      await storageRemove(SK.DIAG_PROBE);
    }
    const bytes = await chrome.storage.local.getBytesInUse(null);
    if (!Number.isFinite(bytes) || bytes < 0) throw new Error('无法读取 storage 已用字节数');
    return { detail: `storage 写入、读取和删除正常，已使用 ${bytes} 字节`, value: bytes };
  });
}

// @code C-FE-DIAG-08
/** @returns {Promise<object>} 无痕访问授权提示，授权不会改变不采集无痕数据的策略。 */
export async function checkIncognito() {
  const item = { id: 'incognito', name: '无痕模式', status: 'info', hint: [] };
  try {
    const allowed = await chrome.extension.isAllowedIncognitoAccess();
    return { ...item, detail: `无痕访问${allowed ? '已授权' : '未授权'}；无痕窗口的数据不会被采集` };
  } catch {
    return { ...item, detail: '无法读取无痕访问授权；无痕窗口的数据不会被采集' };
  }
}
