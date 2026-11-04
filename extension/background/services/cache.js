import { SK } from '../../shared/storage-keys.js';
import { storageGet, storagePatch } from './storage.js';

// @code C-FE-CACHE-01
const CACHE_NAMES = new Set(['ranked', 'recommendations', 'cleanup', 'rules', 'config']);
const NETWORK_ERRORS = new Set(['BACKEND_UNREACHABLE', 'TIMEOUT']);
// 索引最多 20 项；SW 回收后，从已持久化的桶属性顺序重建访问次序。
let recommendationOrder = [];

function assertName(name) {
  if (!CACHE_NAMES.has(name)) throw new TypeError('未知缓存类别');
}

/** 上游已完成隐私过滤；这里只归一化普通 URL，系统页不单独建桶。 */
function recommendationKey(key) {
  if (typeof key !== 'string' || key === '__none__') return '__none__';
  try {
    const url = new URL(key);
    if (!['http:', 'https:'].includes(url.protocol)) return '__none__';
    url.hash = '';
    return url.href;
  } catch {
    return '__none__';
  }
}

function isEntry(value) {
  return value !== null && typeof value === 'object' && Object.hasOwn(value, 'data')
    && value.data !== undefined && Number.isSafeInteger(value.cachedAt) && value.cachedAt > 0;
}

/** 读取只更新内存次序；下次推荐成功写入时再将该次序保存到桶属性顺序。 */
function orderRecommendations(buckets, accessedKey) {
  const storedKeys = Object.keys(buckets ?? {});
  const present = new Set(storedKeys);
  const recent = recommendationOrder.filter((key) => present.has(key));
  const known = new Set(recent);
  const order = [...storedKeys.filter((key) => !known.has(key)), ...recent]
    .filter((key) => key !== accessedKey);
  if (present.has(accessedKey)) order.push(accessedKey);
  recommendationOrder = order.slice(-20);
  return recommendationOrder;
}

/** 整个 cache 共用 CORE 的原子更新队列，避免不同分类互相覆盖。 */
async function saveCache(name, data, key) {
  assertName(name);
  const saved = await storagePatch(SK.CACHE, (current) => {
    const cache = { ...current };
    const cachedAt = Date.now();
    const entry = { data, cachedAt };
    if (name === 'recommendations') {
      const bucket = recommendationKey(key);
      const recommendations = { ...cache.recommendations, [bucket]: entry };
      const order = orderRecommendations(recommendations, bucket);
      cache.recommendations = Object.fromEntries(order.map((key) => [key, recommendations[key]]));
    } else {
      cache[name] = entry;
    }
    return { ...cache, cachedAt };
  });
  return saved.cachedAt;
}

/**
 * 读取有效缓存；空集合也是命中。
 * @param {string} name 缓存分类。
 * @param {string} [key] 推荐上下文的归一化 key。
 * @returns {Promise<{data: Object, cachedAt: number}|null>}
 */
// @code C-FE-CACHE-01
export async function readCache(name, key) {
  assertName(name);
  const cache = await storageGet(SK.CACHE, {});
  const bucket = name === 'recommendations' ? recommendationKey(key) : undefined;
  const entry = name === 'recommendations'
    ? cache?.recommendations?.[bucket] : cache?.[name];
  const valid = isEntry(entry);
  if (name === 'recommendations') {
    orderRecommendations(cache?.recommendations, valid ? bucket : undefined);
  }
  return valid ? entry : null;
}

/**
 * 保存成功响应体及时间，保留其他分类。
 * @param {string} name 缓存分类。
 * @param {Object} data 已经过隐私过滤的后端数据。
 * @param {string} [key] 推荐上下文 key。
 * @returns {Promise<void>}
 */
// @code C-FE-CACHE-01
export async function writeCache(name, data, key) {
  await saveCache(name, data, key);
}

/**
 * 只删除指定分类，不改写其他分类及其时间。
 * @param {string[]} names 要失效的缓存分类。
 * @returns {Promise<void>}
 */
// @code C-FE-CACHE-01
export async function invalidate(names) {
  for (const name of names) assertName(name);
  await storagePatch(SK.CACHE, (current) => {
    const cache = { ...current };
    for (const name of names) delete cache[name];
    if (names.includes('recommendations')) recommendationOrder = [];
    return cache;
  });
}

/**
 * 缓存只读或网络刷新；只有断连和超时可回退，不掩盖依赖异常。
 * @param {string} name 缓存分类。
 * @param {function(): Promise<Object>} fetcher 返回 API 结果的网络函数。
 * @param {{source?: 'cache'|'network', key?: string}} [options={}] 缓存策略。
 * @returns {Promise<{ok: true, data: Object, fromCache: boolean, offline: boolean, cachedAt: number}|{ok: false, error: Object}>}
 */
// @code C-FE-CACHE-01
export async function withCache(name, fetcher, { source = 'network', key } = {}) {
  assertName(name);
  if (source === 'cache') {
    const cached = await readCache(name, key);
    if (!cached) return { ok: false, error: { code: 'NO_CACHE', message: '暂无缓存' } };
    const connection = await storageGet(SK.CONNECTION, {});
    return { ok: true, ...cached, fromCache: true, offline: connection?.status === 'offline' };
  }
  const result = await fetcher();
  if (result.ok) {
    const cachedAt = await saveCache(name, result.data, key);
    return { ...result, fromCache: false, offline: false, cachedAt };
  }
  if (NETWORK_ERRORS.has(result.error?.code)) {
    const cached = await readCache(name, key);
    if (cached) return { ok: true, ...cached, fromCache: true, offline: true };
    return { ...result, error: {
      ...result.error,
      message: `后端未连接：${result.error.message || '请检查后端服务和 API 地址'}`,
    } };
  }
  return result;
}
