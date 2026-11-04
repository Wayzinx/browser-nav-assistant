import { MSG } from '../../shared/messages.js';
import { isHttpUrl } from '../../shared/url.js';

// @code C-FE-REC-03
export const handlers = {
  /**
   * @param {{url: string}} [payload={}]
   * @returns {Promise<{tabId: number}>}
   */
  async [MSG.OPEN_URL](payload = {}) {
    if (!isHttpUrl(payload?.url)) {
      throw Object.assign(new Error('只能打开有效的 HTTP 或 HTTPS 地址'), { code: 'INVALID_URL' });
    }
    const tab = await chrome.tabs.create({ url: payload.url, active: true });
    return { tabId: tab.id };
  },
};
