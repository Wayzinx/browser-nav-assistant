import { DEFAULTS } from './constants.js';

/**
 * 仅隐藏七天内的有效忽略项；未来、非整数和过期时间不生效，保留后端顺序。
 * @param {Object[]} suggestions 原始后端建议。
 * @param {Object<string, number>} ignoredSuggestions 本地忽略时间表。
 * @param {number} [now=Date.now()] 当前毫秒时间。
 * @returns {Object[]} 仍需展示的建议。
 */
// @code C-FE-CLEAN-01
export function filterIgnored(suggestions, ignoredSuggestions, now = Date.now()) {
  return suggestions.filter((item) => {
    const ignoredAt = Object.hasOwn(ignoredSuggestions ?? {}, item.key)
      ? ignoredSuggestions[item.key] : undefined;
    const age = now - ignoredAt;
    return !Number.isSafeInteger(ignoredAt) || ignoredAt <= 0
      || age < 0 || age >= DEFAULTS.IGNORED_SUGGESTION_TTL_MS;
  });
}

/**
 * 后台消息与 popup 快照共用的展示投影；不修改原响应或建议对象。
 * @param {Object} data 后端完整响应体。
 * @param {Object<string, number>} ignoredSuggestions 本地忽略时间表。
 * @param {number} [now=Date.now()] 当前毫秒时间。
 * @returns {Object} 过滤后的 suggestions、summary、pendingCount 及其余原始字段。
 */
// @code C-FE-CLEAN-01
export function projectCleanupResult(data, ignoredSuggestions, now = Date.now()) {
  const suggestions = filterIgnored(data.suggestions, ignoredSuggestions, now);
  const summary = { archive: 0, merge: 0, keep: 0 };
  for (const item of suggestions) {
    if (Object.hasOwn(summary, item.action)) summary[item.action] += 1;
  }
  return { ...data, suggestions, summary, pendingCount: summary.archive + summary.merge };
}
