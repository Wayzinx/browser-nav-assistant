import { el } from '../lib/dom.js';
import { MSG } from '../../shared/messages.js';
import { SK } from '../../shared/storage-keys.js';

// @code C-FE-MENU-03
function createControls() {
  const star = el('button', {
    'data-testid': 'current-page-star',
    type: 'button',
    class: 'important-star',
    'aria-pressed': 'false',
    'aria-label': '标记为重要',
  }, '☆');
  const add = el('button', { 'data-testid': 'current-page-add', type: 'button' }, '添加到分析');
  return { star, add, block: el('div', { class: 'current-page-actions' }, star, add) };
}

function render(state, controls) {
  const page = state.page;
  const hidden = !page?.url || page.isSystem === true;
  // 总线的冻结载荷用 uploadable 表示敏感状态；初始化快照也可带 badge。
  const sensitive = page?.uploadable === false || page?.badge?.kind === 'sensitive';
  const important = Boolean(page?.url && state.importantUrls.includes(page.url));
  controls.block.hidden = hidden;
  controls.star.hidden = hidden;
  controls.add.hidden = hidden;
  controls.star.textContent = important ? '★' : '☆';
  controls.star.setAttribute('aria-pressed', String(important));
  controls.star.setAttribute('aria-label', important ? '取消重要标记' : '标记为重要');
  controls.star.title = sensitive ? '敏感页面不采集'
    : !state.ready ? (state.readFailed ? '读取重要状态失败，请重新打开插件' : '正在读取重要状态')
      : important ? '取消重要标记' : '标记为重要';
  controls.star.disabled = hidden || sensitive || !state.ready || state.busy;
  controls.add.disabled = hidden || state.busy;
  controls.star.setAttribute('aria-disabled', String(controls.star.disabled));
  controls.add.setAttribute('aria-disabled', String(controls.add.disabled));
  controls.block.setAttribute('aria-busy', String(state.busy));
}

function showError(ctx, error, fallback) {
  const prefix = error?.code ? `${error.code}：` : '';
  ctx.toast(`${prefix}${error?.message || fallback}`, { kind: 'error' });
}

function replayMenuAction(ctx, action) {
  if (typeof action?.accepted !== 'boolean') return;
  if (action.kind === 'add') {
    ctx.toast(action.accepted ? '已添加到分析' : '含敏感词未上传');
  } else if (action.kind === 'important') {
    ctx.toast(action.accepted ? '重要标记已更新' : '敏感页面不采集');
  }
}

async function loadStoredState(state, controls, ctx) {
  const storageVersion = state.storageVersion;
  const actionVersion = state.actionVersion;
  try {
    const values = await chrome.storage.local.get([SK.IMPORTANT_URLS, SK.LAST_MENU_ACTION]);
    if (!state.mounted) return;
    // 初始异步读取不能覆盖挂载后已经收到的更新。
    if (storageVersion === state.storageVersion) {
      state.importantUrls = Array.isArray(values[SK.IMPORTANT_URLS]) ? values[SK.IMPORTANT_URLS] : [];
      state.ready = true;
      render(state, controls);
    }
    if (actionVersion === state.actionVersion) replayMenuAction(ctx, values[SK.LAST_MENU_ACTION]);
  } catch (error) {
    if (!state.mounted) return;
    if (storageVersion === state.storageVersion) {
      state.readFailed = true;
      render(state, controls);
    }
    if (actionVersion === state.actionVersion) showError(ctx, error, '读取本地重要状态失败，请重新打开插件');
  }
}

function applyResult(kind, data, state, ctx, storageVersion) {
  if (typeof data?.accepted !== 'boolean'
    || (kind === 'star' && data.accepted && !Array.isArray(data.importantUrls))) {
    throw Object.assign(new Error('页面操作响应无效'), { code: 'INVALID_RESPONSE' });
  }
  if (kind === 'add') {
    ctx.toast(data.accepted ? '已添加到分析' : '含敏感词未上传');
  } else if (data.accepted) {
    // storage 事件可能已经带来更新的全集；迟到的响应不得把它覆盖回旧快照。
    if (storageVersion === state.storageVersion) state.importantUrls = data.importantUrls;
  } else {
    ctx.toast('敏感页面不采集');
  }
}

async function runAction(kind, state, controls, ctx) {
  if (!state.mounted || state.busy || controls[kind].disabled || controls[kind].hidden) return;
  const page = state.page;
  const pageVersion = state.pageVersion;
  const storageVersion = state.storageVersion;
  const payload = { url: page.url, title: page.title ?? '' };
  if (kind === 'star') payload.important = !state.importantUrls.includes(page.url);
  // 在第一个 await 前锁定两个按钮，避免同一页面的交叉操作重入。
  state.busy = true;
  state.actionVersion++;
  render(state, controls);
  try {
    // 当前 PRIV 配置请求 1.5 秒且不重试，随后 POST 最多 5 秒，使用默认 10 秒消息超时。
    const response = await ctx.send(kind === 'star' ? MSG.MARK_IMPORTANT : MSG.ADD_TO_ANALYSIS,
      payload);
    if (!state.mounted || pageVersion !== state.pageVersion) return;
    if (!response.ok) throw response.error;
    applyResult(kind, response.data, state, ctx, storageVersion);
  } catch (error) {
    if (state.mounted && pageVersion === state.pageVersion) showError(ctx, error, '页面操作失败，请重试');
  } finally {
    if (state.mounted) {
      state.busy = false;
      render(state, controls);
    }
  }
}

/**
 * 只在 MENU 插槽内展示当前页操作；从冻结状态、总线和本地 storage 读取状态。
 * @param {HTMLElement} slotEl 本区块插槽。
 * @param {Readonly<object>} ctx 外壳上下文。
 * @returns {Function} 本次挂载的卸载函数。
 */
// @code C-FE-MENU-03
export function mount(slotEl, ctx) {
  const controls = createControls();
  const state = {
    mounted: true,
    page: ctx.getState().currentPage,
    importantUrls: [],
    ready: false,
    readFailed: false,
    busy: false,
    pageVersion: 0,
    storageVersion: 0,
    actionVersion: 0,
  };
  const subscriptions = [
    ctx.bus.on('current-page:changed', (page) => {
      if (!state.mounted) return;
      state.page = page;
      state.pageVersion++;
      render(state, controls);
    }),
    ctx.bus.on('storage:importantUrls', ({ newValue }) => {
      if (!state.mounted) return;
      state.storageVersion++;
      state.importantUrls = Array.isArray(newValue) ? newValue : [];
      state.ready = true;
      render(state, controls);
    }),
  ];
  const onStar = () => { void runAction('star', state, controls, ctx); };
  const onAdd = () => { void runAction('add', state, controls, ctx); };
  controls.star.addEventListener('click', onStar);
  controls.add.addEventListener('click', onAdd);
  slotEl.replaceChildren(controls.block);
  render(state, controls);
  void loadStoredState(state, controls, ctx);
  return () => {
    if (!state.mounted) return;
    state.mounted = false;
    for (const off of subscriptions) off();
    controls.star.removeEventListener('click', onStar);
    controls.add.removeEventListener('click', onAdd);
    controls.block.remove();
  };
}
