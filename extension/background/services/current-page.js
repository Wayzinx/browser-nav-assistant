import { isHttpUrl, isOwnExtensionUrl } from '../../shared/url.js';

// @code C-FE-CTX-01
function isCandidate(tab) {
  return !tab.incognito && !isOwnExtensionUrl(tab.url);
}

function toPage(tab) {
  if (!tab) return { url: null, title: '', isSystem: true };
  return {
    tabId: tab.id,
    url: tab.url ?? null,
    title: tab.title || tab.url || '',
    isSystem: !isHttpUrl(tab.url),
  };
}

/**
 * 优先使用非无痕、非本插件的活动页；不可用时跨普通窗口选择最近网页，再回退系统页。
 * @returns {Promise<{url: string|null, title: string, isSystem: boolean, tabId?: number}>}
 */
// @code C-FE-CTX-01
export async function resolveCurrentPage() {
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (active && isCandidate(active)) return toPage(active);

  const tabs = await chrome.tabs.query({ windowType: 'normal' });
  const candidates = tabs.filter(isCandidate);
  const webTabs = candidates.filter((tab) => isHttpUrl(tab.url));
  return toPage(pickByLastAccessed(webTabs) || pickByLastAccessed(candidates));
}

/**
 * 不改变输入顺序；缺少 lastAccessed 时按 0 参与比较，再以较大 id 决胜。
 * @param {Object[]} tabs 标签页，按 lastAccessed / id 选择。
 * @returns {Object|null}
 */
// @code C-FE-CTX-01
export function pickByLastAccessed(tabs) {
  return tabs.reduce((latest, tab) => {
    if (!latest) return tab;
    const time = tab.lastAccessed ?? 0;
    const latestTime = latest.lastAccessed ?? 0;
    return time > latestTime || (time === latestTime && tab.id > latest.id) ? tab : latest;
  }, null);
}
