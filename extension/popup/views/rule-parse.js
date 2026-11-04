import { el } from '../lib/dom.js';
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

// @code C-FE-RULE-02
/** @param {Object[]} rules 后端预览。 @returns {HTMLElement} 保持后端顺序的卡片列表。 */
export function renderPreview(rules) {
  return el('ul', { 'data-testid': 'rule-preview-list', class: 'list', hidden: rules.length === 0 }, rules.map((rule, index) => {
    const checkbox = el('input', { 'data-testid': 'rule-card-checkbox', type: 'checkbox', checked: true });
    const json = el('pre', { 'data-testid': 'rule-card-json', hidden: true }, JSON.stringify(rule, null, 2));
    const toggle = el('button', { 'data-testid': 'rule-card-json-toggle', type: 'button', 'aria-expanded': 'false' }, '查看 JSON');
    toggle.addEventListener('click', () => {
      json.hidden = !json.hidden;
      toggle.setAttribute('aria-expanded', String(!json.hidden));
    });
    return el('li', { 'data-testid': 'rule-card', 'data-type': rule.type, 'data-rule-index': index },
      el('label', { class: 'rule-selection' }, checkbox, '选择规则'),
      el('span', { 'data-testid': 'rule-card-type', class: 'badge' }, TYPE_LABELS[rule.type] || rule.type),
      el('span', { 'data-testid': 'rule-card-confidence', class: 'badge' }, rule.confidence === 'medium' ? '中' : '高'),
      el('p', { 'data-testid': 'rule-card-fields' }, summary(rule)),
      el('p', { 'data-testid': 'rule-card-raw' }, rule.rawText), toggle, json);
  }));
}

/** @param {Object[]} unparsed 未识别片段。 @param {string[]} warnings 提示及默认值说明。 @returns {HTMLElement} 黄色提示框。 */
export function renderUnparsed(unparsed, warnings) {
  const messages = unparsed.map((item) => el('div', {}, el('p', {}, item.text), el('p', {}, item.reason),
    el('ul', {}, (item.examples || []).map((example) => el('li', {}, example)))));
  messages.push(...warnings.map((warning) => el('p', {}, warning)));
  return el('div', { 'data-testid': 'rule-unparsed', class: 'rule-notice', hidden: messages.length === 0 }, messages);
}

// @code C-FE-RULE-03
/** @param {Object[]} rules 已勾选的预览。 @param {Object} ctx 外壳上下文。 @returns {HTMLElement} 保存操作栏。 */
export function renderSaveBar(rules, ctx) {
  return el('div', { class: 'rule-save-bar' }, el('button', {
    'data-testid': 'rule-save-button', type: 'button', disabled: rules.length === 0,
    'aria-disabled': String(rules.length === 0),
  }, `确认保存 ${rules.length} 条`));
}

/** @param {Object} ctx 外壳上下文。 @param {Object[]} rules 已勾选的预览。 @returns {Promise<Object>} 保存响应信封。 */
export async function onSave(ctx, rules) {
  return ctx.send(MSG.SAVE_RULES, { rules });
}

class RuleParseController {
  constructor(slotEl, ctx) {
    this.slotEl = slotEl;
    this.ctx = ctx;
    this.active = true;
    this.sequence = 0;
    this.rules = [];
    this.selected = new Set();
    this.parsing = false;
    this.saving = false;
    this.offline = ctx.getState().connection?.status === 'offline';
    this.input = el('textarea', { 'data-testid': 'rule-input', maxlength: '500', rows: '3', placeholder: '输入一句话配置规则' });
    this.parseButton = el('button', { 'data-testid': 'rule-parse-button', type: 'button' }, '解析');
    this.loading = el('p', { 'data-testid': 'rule-parse-loading', class: 'state', hidden: true }, '解析中');
    this.error = el('div', { 'data-testid': 'rule-parse-error', class: 'state', hidden: true });
    this.hint = el('p', { 'data-testid': 'rule-offline-hint', class: 'state', hidden: true }, '后端未连接，暂时无法解析');
    this.preview = el('div');
    this.notice = el('div');
    this.saveBar = el('div');
    this.result = el('p', { 'data-testid': 'rule-save-result', class: 'state', role: 'status', hidden: true });
    this.block = el('section', { class: 'view-block' }, el('h2', {}, '解析规则'),
      el('label', { class: 'field' }, '规则内容（最多 500 字）', this.input), this.parseButton,
      this.hint, this.loading, this.error, this.preview, this.notice, this.saveBar, this.result);
    slotEl.replaceChildren(this.block);
    this.clearPreview();
  }

  selectedRules() {
    return this.rules.filter((_rule, index) => this.selected.has(index));
  }

  updateControls() {
    this.parseButton.disabled = this.offline || this.parsing || this.saving;
    this.parseButton.setAttribute('aria-disabled', String(this.parseButton.disabled));
    this.input.disabled = this.saving;
    this.hint.hidden = !this.offline;
    this.loading.hidden = !this.parsing;
    this.saveBar.replaceChildren(renderSaveBar(this.selectedRules(), this.ctx));
    const saveButton = this.saveBar.querySelector('[data-testid="rule-save-button"]');
    saveButton.disabled = this.saving || this.parsing || this.selected.size === 0;
    saveButton.setAttribute('aria-disabled', String(saveButton.disabled));
    for (const checkbox of this.preview.querySelectorAll('[data-testid="rule-card-checkbox"]')) checkbox.disabled = this.saving;
  }

  clearPreview() {
    this.rules = [];
    this.selected.clear();
    this.preview.replaceChildren(renderPreview([]));
    this.notice.replaceChildren(renderUnparsed([], []));
    this.updateControls();
  }

  inputChanged() {
    if (this.saving) return;
    this.sequence += 1;
    this.parsing = false;
    this.error.hidden = true;
    this.result.hidden = true;
    this.clearPreview();
  }

  showError(message) {
    const diagnostic = el('button', { 'data-testid': 'error-diag-link', type: 'button', class: 'link' }, '诊断');
    diagnostic.addEventListener('click', () => this.ctx.switchTab('diag'));
    this.error.replaceChildren(el('span', {}, message), diagnostic);
    this.error.hidden = false;
  }

  async parse() {
    if (!this.active || this.offline || this.saving || this.parsing) return;
    const request = ++this.sequence;
    const text = this.input.value;
    this.clearPreview();
    this.error.hidden = true;
    this.result.hidden = true;
    if (text.trim().length === 0 || text.trim().length > 500) {
      this.showError('请输入 1–500 字的规则内容');
      return;
    }
    this.parsing = true;
    this.updateControls();
    try {
      const response = await this.ctx.send(MSG.PARSE_RULE, { text });
      if (!this.active || request !== this.sequence) return;
      if (!response.ok) { this.showError(response.error.message); return; }
      const { rules, unparsed, warnings } = response.data;
      this.rules = rules;
      this.selected = new Set(rules.map((_rule, index) => index));
      this.preview.replaceChildren(renderPreview(rules));
      this.notice.replaceChildren(renderUnparsed(unparsed, [...warnings, ...rules.flatMap((rule) => rule.notes || [])]));
    } catch (error) {
      if (this.active && request === this.sequence) this.showError(error?.message || '解析失败，请重试');
    } finally {
      if (this.active && request === this.sequence) { this.parsing = false; this.updateControls(); }
    }
  }

  async save() {
    if (!this.active || this.saving || this.parsing || this.selected.size === 0) return;
    this.saving = true;
    this.result.hidden = true;
    this.updateControls();
    try {
      const response = await onSave(this.ctx, this.selectedRules());
      if (!this.active) return;
      if (response.ok) {
        this.clearPreview();
        this.result.textContent = `已保存 ${response.data.rules.length} 条规则`;
      } else this.result.textContent = `保存失败：${response.error.message}`;
      this.result.hidden = false;
    } catch (error) {
      if (this.active) {
        this.result.textContent = `保存失败：${error?.message || '请重试'}`;
        this.result.hidden = false;
      }
    } finally {
      if (this.active) { this.saving = false; this.updateControls(); }
    }
  }

  changeSelection(target) {
    if (target.dataset.testid !== 'rule-card-checkbox' || this.saving) return;
    const index = Number(target.closest('[data-rule-index]').dataset.ruleIndex);
    if (target.checked) this.selected.add(index);
    else this.selected.delete(index);
    this.updateControls();
  }

  dispose() {
    this.active = false;
    this.sequence += 1;
    this.block.remove();
  }
}

// @code C-FE-RULE-02
/** @param {HTMLElement} slotEl 解析插槽。 @param {Readonly<object>} ctx 外壳上下文。 @returns {Function} 清理视图和订阅。 */
export function mount(slotEl, ctx) {
  const view = new RuleParseController(slotEl, ctx);
  const onInput = () => view.inputChanged();
  const onParse = () => { void view.parse(); };
  const onClick = (event) => { if (event.target.closest('[data-testid="rule-save-button"]')) void view.save(); };
  const onChange = (event) => view.changeSelection(event.target);
  view.input.addEventListener('input', onInput);
  view.parseButton.addEventListener('click', onParse);
  view.saveBar.addEventListener('click', onClick);
  view.preview.addEventListener('change', onChange);
  const off = [
    ctx.bus.on('rule:parse', ({ text }) => {
      if (view.saving) return;
      view.input.value = text;
      view.inputChanged();
      void view.parse();
    }),
    ctx.bus.on(`storage:${SK.CONNECTION}`, ({ newValue }) => {
      view.offline = newValue?.status === 'offline';
      view.updateControls();
    }),
  ];
  return () => {
    off.forEach((unsubscribe) => unsubscribe());
    view.input.removeEventListener('input', onInput);
    view.parseButton.removeEventListener('click', onParse);
    view.saveBar.removeEventListener('click', onClick);
    view.preview.removeEventListener('change', onChange);
    view.dispose();
  };
}
