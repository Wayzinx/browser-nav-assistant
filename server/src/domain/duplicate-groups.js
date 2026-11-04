import { buildDupKey } from './url.js';

// @code C-BE-CLEAN-02
function toMergeSuggestion(group) {
  const ordered = [...group].sort((left, right) => left.url.length - right.url.length || left.url.localeCompare(right.url));
  const keep = ordered[0];
  return {
    action: 'merge',
    urls: ordered.map((page) => page.url),
    titles: ordered.map((page) => page.title),
    keepUrl: keep.url,
    title: keep.title,
    reason: '去掉 query 参数后 URL 相同，疑似重复页面',
  };
}

/**
 * D-07 保留语义 query；未归档页面按 dupKey 分组，组内按 URL 长度升序选保留页。
 * @param {object[]} pages 已校验的 Page 数组
 * @returns {object[]} 尚未添加稳定 key 的 merge 建议；一组至少两个页面
 */
export function buildMergeGroups(pages) {
  const groups = new Map();
  for (const page of pages) {
    if (page.isArchived) continue;
    const key = buildDupKey(page.normalizedUrl || page.url);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(page);
  }
  return [...groups.values()].filter((group) => group.length >= 2).map(toMergeSuggestion);
}
