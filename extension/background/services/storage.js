import { SK } from '../../shared/storage-keys.js';

// @code C-FE-CORE-05
const allowedKeys = new Set(Object.values(SK));
// 队列只用于本次 SW 生命周期的并发协调，业务状态仍保存到 Chrome storage。
const queues = new Map();

/** 只允许契约登记的顶层 key，防止模块创建隐蔽的持久化状态。 */
function assertKey(key) {
  if (allowedKeys.has(key)) return;
  throw Object.assign(new Error('未登记的 storage key'), { code: 'INVALID_STORAGE_KEY' });
}

/** 相同 key 的 set / patch / remove 共享队列，避免异步读改写互相覆盖。 */
function enqueue(key, operation) {
  assertKey(key);
  const task = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(operation);
  queues.set(key, task);
  const cleanup = () => { if (queues.get(key) === task) queues.delete(key); };
  task.then(cleanup, cleanup);
  return task;
}

/**
 * @template T
 * @param {string} key SK 中的值。
 * @param {T} [fallback] 缺失 key 时返回的值。
 * @returns {Promise<T|unknown>} 直接返回保存的值，不返回 Chrome 的 key 包装对象。
 */
export async function storageGet(key, fallback) {
  assertKey(key);
  await (queues.get(key) ?? Promise.resolve()).catch(() => {});
  const values = await chrome.storage.local.get(key);
  return Object.hasOwn(values, key) ? values[key] : fallback;
}

/** @param {string} key @param {unknown} value @returns {Promise<unknown>} 写入后的值。 */
export function storageSet(key, value) {
  return enqueue(key, async () => {
    await chrome.storage.local.set({ [key]: value });
    return value;
  });
}

/**
 * @param {string} key
 * @param {Object|((current: unknown) => unknown|Promise<unknown>)} patchOrUpdater
 * 对象以浅合并更新；函数接收当前值（缺失时为 {}），返回完整的新值，可异步。
 * @returns {Promise<unknown>} 更新后的值。
 */
export function storagePatch(key, patchOrUpdater) {
  return enqueue(key, async () => {
    const values = await chrome.storage.local.get(key);
    const current = Object.hasOwn(values, key) ? values[key] : {};
    const value = typeof patchOrUpdater === 'function'
      ? await patchOrUpdater(current)
      : { ...current, ...patchOrUpdater };
    await chrome.storage.local.set({ [key]: value });
    return value;
  });
}

/** @param {string} key @returns {Promise<void>} 删除登记的 key。 */
export function storageRemove(key) {
  return enqueue(key, () => chrome.storage.local.remove(key));
}
