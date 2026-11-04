import { el, formatScore } from '../lib/dom.js';
import { createRefreshQueue, createSnapshotGate, loadCacheFirst } from '../lib/cache-first.js';
import { MSG } from '../../shared/messages.js';

// @code C-FE-REC-02
function renderItem(recommendation) {
  return el('li', {},
    el('button', {
      type: 'button', 'data-testid': 'rec-item', 'data-url': recommendation.url,
      class: 'recommend-item',
    },
      el('span', { class: 'recommend-heading' },
        el('span', { 'data-testid': 'rec-item-title' }, recommendation.title || recommendation.url),
        el('span', { 'data-testid': 'rec-item-score' }, formatScore(recommendation.score)),
      ),
      el('span', { 'data-testid': 'rec-item-reason' }, recommendation.reason),
    ),
  );
}

/**
 * 将消息结果渲染为推荐区块，顺序与后端一致，不可信文本交给 el 安全渲染。
 * @param {{loading?: boolean, ok?: boolean, data?: Object, error?: Object}} [result={}] 视图状态。
 * @returns {HTMLElement} 带完整加载、空、错误状态的区块。
 */
export function renderRecommendations(result = {}) {
  const loading = result.loading === true;
  const failed = result.ok === false;
  const items = result.ok === true ? (result.data?.recommendations ?? []).slice(0, 3) : [];
  return el('section', { class: 'view-block', 'aria-busy': String(loading) },
    el('h2', {}, '下一步推荐'),
    el('p', { 'data-testid': 'rec-loading', hidden: !loading, class: 'state', role: 'status' }, '正在加载推荐…'),
    el('div', { 'data-testid': 'rec-error', hidden: !failed, class: 'state', role: 'alert' },
      result.error?.message || '无法获取推荐，请检查后端连接。',
      el('button', { 'data-testid': 'error-diag-link', type: 'button', class: 'link' }, '打开诊断'),
    ),
    el('ul', { 'data-testid': 'rec-list', class: 'list', hidden: items.length === 0 }, items.map(renderItem)),
    el('p', { 'data-testid': 'rec-empty', hidden: loading || failed || items.length > 0, class: 'state' },
      '还没有推荐，点击「同步浏览器上下文」开始',
    ),
  );
}

async function openRecommendation(button, ctx, isMounted) {
  button.disabled = true;
  try {
    const response = await ctx.send(MSG.OPEN_URL, { url: button.dataset.url });
    if (!response.ok && isMounted()) ctx.toast(response.error.message, { kind: 'error' });
  } catch {
    if (isMounted()) ctx.toast('无法打开推荐页面，请重试', { kind: 'error' });
  } finally {
    if (isMounted() && button.isConnected) button.disabled = false;
  }
}

/**
 * 在自己的插槽内挂载推荐，并在卸载或当前页变化后丢弃旧响应。
 * @param {HTMLElement} slotEl 本区块插槽。
 * @param {Readonly<object>} ctx 外壳上下文。
 * @returns {Function} 注销订阅和事件的卸载函数。
 */
export function mount(slotEl, ctx) {
  let mounted = true;
  const keyOf = (url) => {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) return '__none__';
      parsed.hash = '';
      return parsed.href;
    } catch { return '__none__'; }
  };
  const pageKey = (page) => !page ? undefined
    : page.uploadable && !page.isSystem ? keyOf(page.url) : '__none__';
  let currentKey = pageKey(ctx.getState().currentPage);
  let cacheKey = currentKey;
  let contextUrl = cacheKey === '__none__' ? null : ctx.getState().currentPage?.url;
  let latestTime = 0;
  let pendingChange = null;
  const snapshots = createSnapshotGate();
  const paint = (result) => {
    if (mounted) slotEl.replaceChildren(renderRecommendations(result));
  };
  const queue = createRefreshQueue(async (isCurrent, fresh) => {
    const startedKey = currentKey;
    const stage = snapshots.begin();
    const receive = (result) => {
      if (!isCurrent() || !stage.accepts()) return;
      if (fresh && result.ok && result.data.fromCache) return;
      if (result.ok) {
        const receivedKey = keyOf(result.data.contextUrl);
        // 首个 CTX 早到但首请求实际捕获了另一页时，补一次串行刷新。
        if (startedKey === undefined && currentKey !== undefined && receivedKey !== currentKey) {
          void queue.replace();
          return;
        }
        cacheKey = receivedKey;
        contextUrl = result.data.contextUrl;
        latestTime = Math.max(latestTime, result.data.cachedAt ?? 0);
      }
      paint(result);
    };
    receive.isActive = () => mounted;
    receive.fresh = fresh;
    receive.cacheReady = () => {
      if (!isCurrent()) return;
      const change = pendingChange;
      pendingChange = null;
      if (change) onCache(change);
      stage.ready();
    };
    paint({ loading: true });
    try {
      await loadCacheFirst(ctx, MSG.GET_RECOMMENDATIONS, {}, receive);
    } catch (error) {
      if (isCurrent() && stage.accepts()) paint({ ok: false, error });
    }
  });
  const onPage = (page) => {
    const nextKey = pageKey(page);
    if (nextKey === currentKey) return;
    const initialConfirmation = currentKey === undefined && (cacheKey === undefined || cacheKey === nextKey);
    currentKey = nextKey;
    cacheKey = nextKey;
    contextUrl = nextKey === '__none__' ? null : page.url;
    latestTime = 0;
    if (initialConfirmation) {
      const change = pendingChange;
      pendingChange = null;
      if (change) onCache(change);
    } else {
      pendingChange = null;
      snapshots.reset();
      void queue.replace();
    }
  };
  const valid = (entry) => Number.isSafeInteger(entry?.cachedAt) && entry.cachedAt > 0
    && Array.isArray(entry.data?.recommendations);
  const onCache = ({ newValue, oldValue }) => {
    if (cacheKey === undefined) {
      pendingChange = { oldValue: pendingChange ? pendingChange.oldValue : oldValue, newValue };
      return;
    }
    const next = newValue?.recommendations?.[cacheKey];
    const previous = oldValue?.recommendations?.[cacheKey];
    if (JSON.stringify(next?.data) === JSON.stringify(previous?.data)) return;
    if (valid(next)) {
      if (!queue.acceptsSnapshot()) return;
      if (next.cachedAt < latestTime) return;
      snapshots.snapshot(() => {
        latestTime = Math.max(latestTime, next.cachedAt);
        paint({ ok: true, data: {
          recommendations: next.data.recommendations, contextUrl: contextUrl ?? null,
          fromCache: true, offline: ctx.getState().connection?.status === 'offline', cachedAt: next.cachedAt,
        } });
      });
    } else if (valid(previous)) {
      latestTime = 0;
      snapshots.reset();
      void queue.invalidate();
    }
  };
  const onClick = (event) => {
    const button = event.target.closest?.('button');
    if (!button || button.disabled) return;
    if (button.dataset.testid === 'rec-item') void openRecommendation(button, ctx, () => mounted);
    if (button.dataset.testid === 'error-diag-link') {
      event.stopPropagation();
      ctx.switchTab('diag', { focus: true });
    }
  };
  const subscriptions = [
    ctx.bus.on('current-page:changed', onPage),
    ctx.bus.on('storage:cache', onCache),
  ];
  slotEl.addEventListener('click', onClick);
  void queue.request();
  return () => {
    mounted = false;
    queue.dispose();
    snapshots.dispose();
    subscriptions.forEach((off) => off());
    slotEl.removeEventListener('click', onClick);
    slotEl.replaceChildren();
  };
}
