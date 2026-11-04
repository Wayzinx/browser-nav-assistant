import { el, formatTime } from '../lib/dom.js';
import { MSG } from '../../shared/messages.js';
import { SK } from '../../shared/storage-keys.js';
import { DEFAULTS } from '../../shared/constants.js';

// @code C-FE-SYNC-01
const STATUS_TEXT = { idle: '尚未同步', syncing: '同步中…', success: '同步成功', error: '同步失败' };

function count(value) {
  return String(Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0);
}

function relativeTime(timestamp) {
  const minutes = Math.floor(Math.max(0, Date.now() - timestamp) / 60000);
  if (minutes === 0) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
  return `${Math.floor(minutes / 1440)} 天前`;
}

/**
 * 安全渲染同步状态；数字与说明分开，失败原因只作为文本。
 * @param {Object|null} syncState 持久化状态或尚未同步的空值。
 * @returns {HTMLElement} 状态行及其详情，不绑定业务事件。
 */
export function renderSyncState(syncState) {
  const state = syncState ?? {};
  const status = Object.hasOwn(STATUS_TEXT, state.status) ? state.status : 'idle';
  const time = formatTime(state.lastSyncAt);
  const block = el('div', {
    'data-testid': 'sync-status', 'data-status': status, class: 'sync-state',
    role: 'status', 'aria-live': 'polite',
  }, el('p', { class: 'sync-label' }, STATUS_TEXT[status]),
  el('p', { class: 'sync-counts', hidden: status === 'idle' },
    '上传 ', el('span', { 'data-testid': 'sync-uploaded-count' }, count(state.stats?.uploaded)),
    ' 条 · 过滤 ', el('span', { 'data-testid': 'sync-filtered-count' }, count(state.stats?.filtered)), ' 条',
  ), el('time', {
    'data-testid': 'sync-status-time', hidden: time === '—',
    datetime: time === '—' ? undefined : new Date(state.lastSyncAt).toISOString(),
  }, time === '—' ? '' : `${time} · ${relativeTime(state.lastSyncAt)}`));
  if (status === 'error') {
    block.append(
      el('p', { 'data-testid': 'sync-error-message' }, state.lastError?.message || '同步失败，请重试'),
      el('button', { 'data-testid': 'sync-diag-link', type: 'button' }, '诊断'),
    );
  }
  return block;
}

function render(view) {
  const busy = view.state.status === 'syncing';
  view.button.disabled = busy;
  view.button.setAttribute('aria-disabled', String(busy));
  view.button.setAttribute('aria-busy', String(busy));
  view.host.replaceChildren(renderSyncState(view.state));
}

function startedAt(state) {
  return Number.isFinite(state?.startedAt) ? state.startedAt : -Infinity;
}

function scheduleRead(view, delay) {
  clearTimeout(view.timer);
  view.timer = setTimeout(() => { void readState(view, true); }, delay);
}

function applyState(view, state, { response = false, recovery = false } = {}) {
  if (view.disposed || !state) return;
  const at = startedAt(state);
  const previousAt = startedAt(view.saved);
  if (at < previousAt) return;
  // 同一批次已结束后，迟到的 syncing 快照不能让按钮重新锁死。
  if (at === previousAt && state.status === 'syncing'
    && ['success', 'error'].includes(view.state.status)) return;
  const pending = view.pending;
  if (pending && !response && !recovery && at <= pending.baselineAt
    && pending.startedAt !== at) return;
  if (pending && state.status === 'syncing') pending.startedAt = at;
  if (state.status !== 'syncing') {
    view.pending = null;
    clearTimeout(view.timer);
  }
  view.revision++;
  view.saved = state;
  view.state = state;
  render(view);
  if (state.status === 'syncing') {
    const delay = DEFAULTS.SYNC_INTERRUPTED_MS + 1 - (Date.now() - state.startedAt);
    scheduleRead(view, Math.max(1000, Number.isFinite(delay) ? delay : DEFAULTS.SYNC_INTERRUPTED_MS));
  }
}

function showFailure(view, error, revision) {
  if (view.disposed) return;
  // 已收到本批终态时，消息超时不能把真实成功覆盖为本地失败。
  if (view.revision !== revision) {
    if (view.state.status === 'syncing') void readState(view, true);
    return;
  }
  view.pending = null;
  clearTimeout(view.timer);
  view.revision++;
  view.state = { ...view.saved, status: 'error', lastError: {
    code: error?.code || 'INTERNAL', message: error?.message || '无法读取同步状态，请重试',
  } };
  render(view);
}

async function readState(view, recovery = false) {
  const revision = view.revision;
  const generation = view.generation;
  try {
    const result = await view.ctx.send(MSG.GET_SYNC_STATE);
    if (view.disposed || revision !== view.revision || generation !== view.generation) return;
    if (result.ok) applyState(view, result.data.syncState, { recovery });
    else showFailure(view, result.error, revision);
  } catch (error) {
    if (revision === view.revision && generation === view.generation) showFailure(view, error, revision);
  }
}

function onRequested(view) {
  if (view.disposed) return;
  view.generation++;
  view.revision++;
  view.pending = { baselineAt: startedAt(view.saved), startedAt: null };
  view.state = { ...view.saved, status: 'syncing', lastError: null };
  render(view);
  // 其他入口可能在消息到达 SW 前失败；到期重新读取，避免永远停在乐观的同步中。
  scheduleRead(view, DEFAULTS.SYNC_MESSAGE_TIMEOUT_MS);
}

async function requestSync(view) {
  const generation = view.generation;
  const revision = view.revision;
  try {
    const result = await view.ctx.send(MSG.SYNC_NOW, { mode: 'auto', trigger: 'user' });
    if (view.disposed || generation !== view.generation) return;
    if (result.ok) applyState(view, result.data.syncState, { response: true });
    else showFailure(view, result.error, revision);
  } catch (error) {
    if (generation === view.generation) showFailure(view, error, revision);
  }
}

/**
 * 只经 ctx.send 通信；先同步广播禁用，再发消息，关闭 popup 不取消后台任务。
 * @param {HTMLElement} slotEl 本区块插槽。
 * @param {Readonly<object>} ctx 外壳上下文。
 * @returns {Function} 清理订阅、计时器、DOM 事件与本视图的卸载函数。
 */
export function mount(slotEl, ctx) {
  const button = el('button', {
    'data-testid': 'sync-button', type: 'button', class: 'primary',
  }, '同步浏览器上下文');
  const host = el('div');
  const block = el('section', { class: 'view-block' }, button, host);
  const view = {
    ctx, button, host, state: { status: 'idle' }, saved: null,
    revision: 0, generation: 0, pending: null, disposed: false, timer: null,
  };
  const offRequested = ctx.bus.on('sync:requested', () => onRequested(view));
  const offStorage = ctx.bus.on(`storage:${SK.SYNC_STATE}`, ({ newValue }) => applyState(view, newValue));
  const onClick = () => {
    if (view.disposed || button.disabled) return;
    button.disabled = true;
    ctx.bus.emit('sync:requested', { mode: 'auto' });
    void requestSync(view);
  };
  const onDiagnostic = (event) => {
    if (event.target.closest('[data-testid="sync-diag-link"]')) ctx.switchTab('diag', { focus: true });
  };
  button.addEventListener('click', onClick);
  host.addEventListener('click', onDiagnostic);
  render(view);
  button.disabled = true;
  button.setAttribute('aria-disabled', 'true');
  slotEl.replaceChildren(block);
  void readState(view);
  return () => {
    view.disposed = true;
    clearTimeout(view.timer);
    offRequested();
    offStorage();
    button.removeEventListener('click', onClick);
    host.removeEventListener('click', onDiagnostic);
    block.remove();
  };
}
