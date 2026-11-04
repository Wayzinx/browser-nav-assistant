import { createHash } from 'node:crypto';
import { onReset } from '../store/state.js';

// @code C-BE-PERF-01
// 推荐结果缓存（F-PERF-02、BE-PERF-04）：相同上下文 60 秒内直接返回上次结果。
// 失效靠 key 中的三个版本号：同步 / 规则 / 配置变化后版本号加 1，旧 key 自然不再命中。

/** 缓存有效期：60 秒（技术方案 §6.4）。 */
const REC_CACHE_TTL_MS = 60_000;
/** 缓存最多保留 500 条，超出时淘汰最早写入的一条。 */
const REC_CACHE_CAPACITY = 500;

/** key → { result, storedAt }；Map 保持插入顺序，第一个键就是最旧的条目。 */
const cache = new Map();

/**
 * 生成缓存 key。打开页按集合处理（去重 + 排序，顺序无关）；最近历史保留原顺序与重复。
 * 用 JSON 数组编码各维度再取 sha256，避免字符串拼接产生歧义碰撞。
 * @param {{currentUrl:string,openDupKeys:string[],recentDupKeys:string[],versions:{data:number,rule:number,config:number},nowOverride?:number}} options 缓存维度
 * @returns {string} 缓存键（64 位十六进制）
 */
export function buildRecCacheKey({ currentUrl, openDupKeys = [], recentDupKeys = [], versions = {}, nowOverride }) {
  const openSet = [...new Set(openDupKeys)].sort();
  const parts = [
    currentUrl || '',
    openSet,
    [...recentDupKeys],
    [versions.data ?? null, versions.rule ?? null, versions.config ?? null],
    nowOverride ?? null,
  ];
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

/**
 * 读缓存；超过 TTL（storedAt + 60000 ≤ now）视为过期并删除。命中不延长有效期。
 * @param {string} key 缓存键
 * @param {number} now 当前时间，毫秒
 * @returns {object|null} RecResult 的副本；未命中返回 null
 */
export function getCachedRecs(key, now) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (now - entry.storedAt >= REC_CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return structuredClone(entry.result);
}

/**
 * 写缓存（保存副本，调用方之后改动原对象不会影响缓存）。容量满时淘汰最旧的一条。
 * @param {string} key 缓存键
 * @param {object} result RecResult
 * @param {number} now 当前时间，毫秒
 * @returns {void}
 */
export function putCachedRecs(key, result, now) {
  cache.delete(key);
  cache.set(key, { result: structuredClone(result), storedAt: now });
  while (cache.size > REC_CACHE_CAPACITY) {
    cache.delete(cache.keys().next().value);
  }
}

/** @returns {void} 清空全部缓存；模块加载时注册到 onReset，测试 reset 时调用。 */
export function clearRecCache() {
  cache.clear();
}

onReset(clearRecCache);
