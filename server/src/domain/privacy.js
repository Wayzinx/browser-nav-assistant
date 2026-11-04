// @code C-BE-PRIV-01
/**
 * 按 D-18 只匹配完整 URL，不检查标题；子串匹配也会命中包含关键词的长单词。
 * @param {string} url 待检查的 URL
 * @param {string[]} keywords 敏感关键词，按列表顺序决定首次命中
 * @returns {string|null} 小写的首个命中关键词，未命中为 null
 */
export function findSensitiveKeyword(url, keywords) {
  const text = url.toLowerCase();
  return normalizeKeywords(keywords).find((keyword) => text.includes(keyword)) ?? null;
}

/**
 * 保留首次出现顺序，去掉空白项，避免空字符串匹配所有 URL。
 * @param {string[]} keywords 已校验的关键词列表，允许空数组
 * @returns {string[]} trim、转小写、去重后的新数组
 */
export function normalizeKeywords(keywords) {
  return [...new Set(keywords.map((keyword) => keyword.trim().toLowerCase()).filter(Boolean))];
}
