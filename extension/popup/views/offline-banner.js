import { MSG } from '../../shared/messages.js';
import { SK } from '../../shared/storage-keys.js';
import { log } from '../../shared/logger.js';
import { el, formatTime } from '../lib/dom.js';

// @code C-FE-CACHE-02
const TEST_IDS = Object.freeze({
  'offline-banner-home': 'offline-banner-home',
  'offline-banner-ranked': 'offline-banner-ranked',
  'offline-banner-cleanup': 'offline-banner-cleanup',
});
const recoveryRequested = new WeakSet();

function requestRecovery(ctx) {
  if (recoveryRequested.has(ctx)) return;
  recoveryRequested.add(ctx);
  void Promise.resolve().then(() => ctx.send(MSG.RECOVER_IF_NEEDED, {})).then((result) => {
    if (!result.ok) log('popup.recovery-failed', { code: result.error?.code || 'INTERNAL' }, 'warn');
  }).catch((error) => {
    log('popup.recovery-failed', { code: error?.code || 'INTERNAL' }, 'warn');
  });
}

/**
 * 先订阅再初读；同一字段的新事件优先于迟到的初始快照。
 * @param {HTMLElement} slotEl 本区块插槽。
 * @param {Readonly<object>} ctx 外壳上下文。
 * @returns {Function} 本次挂载的卸载函数。
 */
// @code C-FE-CACHE-02
export function mount(slotEl, ctx) {
  if (!Object.hasOwn(TEST_IDS, slotEl.dataset.slot)) {
    throw Object.assign(new Error('离线提示插槽未登记'), { code: 'INTERNAL' });
  }
  const testId = TEST_IDS[slotEl.dataset.slot];
  let active = true;
  const changed = new Set();
  const state = { testId, connection: null, cache: null };
  const render = () => {
    if (active) slotEl.replaceChildren(renderBanner(state));
  };
  const keys = [SK.CONNECTION, SK.CACHE];
  const subscriptions = keys.map((key) => ctx.bus.on(`storage:${key}`, ({ newValue }) => {
    changed.add(key);
    state[key] = newValue;
    render();
  }));
  render();
  void chrome.storage.local.get(keys).then((snapshot) => {
    if (!active) return;
    for (const key of keys) {
      if (!changed.has(key)) state[key] = snapshot[key];
    }
    render();
  }).catch((error) => {
    log('popup.offline-banner-storage-failed', { code: error?.code || 'INTERNAL' }, 'warn');
  });
  requestRecovery(ctx);
  return () => {
    active = false;
    for (const off of subscriptions) off();
    slotEl.replaceChildren();
  };
}

/**
 * 仅凭持久的离线状态及有效缓存时间显示提示，文本交给 el 安全渲染。
 * @param {{testId?: string, connection?: Object, cache?: Object}} state 视图状态。
 * @returns {HTMLElement} 离线横幅；不满足条件时隐藏。
 */
// @code C-FE-CACHE-02
export function renderBanner(state) {
  const cachedAt = state.cache?.cachedAt;
  const time = Number.isSafeInteger(cachedAt) && cachedAt > 0 ? formatTime(cachedAt) : '—';
  const visible = state.connection?.status === 'offline' && time !== '—';
  return el('aside', {
    'data-testid': state.testId, class: 'state offline-banner', role: 'status', hidden: !visible,
  }, visible ? `以下为 ${time} 同步时缓存的结果` : '');
}
