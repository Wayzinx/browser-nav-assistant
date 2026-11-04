import { DEFAULT_SETTINGS } from '../config.js';
import { decideArchive } from './archive-verdict.js';
import { buildMergeGroups } from './duplicate-groups.js';
import { buildDupKey, normalizeUrl } from './url.js';

// @code C-BE-CLEAN-03
/**
 * 忽略记录依据稳定的存储主键或判重 key，规则理由和查询时间变化不改变 key。
 * @param {'archive'|'merge'|'keep'} action 建议动作
 * @param {string} url 页面 URL；merge 时传组内任意 URL
 * @returns {string} action:normalizedUrl 或 merge:dupKey
 */
export function buildSuggestionKey(action, url) {
  const key = action === 'merge' ? buildDupKey(url) : normalizeUrl(url);
  if (!key) throw new TypeError('建议 URL 必须为 http(s) 地址');
  return `${action}:${key}`;
}

/** @param {object[]} suggestions 整理建议 @returns {{archive:number,merge:number,keep:number}} 三类建议的条数。 */
export function summarizeSuggestions(suggestions) {
  const summary = { archive: 0, merge: 0, keep: 0 };
  for (const suggestion of suggestions) {
    if (Object.hasOwn(summary, suggestion.action)) summary[suggestion.action] += 1;
  }
  return summary;
}

/**
 * 只输出未归档页面；archive 按整天数降序，然后输出 merge、keep。
 * @param {object[]} pages 已校验的 Page 数组
 * @param {{rules:object[],settings:object,now:number}} options 规则、配置与本次查询时间
 * @returns {{summary:object,suggestions:object[],thresholdDays:number,generatedAt:number}} 契约 DTO
 */
export function buildCleanupSuggestions(pages, { rules = [], settings = DEFAULT_SETTINGS, now }) {
  const available = pages.filter((page) => !page.isArchived);
  const archive = [];
  const keep = [];
  for (const page of available) {
    const verdict = decideArchive(page, { rules, settings, now });
    if (!['archive', 'keep'].includes(verdict.verdict)) continue;
    const suggestion = {
      key: buildSuggestionKey(verdict.verdict, page.normalizedUrl || page.url),
      action: verdict.verdict,
      url: page.url,
      title: page.title,
      reason: verdict.reason,
      ageDays: verdict.ageDays,
      ruleId: verdict.ruleId,
    };
    if (suggestion.action === 'archive') {
      suggestion.lastVisitedAt = page.lastVisitedAt;
      archive.push(suggestion);
    } else keep.push(suggestion);
  }
  archive.sort((left, right) => right.ageDays - left.ageDays || left.key.localeCompare(right.key));
  const merge = buildMergeGroups(available).map((suggestion) => ({
    key: buildSuggestionKey('merge', suggestion.keepUrl), ...suggestion,
  }));
  const suggestions = [...archive, ...merge, ...keep];
  return {
    summary: summarizeSuggestions(suggestions), suggestions,
    thresholdDays: settings.cleanupThresholdDays, generatedAt: now,
  };
}
