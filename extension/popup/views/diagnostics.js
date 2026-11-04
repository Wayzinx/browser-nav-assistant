import { el } from '../lib/dom.js';
import { MSG } from '../../shared/messages.js';

const STATUS_TEXT = Object.freeze({ ok: '通过', warn: '警告', fail: '失败', info: '提示' });
const CHECK_TEST_IDS = Object.freeze({
  backend: 'diag-check-backend', tabs: 'diag-check-tabs', history: 'diag-check-history',
  storage: 'diag-check-storage', apiBaseUrl: 'diag-check-api-base-url', lastSync: 'diag-check-last-sync',
  ruleCount: 'diag-check-rule-count', activeTab: 'diag-check-active-tab', privacy: 'diag-check-privacy',
  incognito: 'diag-check-incognito', version: 'diag-check-version',
});

// @code C-FE-DIAG-11
/** @param {object} item 单项诊断。 @returns {HTMLElement} 文本安全、包含排查步骤的检查项。 */
export function renderCheckItem(item) {
  const status = STATUS_TEXT[item.status] ? item.status : 'fail';
  const hints = Array.isArray(item.hint) ? item.hint : [];
  const node = el('section', { 'data-testid': CHECK_TEST_IDS[item.id], 'data-status': status, class: 'diag-item' },
    el('div', { class: 'diag-item-heading' }, el('strong', { 'data-testid': 'diag-item-name' }, item.name),
      el('span', { 'data-testid': 'diag-item-status', 'data-status': status }, STATUS_TEXT[status])),
    el('p', { 'data-testid': 'diag-item-detail' }, item.detail),
    el('span', { 'data-testid': 'diag-item-value' }, item.value ?? ''),
    el('ol', { 'data-testid': 'diag-item-hint', hidden: hints.length === 0 },
      hints.map((hint) => el('li', { 'data-testid': 'diag-item-hint-step' }, hint))),
  );
  if (item.id === 'lastSync' && item.action) {
    node.append(el('button', { 'data-testid': 'diag-sync-now-button', type: 'button' },
      item.action === 'fullSync' ? '立即全量同步' : '立即同步'));
  }
  return node;
}

// @code C-FE-DIAG-11
/** @param {object|null} result 本轮诊断快照。 @returns {HTMLElement} 汇总、完成时间和全部检查项。 */
export function renderChecks(result) {
  const summary = result?.summary;
  const text = summary ? `通过 ${summary.ok} · 警告 ${summary.warn} · 失败 ${summary.fail} · 提示 ${summary.info}` : '尚未检测，请点击「重新检测」';
  return el('div', {},
    el('p', { 'data-testid': 'diag-summary', role: 'status' }, text),
    el('time', { 'data-testid': 'diag-checked-at', 'data-ts': result?.checkedAt, hidden: !result,
      datetime: result ? new Date(result.checkedAt).toISOString() : undefined },
    result ? `检测时间：${new Date(result.checkedAt).toLocaleString('zh-CN')}` : ''),
    (result?.items || []).map(renderCheckItem),
  );
}

function createPanel() {
  const rerun = el('button', { 'data-testid': 'diag-rerun-button', type: 'button' }, '重新检测');
  const copy = el('button', { 'data-testid': 'diag-copy-report-button', type: 'button', disabled: true }, '复制诊断报告');
  const loading = el('p', { 'data-testid': 'diag-loading', hidden: true, role: 'status' }, '检测中…');
  const output = el('pre', { 'data-testid': 'diag-report-output', hidden: true });
  const checks = el('div', {}, renderChecks(null));
  const block = el('section', { class: 'view-block' }, el('h2', {}, '运行诊断'),
    el('div', { class: 'row' }, rerun, copy), loading, checks, output);
  return { block, rerun, copy, loading, checks, output };
}

async function copyReport(ctx, output) {
  try {
    const response = await ctx.send(MSG.GET_DIAG_REPORT, {});
    if (!response.ok) throw new Error(response.error.message);
    await navigator.clipboard.writeText(response.data.text);
    if (!output.isConnected) return;
    output.textContent = response.data.text;
    output.hidden = false;
    ctx.toast('诊断报告已复制');
  } catch (error) {
    ctx.toast(`复制诊断报告失败：${error.message}，请检查剪贴板权限后重试`, { kind: 'error' });
  }
}

// @code C-FE-DIAG-11
/** @param {HTMLElement} slotEl 诊断插槽。 @param {Readonly<object>} ctx 消息、导航和订阅上下文。 @returns {Function} 清理函数。 */
export function mount(slotEl, ctx) {
  const view = createPanel();
  let disposed = false;
  let busy = false;
  let result = null;
  const render = (value) => {
    if (disposed) return;
    result = value;
    view.checks.replaceChildren(renderChecks(value));
    view.copy.disabled = busy || !value;
  };
  const run = async () => {
    if (busy || disposed) return;
    busy = true;
    view.rerun.disabled = true;
    view.copy.disabled = true;
    view.loading.hidden = false;
    view.output.hidden = true;
    const response = await ctx.send(MSG.RUN_DIAGNOSTICS, {}, { timeoutMs: 20000 });
    busy = false;
    if (disposed) return;
    view.loading.hidden = true;
    view.rerun.disabled = false;
    view.copy.disabled = !result;
    if (response.ok) render(response.data);
    else {
      view.checks.querySelector('[data-testid="diag-summary"]').textContent = `诊断失败：${response.error.message}；请重新检测`;
      ctx.toast(`诊断失败：${response.error.message}`, { kind: 'error' });
    }
  };
  const onClick = (event) => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button === view.rerun) void run();
    else if (button === view.copy) void copyReport(ctx, view.output);
    else if (button.dataset.testid === 'diag-sync-now-button') void syncNow(ctx, button, result, run);
  };
  const off = [
    ctx.bus.on('nav:tab', ({ tab }) => { if (tab === 'diag') void run(); }),
    ctx.bus.on('storage:lastDiagnostics', ({ newValue }) => { if (newValue) render(newValue); }),
  ];
  view.block.addEventListener('click', onClick);
  slotEl.replaceChildren(view.block);
  if (ctx.getState().activeTab === 'diag') void run();
  return () => { disposed = true; off.forEach((unsubscribe) => unsubscribe());
    view.block.removeEventListener('click', onClick); view.block.remove(); };
}

async function syncNow(ctx, button, result, rerun) {
  const action = result?.items.find((item) => item.id === 'lastSync')?.action;
  const mode = action === 'fullSync' ? 'full' : 'auto';
  button.disabled = true;
  ctx.bus.emit('sync:requested', { mode });
  const response = await ctx.send(MSG.SYNC_NOW, { mode });
  if (button.isConnected) button.disabled = false;
  if (response.ok) await rerun();
  else ctx.toast(`同步失败：${response.error.message}；请先检查后端服务连接`, { kind: 'error' });
}
