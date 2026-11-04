import { el, formatTime } from '../lib/dom.js';
import { MSG } from '../../shared/messages.js';

// @code C-FE-CTX-06
const PRIVACY_SOURCES = Object.freeze({ server: '后端', cache: '本地缓存', default: '内置默认' });
const TAB_IDS = Object.freeze({
  item: 'context-tab-item',
  title: 'context-tab-title',
  url: 'context-tab-url',
  badge: 'context-tab-badge',
});
const HISTORY_IDS = Object.freeze({
  item: 'context-history-item',
  title: 'context-history-title',
  url: 'context-history-url',
  badge: 'context-history-badge',
});

function renderLoading() {
  return el('p', { 'data-testid': 'context-loading', class: 'state', role: 'status' }, '正在读取浏览器上下文…');
}

function renderError(error) {
  return el('div', { 'data-testid': 'context-error', class: 'state error', role: 'alert' },
    el('p', {}, `${error?.code || 'INTERNAL'}：${error?.message || '上下文读取失败，请重新切到本页签重试。'}`),
    el('button', { 'data-testid': 'error-diag-link', type: 'button', class: 'link' }, '诊断'),
  );
}

function renderItem(item, isHistory = false) {
  const ids = isHistory ? HISTORY_IDS : TAB_IDS;
  const row = el('li', {
    'data-testid': ids.item, class: 'context-item', 'data-kind': item.badge?.kind ?? 'normal',
  },
    el('p', { 'data-testid': ids.title, class: 'context-title' }, item.title),
    el('p', { 'data-testid': ids.url, class: 'context-url' }, item.url),
  );
  if (isHistory) {
    row.append(el('time', { 'data-testid': 'context-history-time', 'data-ts': item.lastVisitTime },
      formatTime(item.lastVisitTime),
    ));
  }
  if (item.badge) {
    row.append(el('span', { 'data-testid': ids.badge, class: 'badge context-badge' }, item.badge.label));
  }
  return row;
}

function renderContext(data) {
  const { privacy } = data;
  return el('section', { class: 'view-block context-content' },
    el('h2', {}, '浏览器上下文'),
    el('p', { 'data-testid': 'context-privacy-keywords', class: 'muted' },
      `敏感关键词：${privacy.keywords.join('、') || '无'} · 来源：${PRIVACY_SOURCES[privacy.source]}`
        + (privacy.enabled ? '' : ' · 关键词过滤已关闭'),
    ),
    renderTabList(data.tabs),
    renderHistoryList(data.history, data.historyQuery),
  );
}

/**
 * 切入上下文时刷新；只允许最后一次请求更新当前挂载的插槽。
 * @param {HTMLElement} slotEl 本区块插槽。
 * @param {Readonly<object>} ctx 外壳上下文。
 * @returns {Function} 本次挂载的卸载函数。
 */
// @code C-FE-CTX-06
export function mount(slotEl, ctx) {
  let mounted = true;
  let version = 0;
  let block = renderLoading();
  slotEl.replaceChildren(block);
  async function refresh() {
    if (!mounted) return;
    const requestVersion = ++version;
    block = renderLoading();
    slotEl.replaceChildren(block);
    try {
      const response = await ctx.send(MSG.GET_CONTEXT, {});
      if (!mounted || requestVersion !== version) return;
      if (!response.ok) throw response.error;
      block = renderContext(response.data);
    } catch (error) {
      if (!mounted || requestVersion !== version) return;
      block = renderError(error);
    }
    slotEl.replaceChildren(block);
  }
  const off = ctx.bus.on('nav:tab', ({ tab }) => {
    if (tab === 'context') void refresh();
  });
  if (ctx.getState().activeTab === 'context') void refresh();
  return () => {
    mounted = false;
    version += 1;
    off();
    block.remove();
  };
}

/**
 * 展示当前窗口所有可见记录，不截断标题、URL，也不隐藏系统页。
 * @param {Object[]} tabs 带有隐私标注的当前窗口标签页。
 * @returns {HTMLElement} 标签页列表区块。
 */
// @code C-FE-CTX-06
export function renderTabList(tabs) {
  return el('section', { class: 'context-section' },
    el('h2', {}, '当前窗口标签页'),
    el('ul', { 'data-testid': 'context-tabs-list', class: 'list' },
      tabs.map((tab) => renderItem(tab)),
    ),
    tabs.length === 0 ? el('p', { 'data-testid': 'context-tabs-empty', class: 'state' },
      '还没有数据，点击上方「同步浏览器上下文」开始',
    ) : null,
  );
}

/**
 * 展示真实访问时间与实际查询参数，排序不改变传入数组。
 * @param {Object[]} history 带有隐私标注的历史记录。
 * @param {{startTime: number, maxResults: number}} query 实际历史查询参数。
 * @returns {HTMLElement} 历史列表区块。
 */
// @code C-FE-CTX-06
export function renderHistoryList(history, query) {
  const ordered = [...history].sort((left, right) => (right.lastVisitTime ?? 0) - (left.lastVisitTime ?? 0));
  return el('section', { class: 'context-section' },
    el('div', { class: 'row' },
      el('h2', {}, '最近浏览历史'),
      el('span', { 'data-testid': 'context-history-count', class: 'badge' }, ordered.length),
    ),
    el('p', {
      'data-testid': 'context-history-query', class: 'muted',
      'data-start-time': query.startTime, 'data-max-results': query.maxResults,
    }, `自 ${new Date(query.startTime).toLocaleString('zh-CN')} 起 · 最多 ${query.maxResults} 条`),
    el('ul', { 'data-testid': 'context-history-list', class: 'list' },
      ordered.map((item) => renderItem(item, true)),
    ),
    ordered.length === 0 ? el('p', { 'data-testid': 'context-history-empty', class: 'state' },
      '还没有数据，点击上方「同步浏览器上下文」开始',
    ) : null,
  );
}
