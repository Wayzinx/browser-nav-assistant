import { send } from './lib/messaging.js';
import { createBus, onStorageChange } from './lib/bus.js';
import { VIEWS } from './views/index.js';
import { log } from '../shared/logger.js';

const TABS = Object.freeze(['home', 'context', 'ranked', 'cleanup', 'rules', 'diag']);
const TAB_IDS = Object.freeze({
  home: ['tab-home', 'panel-home'],
  context: ['tab-context', 'panel-context'],
  ranked: ['tab-ranked', 'panel-ranked'],
  cleanup: ['tab-cleanup', 'panel-cleanup'],
  rules: ['tab-rules', 'panel-rules'],
  diag: ['tab-diag', 'panel-diag'],
});
let activeApp = null;

function snapshot(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(snapshot));
  if (!value || typeof value !== 'object') return value;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item)])));
}

function reportError(event, error, details = {}) {
  log(event, { ...details, code: error?.code || 'INTERNAL' }, 'error');
}

function createToast(root) {
  let timer;
  const node = root.querySelector('[data-testid="toast"]');
  return {
    show(text, { kind = 'info', ms = 2600 } = {}) {
      if (!node) return;
      clearTimeout(timer);
      node.textContent = String(text ?? '');
      node.dataset.kind = kind === 'error' ? 'error' : 'info';
      node.hidden = false;
      timer = setTimeout(() => { node.hidden = true; }, Number.isFinite(ms) && ms > 0 ? ms : 2600);
    },
    cleanup() {
      clearTimeout(timer);
      if (node) {
        node.hidden = true;
        node.textContent = '';
      }
    },
  };
}

// @code C-FE-CORE-06
/**
 * 切换页签；显式 focus=true 时聚焦页签按钮，完成后同步广播。
 * @param {'home'|'context'|'ranked'|'cleanup'|'rules'|'diag'} tab 目标页签。
 * @param {{focus?: boolean}} [options={}] 焦点选项。
 * @returns {void}
 */
export function switchTab(tab, { focus = false } = {}) {
  if (!activeApp || !TABS.includes(tab)) return;
  const { root, state, bus } = activeApp;
  for (const name of TABS) {
    const selected = name === tab;
    const [buttonId, panelId] = TAB_IDS[name];
    const button = root.querySelector(`[data-testid="${buttonId}"]`);
    const panel = root.querySelector(`[data-testid="${panelId}"]`);
    if (button) {
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    if (panel) panel.hidden = !selected;
  }
  state.activeTab = tab;
  if (focus === true) root.querySelector(`[data-testid="${TAB_IDS[tab][0]}"]`)?.focus();
  bus.emit('nav:tab', { tab, focus });
}

// @code C-FE-CORE-06
/**
 * 修改外壳拥有的待处理数或诊断红点，不写入业务模块的 DOM。
 * @param {'cleanup'|'diag'} tab 页签。
 * @param {number|boolean|null} value 待处理数或是否提示。
 * @returns {void}
 */
export function setTabBadge(tab, value) {
  if (!activeApp) return;
  if (tab === 'cleanup') {
    const node = activeApp.root.querySelector('[data-testid="tab-cleanup-count"]');
    if (!node) return;
    const count = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    node.textContent = count > 0 ? String(count) : '';
    node.hidden = count === 0;
  } else if (tab === 'diag') {
    const node = activeApp.root.querySelector('[data-testid="tab-diag-alert"]');
    if (node) node.hidden = value !== true;
  }
}

// @code C-FE-CORE-06
/**
 * 按注册顺序挂载视图；单个挂载或卸载异常不会阻断其他区块。
 * @param {Document|HTMLElement} root 外壳根节点。
 * @param {Readonly<object>} ctx 冻结的 popup 上下文。
 * @returns {Function} 逆序卸载所有已挂载视图。
 */
export function mountViews(root, ctx) {
  const cleanups = [];
  for (const { slot, mount } of VIEWS) {
    const slotEl = root.querySelector(`[data-slot="${slot}"]`);
    if (!slotEl) {
      reportError('popup.view.missing-slot', { code: 'INTERNAL' }, { slot });
      continue;
    }
    try {
      const cleanup = mount(slotEl, ctx);
      if (typeof cleanup === 'function') cleanups.push({ slot, cleanup });
    } catch (error) {
      slotEl.replaceChildren();
      reportError('popup.view.mount-error', error, { slot });
    }
  }
  return () => {
    for (const { slot, cleanup } of cleanups.splice(0).reverse()) {
      try { cleanup(); } catch (error) { reportError('popup.view.unmount-error', error, { slot }); }
    }
  };
}

function bindNavigation(root) {
  const onClick = (event) => {
    const button = event.target.closest?.('button');
    if (!button || button.disabled) return;
    const testId = button.dataset.testid;
    const tab = TABS.find((name) => testId === `tab-${name}`);
    if (tab) switchTab(tab);
    else if (testId === 'error-diag-link') switchTab('diag', { focus: true });
  };
  const onKeyDown = (event) => {
    const index = TABS.findIndex((name) => event.target.dataset?.testid === `tab-${name}`);
    if (index < 0) return;
    const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1
      : offset ? (index + offset + TABS.length) % TABS.length : -1;
    if (next < 0) return;
    event.preventDefault();
    switchTab(TABS[next], { focus: true });
  };
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKeyDown);
  return () => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('keydown', onKeyDown);
  };
}

// @code C-FE-CORE-06
/**
 * 组装严格冻结的上下文、状态订阅与视图，并在窗口卸载时清理。
 * @param {Document} [root=document] popup 文档。
 * @returns {Readonly<object>} 仅含六项契约能力的上下文。
 */
export function bootstrap(root = document) {
  if (activeApp?.root === root) return activeApp.ctx;
  activeApp?.cleanup();
  const bus = createBus();
  const state = { currentPage: null, connection: null, activeTab: 'home' };
  const toast = createToast(root);
  const getState = () => snapshot(state);
  const ctx = Object.freeze({ send, bus, toast: toast.show, switchTab, setTabBadge, getState });
  const subscriptions = [
    bus.on('current-page:changed', (page) => { state.currentPage = snapshot(page); }),
    bus.on('storage:connection', ({ newValue }) => { state.connection = snapshot(newValue ?? null); }),
    onStorageChange(bus),
  ];
  const app = { root, state, bus, ctx };
  activeApp = app;
  const unbindNavigation = bindNavigation(root);
  const unmountViews = mountViews(root, ctx);
  const surface = root.defaultView;
  let cleaned = false;
  app.cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    surface?.removeEventListener('pagehide', app.cleanup);
    surface?.removeEventListener('unload', app.cleanup);
    unmountViews();
    unbindNavigation();
    for (const off of subscriptions) off();
    toast.cleanup();
    if (activeApp === app) activeApp = null;
  };
  surface?.addEventListener('pagehide', app.cleanup);
  surface?.addEventListener('unload', app.cleanup);
  switchTab('home');
  log('popup.ready', { viewCount: VIEWS.length });
  return ctx;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => bootstrap(), { once: true });
  } else {
    bootstrap();
  }
}
