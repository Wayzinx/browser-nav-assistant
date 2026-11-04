import { MIN_RECOMMENDATION_SCORE } from '../config.js';
import { buildDupKey } from './url.js';
import { round2 } from './scoring.js';
import { decideArchive } from './archive-verdict.js';

// @code C-BE-REC-06
/** D-22：关联度是主要信号，历史质量是次要信号；最终只展示 Top 5。 */
const FINAL_WEIGHTS = { rel: 0.6, quality: 0.4 };
const RECOMMENDATION_LIMIT = 5;

/** @param {{currentPage?:object|null,openTabs?:object[]}} input 上下文 @returns {Set<string>} 当前及打开页面的 dupKey 集合。 */
export function buildExclusionKeys({ currentPage = null, openTabs = [] }) {
  return new Set([currentPage, ...openTabs].filter(Boolean).map((page) => buildDupKey(page.url)).filter(Boolean));
}

function compare(a, b) {
  return b.final - a.final || (b.score ?? 0) - (a.score ?? 0) || (b.page?.lastVisitedAt ?? 0) - (a.page?.lastVisitedAt ?? 0);
}

/** @param {object[]} candidates 召回候选 @param {object} options now/rules/settings/currentPage/openTabs @returns {object[]} final 先舍入再按 >=0.3 过滤，dupKey 取最高分，最多 5 条 DTO。 */
export function rankRecommendations(candidates, options) {
  const { now, rules = [], settings, currentPage = null } = options;
  const exclusions = buildExclusionKeys(options);
  const best = new Map();
  for (const candidate of candidates) {
    const page = candidate.page;
    const key = buildDupKey(page?.url || candidate.url);
    if (!key || exclusions.has(key)) continue;
    if (page && (page.isArchived || decideArchive(page, { rules, settings, now }).verdict === 'archive')) continue;
    const final = candidate.fixedScore ?? round2(FINAL_WEIGHTS.rel * candidate.rel + FINAL_WEIGHTS.quality * candidate.score);
    if (final < MIN_RECOMMENDATION_SCORE) continue;
    const ranked = { ...candidate, final };
    if (!best.has(key) || compare(ranked, best.get(key)) < 0) best.set(key, ranked);
  }
  return [...best.values()].sort(compare).slice(0, RECOMMENDATION_LIMIT).map((candidate) => ({
    id: candidate.id || `rec_${candidate.page.id.replace(/^page_/, '')}`,
    type: 'next_visit', url: candidate.page?.url || candidate.url,
    title: candidate.page?.title || candidate.title,
    score: candidate.final, reason: candidate.reason, strategy: candidate.strategy,
    contextUrl: currentPage?.url ?? null, createdAt: now,
  }));
}
