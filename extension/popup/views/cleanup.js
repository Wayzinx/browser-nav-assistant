import { MSG } from '../../shared/messages.js';
import { SK } from '../../shared/storage-keys.js';
import { log } from '../../shared/logger.js';
import { el } from '../lib/dom.js';
import { createRefreshQueue, loadCacheFirst } from '../lib/cache-first.js';
import { observeCleanupCache } from '../lib/cleanup-cache.js';
import { renderItemActions, renderArchiveAllButton, renderUndoBar } from './cleanup-actions.js';

// @code C-FE-CLEAN-04
function ruleText(item, rules) {
  const matched = rules.find((rule) => rule.id === item.ruleId);
  if (matched) return matched.rawText;
  // 归档理由中的原文也是后端证据；未返回原文的保护规则不能在前端猜造。
  return item.reason?.match(/命中规则「([\s\S]*)」$/)?.[1] || '规则原文暂不可用，请在规则页查看';
}

function renderItem(item, rules, actionContext) {
  const urls = item.action === 'merge' ? item.urls.join('\n') : item.url;
  return el('article', { 'data-testid': 'cleanup-item', 'data-action': item.action, class: 'cleanup-item' },
    el('span', { 'data-testid': 'cleanup-item-title', class: 'cleanup-item-title' }, item.title || item.url || item.keepUrl),
    el('p', { 'data-testid': 'cleanup-item-url', class: 'cleanup-item-url muted' }, urls),
    el('p', { 'data-testid': 'cleanup-item-reason', class: 'cleanup-item-reason' }, item.reason),
    Number.isFinite(item.ageDays) ? el('p', { class: 'muted' }, `已 ${item.ageDays} 天未访问`) : null,
    item.ruleId ? el('p', { class: 'cleanup-rule' },
      el('span', { 'data-testid': 'cleanup-item-rule-tag', class: 'badge' }, '规则'),
      el('span', { 'data-testid': 'cleanup-item-rule-text' }, ruleText(item, rules)),
    ) : null,
    renderItemActions(item, actionContext),
  );
}

/**
 * 按后端顺序分组三类建议；文本由 el/textContent 渲染。
 * @param {Object} result 消息信封，或 { loading: true } / { idle: true }。
 * @param {{rules?: Object[], actionContext?: Object}} [options={}] 规则与操作回调。
 * @returns {HTMLElement} 列表及全部异步状态。
 */
export function renderCleanupGroups(result, { rules = [], actionContext = {} } = {}) {
  const success = result?.ok === true;
  const loading = result?.loading === true;
  const suggestions = success ? result.data.suggestions : [];
  const actions = { run: () => {}, ...actionContext };
  return el('div', { class: 'cleanup-results' },
    el('p', { 'data-testid': 'cleanup-loading', class: 'state', hidden: !loading, role: 'status' }, '正在加载整理建议…'),
    el('div', { 'data-testid': 'cleanup-error', class: 'state error', hidden: success || loading || result?.idle === true, role: 'alert' },
      el('p', {}, result?.error?.message || '无法读取整理建议，请运行诊断排查。'),
      el('button', { 'data-testid': 'error-diag-link', type: 'button', class: 'link' }, '诊断'),
    ),
    el('p', { 'data-testid': 'cleanup-empty', class: 'state', hidden: !success || suggestions.length > 0 }, '还没有整理建议，点击上方「同步浏览器上下文」开始'),
    [
      ['archive', '归档', 'cleanup-group-archive'],
      ['merge', '重复', 'cleanup-group-merge'],
      ['keep', '保留', 'cleanup-group-keep'],
    ].map(([action, label, testId]) => {
      const group = suggestions.filter((item) => item.action === action);
      return el('section', { 'data-testid': testId, class: 'cleanup-group', hidden: !success },
        el('h3', {}, `${label} ${group.length}`),
        group.map((item) => renderItem(item, rules, actions)),
      );
    }),
    success ? renderArchiveAllButton(suggestions, actions) : null,
  );
}

class CleanupController {
  constructor(slotEl, ctx) {
    this.slotEl = slotEl;
    this.ctx = ctx;
    this.active = true;
    this.activated = false;
    this.networkOnly = false;
    this.actionVersion = 0;
    this.current = { idle: true };
    this.rules = [];
    this.action = null;
    this.busy = false;
    this.actionError = null;
    this.run = this.run.bind(this);
    this.refresh = createRefreshQueue((isCurrent, fresh) => this.refreshResult(isCurrent, fresh));
    this.cache = observeCleanupCache(ctx, (result) => this.render(result), () => {
      if (this.activated) void this.refresh.invalidate();
    }, { initial: ctx.getState().activeTab !== 'cleanup', accepts: this.refresh.acceptsSnapshot });
  }

  redraw() {
    if (!this.active) return;
    const actionContext = { busy: this.busy, error: this.actionError, run: this.run };
    this.slotEl.replaceChildren(el('section', { class: 'view-block' },
      el('h2', {}, '整理建议'),
      renderCleanupGroups(this.current, { rules: this.rules, actionContext }),
      renderUndoBar(this.action, actionContext),
    ));
  }

  render(result) {
    if (!this.active) return;
    this.current = result;
    this.ctx.setTabBadge('cleanup', result?.ok ? result.data.pendingCount : null);
    this.redraw();
  }

  load(networkOnly = false) {
    if (!this.active) return Promise.resolve();
    this.activated = true;
    this.networkOnly ||= networkOnly;
    return networkOnly ? this.refresh.invalidate() : this.refresh.request();
  }

  async refreshResult(isCurrent, fresh) {
    const networkOnly = this.networkOnly;
    this.networkOnly = false;
    const stage = this.cache.begin();
    const receive = (result) => {
      if (isCurrent() && stage.accepts() && !(fresh && result.ok && result.data.fromCache) && this.cache.accepts(result)) {
        this.cache.note(result); this.render(result);
      }
    };
    receive.isActive = () => this.active;
    receive.fresh = fresh;
    receive.cacheReady = () => { if (isCurrent()) stage.ready(); };
    if (!this.current.ok) this.render({ loading: true });
    try {
      if (networkOnly) {
        stage.ready();
        const result = await this.ctx.send(MSG.GET_CLEANUP, { source: 'network' });
        receive(fresh && result.ok && result.data.offline ? { ok: false, error: {
          code: 'NO_CACHE', message: '后端未连接，缓存已失效，请恢复连接后刷新',
        } } : result);
      }
      else await loadCacheFirst(this.ctx, MSG.GET_CLEANUP, {}, receive);
    } catch (error) {
      if (isCurrent() && stage.accepts()) this.render({ ok: false, error: { message: error?.message || '整理建议加载失败' } });
    }
  }

  async loadRules() {
    if (!this.active) return;
    const receive = (result) => {
      if (this.active && result.ok) { this.rules = result.data.rules; this.redraw(); }
    };
    receive.isActive = () => this.active;
    try {
      await loadCacheFirst(this.ctx, MSG.LIST_RULES, {}, receive);
    } catch (error) {
      log('cleanup.rules-read-failed', { code: error?.code || 'INTERNAL' }, 'warn');
    }
  }

  async run(type, payload) {
    if (this.busy || !this.active) return;
    this.busy = true;
    this.actionVersion += 1;
    this.actionError = null;
    this.redraw();
    try {
      const result = await this.ctx.send(type, payload);
      if (!this.active) return;
      if (result.ok) {
        if (result.data.undoToken) this.action = result.data.undoToken;
        if (type === MSG.CLEANUP_UNARCHIVE) this.action = null;
        await this.load(true);
      } else {
        this.actionError = result.error.message;
        if (result.error.details?.applied === true) {
          if (result.error.details.undoToken) this.action = result.error.details.undoToken;
          if (type === MSG.CLEANUP_UNARCHIVE) this.action = null;
          await this.load(true);
        } else if (result.error.code === 'NOT_FOUND') {
          await this.load(true);
        }
      }
    } catch (error) {
      this.actionError = error?.message || '整理操作失败，请重试';
    } finally {
      this.busy = false;
      this.redraw();
    }
  }

  onCache({ newValue, oldValue }) {
    if (!this.active) return;
    if (JSON.stringify(newValue?.rules?.data) !== JSON.stringify(oldValue?.rules?.data)) {
      this.rules = newValue?.rules?.data?.rules || [];
      this.redraw();
    }
  }

  async restoreUndo() {
    const version = this.actionVersion;
    try {
      const stored = await chrome.storage.local.get(SK.LAST_CLEANUP_ACTION);
      if (this.active && this.actionVersion === version) {
        this.action = stored[SK.LAST_CLEANUP_ACTION] ?? null;
        this.redraw();
      }
    } catch (error) {
      log('cleanup.undo-read-failed', { code: error?.code || 'STORAGE_FAILED' }, 'warn');
    }
  }

  dispose() {
    this.active = false;
    this.refresh.dispose();
    this.cache.dispose();
    this.slotEl.replaceChildren();
  }
}

/**
 * 挂载分组与操作控制器；缓存变更更新计数，进入页签时重新验证网络结果。
 * @param {HTMLElement} slotEl 本区块插槽。
 * @param {Readonly<object>} ctx 外壳上下文。
 * @returns {Function} 取消所有订阅并使未完成请求失效。
 */
export function mount(slotEl, ctx) {
  const controller = new CleanupController(slotEl, ctx);
  controller.redraw();
  const offCache = ctx.bus.on('storage:cache', (change) => controller.onCache(change));
  const offNav = ctx.bus.on('nav:tab', ({ tab }) => {
    if (tab !== 'cleanup') return;
    void controller.load();
    void controller.loadRules();
  });
  void controller.restoreUndo();
  if (ctx.getState().activeTab === 'cleanup') {
    void controller.load();
    void controller.loadRules();
  }
  return () => { offCache(); offNav(); controller.dispose(); };
}
