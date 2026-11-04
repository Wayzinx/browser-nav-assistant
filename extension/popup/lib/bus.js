import { SK } from '../../shared/storage-keys.js';
import { log } from '../../shared/logger.js';

// @code C-FE-CORE-07
/**
 * 创建同步事件总线；一个订阅者失败不会中断同次派发。
 * @returns {{on: function(string, Function): Function, emit: function(string, unknown): void}} 事件总线。
 */
export function createBus() {
  const listeners = new Map();
  return Object.freeze({
    on(event, listener) {
      if (typeof event !== 'string' || typeof listener !== 'function') {
        throw new TypeError('事件名和订阅者无效。');
      }
      if (!listeners.has(event)) listeners.set(event, new Set());
      const group = listeners.get(event);
      group.add(listener);
      return () => {
        group.delete(listener);
        if (group.size === 0 && listeners.get(event) === group) listeners.delete(event);
      };
    },
    emit(event, payload) {
      for (const listener of [...(listeners.get(event) || [])]) {
        try {
          listener(payload);
        } catch (error) {
          log('popup.bus.listener-error', { event, code: error?.code || 'INTERNAL' }, 'error');
        }
      }
    },
  });
}

// @code C-FE-CORE-07
/**
 * 只转发契约规定的 local storage 变化，并返回注销函数。
 * @param {{emit: Function}} bus popup 事件总线。
 * @returns {Function} 注销 storage 监听器。
 */
export function onStorageChange(bus) {
  const source = globalThis.chrome?.storage?.onChanged;
  if (!source?.addListener || !source?.removeListener) return () => {};
  const keys = [SK.SYNC_STATE, SK.CACHE, SK.CONNECTION, SK.LAST_DIAGNOSTICS, SK.IMPORTANT_URLS];
  const listener = (changes, areaName) => {
    if (areaName !== 'local' || !changes) return;
    for (const key of keys) {
      if (!Object.hasOwn(changes, key)) continue;
      const { newValue, oldValue } = changes[key];
      bus.emit(`storage:${key}`, { newValue, oldValue });
    }
  };
  source.addListener(listener);
  let attached = true;
  return () => {
    if (!attached) return;
    attached = false;
    source.removeListener(listener);
  };
}
