import { MSG } from '../../shared/messages.js';
import { DEFAULTS } from '../../shared/constants.js';
import { el, formatScore } from '../lib/dom.js';
import { createRefreshQueue, createSnapshotGate, loadCacheFirst } from '../lib/cache-first.js';

// @code C-FE-RANK-02
/**
 * 安全渲染首页前五项；仅截取后端顺序，不重新计算排序或筛选。
 * @param {Object} result 消息响应信封，或 { loading: true }。
 * @returns {HTMLElement} 首页排序区块。
 */
export function renderRankedHome(result) {
  const loading = result?.loading === true;
  const success = result?.ok === true;
  const pages = success ? result.data.pages.slice(0, 5) : [];
  const error = !loading && !success;
  return el('section', { class: 'view-block' },
    el('h2', {}, '历史排序 Top 5'),
    el('p', { 'data-testid': 'home-ranked-loading', class: 'state', hidden: !loading, role: 'status' }, '正在加载历史排序…'),
    el('p', { 'data-testid': 'home-ranked-empty', class: 'state', hidden: !success || pages.length > 0 }, '还没有数据，点击上方「同步浏览器上下文」开始'),
    el('div', { 'data-testid': 'home-ranked-error', class: 'state error', hidden: !error, role: 'alert' },
      el('p', {}, result?.error?.message || '无法读取历史排序，请运行诊断排查。'),
      el('button', { 'data-testid': 'error-diag-link', type: 'button', class: 'link' }, '诊断'),
    ),
    el('ul', { 'data-testid': 'home-ranked-list', class: 'list', hidden: !success || pages.length === 0 },
      pages.map((page) => el('li', { 'data-testid': 'home-ranked-item', class: 'ranked-home-item' },
        el('div', { class: 'ranked-home-heading' },
          el('span', { 'data-testid': 'ranked-item-title', class: 'ranked-home-title' }, page.title),
          el('span', { 'data-testid': 'ranked-item-score', class: 'ranked-home-score' }, formatScore(page.score)),
        ),
        el('span', { 'data-testid': 'ranked-item-url', class: 'muted ranked-home-url' }, page.url),
        el('p', { 'data-testid': 'ranked-item-reason', class: 'ranked-home-reason' }, page.reason),
      )),
    ),
  );
}

/**
 * 按共享缓存优先流程加载首页，并消费持久化缓存变更。
 * @param {HTMLElement} slotEl 本区块插槽。
 * @param {Readonly<object>} ctx 外壳上下文。
 * @returns {Function} 取消订阅并阻止卸载后的异步渲染。
 */
export function mount(slotEl, ctx) {
  let active = true;
  let latestTime = 0;
  const snapshots = createSnapshotGate();
  const render = (result) => {
    if (active) slotEl.replaceChildren(renderRankedHome(result));
  };
  const queue = createRefreshQueue(async (isCurrent, fresh) => {
    const stage = snapshots.begin();
    const receive = (result) => {
      if (isCurrent() && stage.accepts() && !(fresh && result.ok && result.data.fromCache)) {
        if (result.ok) latestTime = Math.max(latestTime, result.data.cachedAt ?? 0);
        render(result);
      }
    };
    receive.isActive = () => active;
    receive.fresh = fresh;
    receive.cacheReady = () => { if (isCurrent()) stage.ready(); };
    render({ loading: true });
    try {
      await loadCacheFirst(ctx, MSG.GET_RANKED, { limit: DEFAULTS.RANKED_LIMIT }, receive);
    } catch (error) {
      if (isCurrent() && stage.accepts()) render({ ok: false, error: { code: error?.code || 'INTERNAL', message: error?.message || '排序加载失败' } });
    }
  });
  const offCache = ctx.bus.on('storage:cache', ({ newValue, oldValue }) => {
    const cached = newValue?.ranked;
    if (JSON.stringify(cached?.data) === JSON.stringify(oldValue?.ranked?.data)) return;
    if (!cached) {
      latestTime = 0;
      snapshots.reset();
      void queue.invalidate();
      return;
    }
    if (!queue.acceptsSnapshot()) return;
    if (!Array.isArray(cached.data?.pages) || cached.cachedAt < latestTime) return;
    // 消费已持久化的变更，不因自身写缓存再次发起网络请求。
    snapshots.snapshot(() => {
      latestTime = Math.max(latestTime, cached.cachedAt);
      render({ ok: true, data: {
        ...cached.data, fromCache: true, cachedAt: cached.cachedAt,
        offline: ctx.getState().connection?.status === 'offline',
      } });
    });
  });
  void queue.request();
  return () => {
    active = false;
    queue.dispose();
    snapshots.dispose();
    offCache();
    slotEl.replaceChildren();
  };
}
