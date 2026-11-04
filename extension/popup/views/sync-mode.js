import { el } from '../lib/dom.js';
import { MSG } from '../../shared/messages.js';
import { SK } from '../../shared/storage-keys.js';

// @code C-FE-INCR-02
function setBusy(button, busy) {
  button.disabled = busy;
  button.setAttribute('aria-disabled', String(busy));
  button.setAttribute('aria-busy', String(busy));
}

function renderMode(button, label, state) {
  const mode = state?.mode === 'incremental' ? 'incremental' : 'full';
  button.dataset.mode = mode;
  label.textContent = `当前模式：${mode === 'incremental' ? '增量' : '全量'}`;
  setBusy(button, state?.status === 'syncing');
}

async function requestFullSync(ctx, applyState, finish) {
  try {
    const response = await ctx.send(MSG.SYNC_NOW, { mode: 'full' });
    if (response.ok) applyState(response.data.syncState);
    else finish(`全量同步失败：${response.error.message}`);
  } catch (error) {
    finish(`全量同步失败：${error?.message || '请重试'}`);
  } finally {
    finish();
  }
}

async function loadInitialState(ctx, applyState, finish, isCurrent) {
  try {
    const response = await ctx.send(MSG.GET_SYNC_STATE);
    if (!isCurrent()) return;
    if (response.ok) applyState(response.data.syncState);
    else finish(`读取同步状态失败：${response.error.message}`);
  } catch (error) {
    if (isCurrent()) finish(`读取同步状态失败：${error?.message || '请重试'}`);
  }
}

/**
 * 挂载全量同步入口；只通过消息和事件总线参与同步，不操作其他视图的 DOM。
 * @param {HTMLElement} slotEl 本区块插槽。
 * @param {Readonly<object>} ctx 外壳通信与事件上下文。
 * @returns {Function} 注销事件并移除本视图的卸载函数。
 */
export function mount(slotEl, ctx) {
  const button = el('button', {
    'data-testid': 'sync-full-button', type: 'button', title: '忽略游标，重新同步最近 30 天的历史',
  }, '全量同步');
  const label = el('p', { class: 'sync-mode-label muted', 'aria-live': 'polite' });
  const block = el('section', { class: 'sync-mode' }, button, label);
  let disposed = false;
  let revision = 0;
  let generation = 0;
  let lastState = null;
  const applyState = (state) => {
    if (disposed) return;
    if (state?.startedAt < lastState?.startedAt) return;
    revision++;
    lastState = state;
    renderMode(button, label, state);
  };
  const finish = (message) => {
    if (disposed) return;
    setBusy(button, lastState?.status === 'syncing');
    if (message) ctx.toast(message, { kind: 'error' });
  };
  const offRequested = ctx.bus.on('sync:requested', () => {
    revision++;
    generation++;
    setBusy(button, true);
  });
  const offStorage = ctx.bus.on(`storage:${SK.SYNC_STATE}`, ({ newValue }) => applyState(newValue));
  const onClick = () => {
    if (disposed || button.disabled) return;
    setBusy(button, true);
    ctx.bus.emit('sync:requested', { mode: 'full' });
    // 上一轮的响应不能解除新一轮同步的禁用状态。
    const current = generation;
    const ifCurrent = (callback) => (value) => { if (current === generation) callback(value); };
    void requestFullSync(ctx, ifCurrent(applyState), ifCurrent(finish));
  };
  button.addEventListener('click', onClick);
  renderMode(button, label, null);
  setBusy(button, true);
  slotEl.replaceChildren(block);
  // 初次读取可能晚于点击或 storage 事件返回，旧快照不能覆盖正在进行的同步。
  void loadInitialState(ctx, applyState, finish, () => !disposed && revision === 0);
  return () => {
    disposed = true;
    offRequested();
    offStorage();
    button.removeEventListener('click', onClick);
    block.remove();
  };
}
