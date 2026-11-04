import { MSG } from '../../shared/messages.js';
import { el } from '../lib/dom.js';
import { createRefreshQueue, loadCacheFirst } from '../lib/cache-first.js';
import { observeCleanupCache } from '../lib/cleanup-cache.js';

// @code C-FE-CLEAN-03
/**
 * 安全渲染整理摘要与加载、空、错误状态；离线状态由外壳横幅展示。
 * @param {Object} result 消息响应信封或 { loading: true }。
 * @returns {HTMLElement} 首页整理区块。
 */
export function renderCleanupSummary(result) {
  const success = result?.ok === true;
  const loading = result?.loading === true;
  const summary = success ? result.data.summary : null;
  const empty = success && result.data.suggestions.length === 0;
  return el('section', { class: 'view-block' },
    el('h2', {}, '整理建议'),
    el('p', { 'data-testid': 'home-cleanup-loading', class: 'state', hidden: !loading, role: 'status' }, '正在加载整理建议…'),
    el('div', { 'data-testid': 'home-cleanup-error', class: 'state error', hidden: loading || success, role: 'alert' },
      el('p', {}, result?.error?.message || '无法读取整理建议，请运行诊断排查。'),
      el('button', { 'data-testid': 'error-diag-link', type: 'button', class: 'link' }, '诊断'),
    ),
    el('p', { 'data-testid': 'home-cleanup-empty', class: 'state', hidden: !empty }, '还没有整理建议，点击上方「同步浏览器上下文」开始'),
    el('button', { 'data-testid': 'home-cleanup-summary', type: 'button', class: 'cleanup-summary', hidden: !success, 'aria-label': '查看整理建议' },
      el('span', { 'data-testid': 'home-cleanup-archive-count' }, `归档 ${summary?.archive ?? 0}`),
      el('span', { 'data-testid': 'home-cleanup-merge-count' }, `重复 ${summary?.merge ?? 0}`),
      el('span', { 'data-testid': 'home-cleanup-keep-count' }, `保留 ${summary?.keep ?? 0}`),
    ),
  );
}

/**
 * 缓存优先加载摘要；缓存快照用与后台相同的纯函数应用忽略规则。
 * @param {HTMLElement} slotEl 本区块插槽。
 * @param {Readonly<object>} ctx 外壳上下文。
 * @returns {Function} 取消订阅并阻止卸载后的异步渲染。
 */
export function mount(slotEl, ctx) {
  let active = true;
  const render = (result) => {
    if (active) slotEl.replaceChildren(renderCleanupSummary(result));
  };
  const queue = createRefreshQueue(async (isCurrent, fresh) => {
    const stage = cache.begin();
    const receive = (result) => {
      if (isCurrent() && stage.accepts() && !(fresh && result.ok && result.data.fromCache) && cache.accepts(result)) {
        cache.note(result); render(result);
      }
    };
    receive.isActive = () => active;
    receive.fresh = fresh;
    receive.cacheReady = () => { if (isCurrent()) stage.ready(); };
    render({ loading: true });
    try {
      await loadCacheFirst(ctx, MSG.GET_CLEANUP, {}, receive);
    } catch (error) {
      if (isCurrent() && stage.accepts()) render({ ok: false, error: { message: error?.message || '整理建议加载失败' } });
    }
  });
  const cache = observeCleanupCache(ctx, render, () => { void queue.invalidate(); }, { accepts: queue.acceptsSnapshot });
  const onClick = (event) => {
    if (event.target.closest?.('[data-testid="home-cleanup-summary"]')) ctx.switchTab('cleanup');
  };
  slotEl.addEventListener('click', onClick);
  void queue.request();
  return () => {
    active = false;
    queue.dispose();
    cache.dispose();
    slotEl.removeEventListener('click', onClick);
    slotEl.replaceChildren();
  };
}
