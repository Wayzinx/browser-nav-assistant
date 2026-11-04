import { MSG } from '../../shared/messages.js';
import { DEFAULTS } from '../../shared/constants.js';
import { el, formatScore } from '../lib/dom.js';
import { createRefreshQueue, createSnapshotGate, loadCacheFirst } from '../lib/cache-first.js';

// @code C-FE-RANK-03
/**
 * 渲染四项评分，不在插件端重算得分。
 * @param {Object} scoreDetail 后端评分明细。
 * @returns {HTMLElement} 默认收起的明细。
 */
export function renderScoreDetail(scoreDetail) {
  const labels = [
    ['recency', '时效', 'ranked-detail-recency'],
    ['frequency', '频次', 'ranked-detail-frequency'],
    ['open', '打开', 'ranked-detail-open'],
    ['domain', '域名', 'ranked-detail-domain'],
  ];
  return el('dl', { 'data-testid': 'ranked-item-detail', class: 'ranked-detail', hidden: true },
    labels.map(([key, label, testId]) => el('div', {},
      el('dt', {}, label),
      el('dd', { 'data-testid': testId }, formatScore(scoreDetail?.[key])),
    )),
  );
}

function renderRankedItem(page, expanded) {
  const key = String(page.id ?? page.url);
  const opened = expanded.has(key);
  const detail = renderScoreDetail(page.scoreDetail);
  detail.hidden = !opened;
  return el('li', { 'data-testid': 'ranked-item', class: 'ranked-item', 'data-ranked-key': key },
    el('div', { class: 'ranked-heading' },
      el('span', { 'data-testid': 'ranked-item-title', class: 'ranked-title' }, page.title),
      el('span', { 'data-testid': 'ranked-item-score', class: 'ranked-score' }, formatScore(page.score)),
    ),
    el('span', { 'data-testid': 'ranked-item-url', class: 'muted ranked-url' }, page.url),
    el('p', { 'data-testid': 'ranked-item-reason', class: 'ranked-reason' }, page.reason),
    el('button', { 'data-testid': 'ranked-item-toggle', type: 'button', class: 'link', 'aria-expanded': String(opened) }, opened ? '收起明细' : '展开明细'),
    detail,
  );
}

/**
 * 渲染当前请求结果；公式和筛选控件由外层保留，异步更新不会替换控件。
 * @param {Object} result 消息响应信封，或 { loading: true }。
 * @param {{filtered?: boolean, expanded?: Set<string>}} [options={}] 当前筛选与展开状态。
 * @returns {HTMLElement} 列表及加载、空、错误提示。
 */
export function renderRankedList(result, { filtered = false, expanded = new Set() } = {}) {
  const loading = result?.loading === true;
  const success = result?.ok === true;
  const pages = success ? result.data.pages : [];
  const needsOnline = filtered && result?.error?.code === 'NO_CACHE';
  const error = !loading && !success && !needsOnline;
  return el('div', { class: 'ranked-results' },
    el('p', { 'data-testid': 'ranked-loading', class: 'state', hidden: !loading, role: 'status' }, '正在加载历史排序…'),
    el('p', { 'data-testid': 'ranked-empty', class: 'state', hidden: !success || pages.length > 0 }, '还没有数据，点击上方「同步浏览器上下文」开始'),
    el('div', { 'data-testid': 'ranked-error', class: 'state error', hidden: !error, role: 'alert' },
      el('p', {}, result?.error?.message || '无法读取历史排序，请运行诊断排查。'),
      el('button', { 'data-testid': 'error-diag-link', type: 'button', class: 'link' }, '诊断'),
    ),
    el('p', { 'data-testid': 'ranked-filter-offline-hint', class: 'state error', hidden: !needsOnline, role: 'alert' }, '筛选需要在线'),
    el('ul', { 'data-testid': 'ranked-list', class: 'list', hidden: !success || pages.length === 0 },
      pages.map((page) => renderRankedItem(page, expanded)),
    ),
  );
}

function createShell() {
  const open = el('button', { 'data-testid': 'ranked-filter-open', type: 'button', 'aria-pressed': 'false' }, '打开中');
  const domain = el('select', { 'data-testid': 'ranked-filter-domain' }, el('option', { value: '' }, '全部域名'));
  const total = el('span', { 'data-testid': 'ranked-total' });
  const summary = el('p', { class: 'muted', hidden: true }, '共 ', total, ' 条');
  const content = el('div', {}, renderRankedList({ loading: true }));
  const block = el('section', { class: 'view-block' },
    el('h2', {}, '历史排序'),
    el('p', { 'data-testid': 'ranked-formula', class: 'muted' }, 'score = 0.4 × 时效 + 0.3 × 频次 + 0.2 × 打开 + 0.1 × 域名'),
    el('div', { class: 'ranked-filters' }, open, el('label', { class: 'field' }, '域名筛选', domain)),
    summary, content,
  );
  return { block, open, domain, total, summary, content };
}

function updateDomains(select, domains, selected) {
  const previous = Array.from(select.options).slice(1).map((option) => option.value);
  if (previous.length !== domains.length || previous.some((value, i) => value !== domains[i])) {
    select.replaceChildren(el('option', { value: '' }, '全部域名'),
      ...domains.map((domain) => el('option', { value: domain }, domain)));
  }
  select.value = selected;
}

async function requestRanked(ctx, filters, render) {
  const payload = { limit: DEFAULTS.RANKED_LIMIT, ...filters };
  if (filters.openOnly || filters.domain) {
    render.cacheReady?.();
    render(await ctx.send(MSG.GET_RANKED, { ...payload, source: 'network' }));
  } else {
    await loadCacheFirst(ctx, MSG.GET_RANKED, { limit: DEFAULTS.RANKED_LIMIT }, render);
  }
}

function bindControls(shell, filters, expanded, load, redraw) {
  const onOpen = () => {
    filters.openOnly = !filters.openOnly;
    shell.open.setAttribute('aria-pressed', String(filters.openOnly));
    expanded.clear();
    void load();
  };
  const onDomain = () => {
    filters.domain = shell.domain.value || null;
    expanded.clear();
    void load();
  };
  const onDetail = (event) => {
    const button = event.target.closest?.('[data-testid="ranked-item-toggle"]');
    if (!button) return;
    const key = button.closest('[data-ranked-key]').dataset.rankedKey;
    if (expanded.has(key)) expanded.delete(key);
    else expanded.add(key);
    redraw();
    const item = Array.from(shell.content.querySelectorAll('[data-ranked-key]')).find((row) => row.dataset.rankedKey === key);
    item?.querySelector('[data-testid="ranked-item-toggle"]')?.focus();
  };
  shell.open.addEventListener('click', onOpen);
  shell.domain.addEventListener('change', onDomain);
  shell.content.addEventListener('click', onDetail);
  return () => {
    shell.open.removeEventListener('click', onOpen);
    shell.domain.removeEventListener('change', onDomain);
    shell.content.removeEventListener('click', onDetail);
  };
}

/**
 * 懒加载排序页签，保留筛选节点，并隔离迟到请求和卸载后的更新。
 * @param {HTMLElement} slotEl 本区块插槽。
 * @param {Readonly<object>} ctx 外壳上下文。
 * @returns {Function} 本次挂载的卸载函数。
 */
export function mount(slotEl, ctx) {
  const shell = createShell();
  const filters = { openOnly: false, domain: null };
  const expanded = new Set();
  let active = true;
  let activated = false;
  let latestTime = 0;
  const snapshots = createSnapshotGate();
  let current = { loading: true };
  const render = (result) => {
    if (!active) return;
    current = result;
    shell.summary.hidden = result?.ok !== true;
    shell.total.textContent = result?.ok ? String(result.data.total) : '';
    if (result?.ok) updateDomains(shell.domain, result.data.domains, filters.domain || '');
    shell.content.replaceChildren(renderRankedList(result, { filtered: !!(filters.openOnly || filters.domain), expanded }));
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
      await requestRanked(ctx, { ...filters }, receive);
    } catch (error) {
      if (isCurrent() && stage.accepts()) render({ ok: false, error: { code: error?.code || 'INTERNAL', message: error?.message || '排序加载失败' } });
    }
  });
  const load = () => {
    activated = true;
    return queue.request();
  };
  const unbind = bindControls(shell, filters, expanded, () => {
    latestTime = 0;
    snapshots.reset();
    return queue.replace();
  }, () => render(current));
  const offNav = ctx.bus.on('nav:tab', ({ tab }) => { if (tab === 'ranked') void load(); });
  const offCache = ctx.bus.on('storage:cache', ({ newValue, oldValue }) => {
    if (!activated || filters.openOnly || filters.domain) return;
    const cached = newValue?.ranked;
    if (JSON.stringify(cached?.data) === JSON.stringify(oldValue?.ranked?.data)) return;
    if (!cached) { latestTime = 0; snapshots.reset(); void queue.invalidate(); return; }
    if (!queue.acceptsSnapshot()) return;
    if (!Array.isArray(cached.data?.pages) || cached.cachedAt < latestTime) return;
    // 只消费完整缓存，筛选请求从不读取这一分支。
    snapshots.snapshot(() => {
      latestTime = Math.max(latestTime, cached.cachedAt);
      render({ ok: true, data: {
        ...cached.data, fromCache: true, cachedAt: cached.cachedAt,
        offline: ctx.getState().connection?.status === 'offline',
      } });
    });
  });
  slotEl.replaceChildren(shell.block);
  if (ctx.getState().activeTab === 'ranked') void load();
  return () => {
    active = false;
    queue.dispose();
    snapshots.dispose();
    offNav();
    offCache();
    unbind();
    shell.block.remove();
  };
}
