import { el, formatTime } from '../lib/dom.js';
import { loadCacheFirst } from '../lib/cache-first.js';
import { MSG } from '../../shared/messages.js';
import { SK } from '../../shared/storage-keys.js';

const TYPE_LABELS = {
  archive_candidate: '建议归档', never_archive: '永不归档', privacy_filter: '隐私过滤',
  recommend_related: '关联推荐', boost_domain: '排序加权',
};

function summary(rule) {
  const fields = [rule.domain, rule.urlPattern];
  if (rule.inactiveDays !== null && rule.inactiveDays !== undefined) fields.push(`${rule.inactiveDays} 天`);
  if (rule.keywords?.length) fields.push(`关键词：${rule.keywords.join('、')}`);
  if (rule.trigger) fields.push(`${rule.trigger.domain} · 连续 ${rule.trigger.minCount} 次`);
  if (rule.target) fields.push(`推荐 ${rule.target.domain}`);
  return fields.filter(Boolean).join(' · ');
}

// @code C-FE-RULE-04
/** @param {Object[]} rules 已保存规则。 @returns {HTMLElement} 类型、原文和操作控件齐全的列表。 */
export function renderRuleList(rules) {
  return el('ul', { 'data-testid': 'rules-list', class: 'list', hidden: rules.length === 0 }, rules.map((rule) =>
    el('li', { 'data-testid': 'rules-item', 'data-rule-id': rule.id, 'data-type': rule.type },
      el('span', { 'data-testid': 'rules-item-type', class: 'badge' }, TYPE_LABELS[rule.type] || rule.type),
      el('p', { 'data-testid': 'rules-item-summary' }, summary(rule)),
      el('p', { 'data-testid': 'rules-item-raw' }, rule.rawText),
      el('label', { class: 'rule-switch' }, el('input', {
        'data-testid': 'rules-item-toggle', type: 'checkbox', role: 'switch', checked: rule.enabled === true,
      }), '启用规则'),
      el('button', { 'data-testid': 'rules-item-delete', type: 'button' }, '删除'),
      el('button', { 'data-testid': 'rules-item-delete-confirm', type: 'button', hidden: true }, '确认删除'))));
}

class RuleListController {
  constructor(slotEl, ctx) {
    this.ctx = ctx;
    this.active = true;
    this.sequence = 0;
    this.rules = [];
    this.status = 'idle';
    this.errorMessage = '';
    this.offline = false;
    this.cachedAt = null;
    this.confirmId = null;
    this.pending = null;
    this.cacheMissing = false;
    this.count = el('span', { 'data-testid': 'rules-count' }, '0');
    this.loading = el('p', { 'data-testid': 'rules-list-loading', class: 'state', hidden: true }, '加载中');
    this.empty = el('p', { 'data-testid': 'rules-list-empty', class: 'state', hidden: true }, '还没有保存的规则');
    this.error = el('div', { 'data-testid': 'rules-list-error', class: 'state', hidden: true });
    this.cacheHint = el('p', { class: 'rule-cache-hint', role: 'status', hidden: true });
    this.list = el('div');
    this.block = el('section', { class: 'view-block' }, el('h2', {}, '已保存规则 · ', this.count),
      this.loading, this.empty, this.error, this.cacheHint, this.list);
    slotEl.replaceChildren(this.block);
    this.redraw();
  }

  redraw() {
    if (!this.active) return;
    const displayed = this.rules.map((rule) => this.pending?.id === rule.id && this.pending.type === MSG.TOGGLE_RULE
      ? { ...rule, enabled: this.pending.enabled } : rule);
    const list = renderRuleList(displayed);
    for (const item of list.children) {
      item.querySelector('[data-testid="rules-item-delete-confirm"]').hidden = item.dataset.ruleId !== this.confirmId;
      for (const control of item.querySelectorAll('button,input')) control.disabled = this.pending !== null;
    }
    this.list.replaceChildren(list);
    this.count.textContent = String(this.rules.length);
    this.loading.hidden = this.status !== 'loading';
    this.empty.hidden = this.status !== 'ready' || this.rules.length !== 0;
    this.error.hidden = !this.errorMessage;
    this.error.replaceChildren(el('span', {}, this.errorMessage));
    if (this.errorMessage) {
      const diagnostic = el('button', { 'data-testid': 'error-diag-link', type: 'button', class: 'link' }, '诊断');
      diagnostic.addEventListener('click', () => this.ctx.switchTab('diag'));
      this.error.append(diagnostic);
    }
    this.cacheHint.hidden = !this.offline || this.status !== 'ready';
    this.cacheHint.textContent = `离线 · 缓存于 ${formatTime(this.cachedAt)}`;
  }

  render(response, request) {
    if (!this.active || request !== this.sequence) return;
    if (response.ok && Array.isArray(response.data?.rules)) {
      this.rules = response.data.rules;
      this.offline = response.data.offline === true;
      this.cachedAt = response.data.cachedAt;
      this.status = 'ready';
      this.cacheMissing = false;
      this.errorMessage = '';
    } else {
      this.rules = [];
      this.status = 'error';
      this.errorMessage = response.error?.message || '规则列表响应格式无效';
    }
    this.redraw();
  }

  async load() {
    if (!this.active || this.pending) return;
    const request = ++this.sequence;
    this.status = 'loading';
    this.errorMessage = '';
    this.redraw();
    try {
      await loadCacheFirst(this.ctx, MSG.LIST_RULES, {}, (response) => this.render(response, request));
    } catch (error) {
      this.render({ ok: false, error: { message: error?.message || '规则列表加载失败' } }, request);
    }
  }

  onCache({ newValue, oldValue }) {
    if (!this.active || JSON.stringify(newValue?.rules) === JSON.stringify(oldValue?.rules)) return;
    // storage 事件只消费规则分桶，不发网络请求，避免刷新自己形成循环。
    this.sequence += 1;
    if (newValue?.rules) {
      this.render({ ok: true, data: { rules: newValue.rules.data?.rules, cachedAt: newValue.rules.cachedAt,
        offline: this.ctx.getState().connection?.status === 'offline' } }, this.sequence);
    } else {
      this.rules = [];
      this.cacheMissing = true;
      this.status = 'error';
      this.errorMessage = '规则缓存已失效，请重新打开规则页签刷新';
      this.redraw();
    }
  }

  async mutate(type, id, enabled) {
    if (!this.active || this.pending) return;
    this.pending = { type, id, enabled };
    this.errorMessage = '';
    this.sequence += 1;
    this.redraw();
    try {
      const response = await this.ctx.send(type, type === MSG.TOGGLE_RULE ? { id, enabled } : { id });
      if (!this.active) return;
      if (response.ok) {
        if (!this.cacheMissing) {
          this.rules = type === MSG.DELETE_RULE ? this.rules.filter((rule) => rule.id !== response.data.id)
            : this.rules.map((rule) => rule.id === id ? response.data.rule : rule);
          this.status = 'ready';
        }
        this.confirmId = null;
      } else this.errorMessage = response.error.message;
    } catch (error) {
      if (this.active) this.errorMessage = error?.message || '规则操作失败，请重试';
    } finally {
      this.pending = null;
      this.redraw();
    }
  }

  onClick(event) {
    const button = event.target.closest('button');
    const item = button?.closest('[data-testid="rules-item"]');
    if (!item || this.pending) return;
    const id = item.dataset.ruleId;
    if (button.dataset.testid === 'rules-item-delete') {
      this.confirmId = this.confirmId === id ? null : id;
      this.redraw();
    } else if (button.dataset.testid === 'rules-item-delete-confirm') {
      void this.mutate(MSG.DELETE_RULE, id);
    }
  }

  dispose() {
    this.active = false;
    this.sequence += 1;
    this.block.remove();
  }
}

/** @param {HTMLElement} slotEl 规则列表插槽。 @param {Readonly<object>} ctx 外壳上下文。 @returns {Function} 卸载视图及订阅。 */
export function mount(slotEl, ctx) {
  const view = new RuleListController(slotEl, ctx);
  const onClick = (event) => view.onClick(event);
  const onChange = (event) => {
    const target = event.target;
    if (target.dataset.testid === 'rules-item-toggle') {
      void view.mutate(MSG.TOGGLE_RULE, target.closest('[data-testid="rules-item"]').dataset.ruleId, target.checked);
    }
  };
  view.list.addEventListener('click', onClick);
  view.list.addEventListener('change', onChange);
  const off = [
    ctx.bus.on('nav:tab', ({ tab }) => { if (tab === 'rules') void view.load(); }),
    ctx.bus.on(`storage:${SK.CACHE}`, (change) => view.onCache(change)),
    ctx.bus.on(`storage:${SK.CONNECTION}`, ({ newValue }) => {
      view.offline = newValue?.status === 'offline';
      view.redraw();
    }),
  ];
  if (ctx.getState().activeTab === 'rules') void view.load();
  return () => {
    off.forEach((unsubscribe) => unsubscribe());
    view.list.removeEventListener('click', onClick);
    view.list.removeEventListener('change', onChange);
    view.dispose();
  };
}
