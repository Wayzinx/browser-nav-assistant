import { el } from '../lib/dom.js';
import { MSG } from '../../shared/messages.js';
import { isOwnExtensionUrl } from '../../shared/url.js';

// @code C-FE-CTX-05
function renderStatus(error) {
  return el('div', { class: 'current-page-state', role: error ? 'alert' : 'status' },
    el('p', { 'data-testid': 'current-page-title' }, error ? '当前页面读取失败' : '正在读取当前页面…'),
    el('p', { 'data-testid': 'current-page-url', hidden: true }),
    error ? el('p', { class: 'state error' },
      `${error.code || 'INTERNAL'}：${error.message || '无法读取当前页面，请重新打开插件。'}`,
    ) : null,
    error ? el('button', { 'data-testid': 'error-diag-link', type: 'button', class: 'link' }, '诊断') : null,
  );
}

/**
 * 获取当前页面并广播冻结载荷；卸载后不再渲染或通知其他区块。
 * @param {HTMLElement} slotEl 本区块插槽。
 * @param {Readonly<object>} ctx 外壳上下文。
 * @returns {Function} 本次挂载的卸载函数。
 */
// @code C-FE-CTX-05
export function mount(slotEl, ctx) {
  let mounted = true;
  let block = renderStatus();
  slotEl.replaceChildren(block);
  async function load() {
    try {
      const response = await ctx.send(MSG.GET_CONTEXT, {});
      if (!mounted) return;
      if (!response.ok) throw response.error;
      const page = response.data.currentPage;
      block = renderCurrentPage(page);
      slotEl.replaceChildren(block);
      ctx.bus.emit('current-page:changed', {
        url: page.url,
        title: page.title,
        isSystem: page.isSystem,
        uploadable: Boolean(page.url) && !page.isSystem && page.badge === null,
      });
    } catch (error) {
      if (!mounted) return;
      block = renderStatus(error || { code: 'INTERNAL', message: '当前页面读取失败。' });
      slotEl.replaceChildren(block);
    }
  }
  void load();
  return () => {
    mounted = false;
    block.remove();
  };
}

/**
 * 完整标题与 URL 作为文本渲染，系统页不生成任何可采集动作。
 * @param {{url: string|null, title: string, isSystem: boolean, badge: Object|null}} page 当前页面。
 * @returns {HTMLElement} 当前页面内容。
 */
// @code C-FE-CTX-05
export function renderCurrentPage(page) {
  if (isOwnExtensionUrl(page.url)) {
    throw Object.assign(new Error('当前页面不能是插件自身页面。'), { code: 'INVALID_RESPONSE' });
  }
  return el('div', { class: 'current-page', 'data-system': page.isSystem },
    el('p', { 'data-testid': 'current-page-title', class: 'current-page-title' },
      page.title || (page.isSystem ? '系统页面' : page.url),
    ),
    el('p', { 'data-testid': 'current-page-url', class: 'current-page-url', hidden: !page.url }, page.url),
    page.isSystem ? el('span', {
      'data-testid': 'current-page-system-badge', class: 'badge current-page-system-badge',
    }, '系统页 · 不采集') : null,
  );
}
