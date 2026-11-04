// @code C-BE-PERF-02
// 桶内 Top-K（F-PERF-01、BE-PERF-02）：排序快照构建时，为每个域名 / GitHub 仓库保留前 K 个页面，
// 推荐召回只读这些桶，不扫全表。输入已按 score 降序，所以顺序追加、桶满即停就是 Top-K，整体 O(n)。纯函数。

/** 每个桶默认保留的页面数（技术方案 §7）。 */
export const BUCKET_TOP_K = 50;

/**
 * 往桶里追加一个元素；桶已满（长度 ≥ k）时不追加。调用方保证按优先级从高到低依次追加。
 * @param {object[]} bucket 目标桶（会被原地追加）
 * @param {object} entry 要追加的元素
 * @param {number} [k] 桶容量
 * @returns {boolean} 是否追加成功
 */
export function pushTopK(bucket, entry, k = BUCKET_TOP_K) {
  if (bucket.length >= k) return false;
  bucket.push(entry);
  return true;
}

/**
 * 一次遍历已排序数组，按 keyOf 分桶，每桶只保留前 k 个。keyOf 返回 null / 空串的元素不进任何桶。
 * 不修改 ordered，也不重新排序。
 * @param {object[]} ordered 已按 score 降序的 RankedEntry 数组
 * @param {(entry:object) => (string|null)} keyOf 分桶键函数
 * @param {number} [k] 桶容量（非正数时返回空 Map）
 * @returns {Map<string, object[]>} 桶键 → 该桶前 k 个元素（保持原顺序）
 */
export function buildBucketTopK(ordered, keyOf, k = BUCKET_TOP_K) {
  const buckets = new Map();
  if (!(k > 0)) return buckets;
  for (const entry of ordered) {
    const key = keyOf(entry);
    if (!key) continue;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    pushTopK(bucket, entry, k);
  }
  return buckets;
}
