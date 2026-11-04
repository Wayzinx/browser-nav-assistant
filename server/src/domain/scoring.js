import { DAY_MS, RECENCY_HALF_LIFE_DAYS, SCORE_WEIGHTS } from '../config.js';

// @code C-BE-RANK-01
/**
 * 归一化只统计未归档页面；空库的分母至少为 1，避免除零。
 * @param {object[]} pages 页面记录
 * @returns {{maxVisitCount:number, domainVisits:Map<string,number>, maxDomainVisits:number}} 全局因子
 */
export function computeNormalizers(pages) {
  let maxVisitCount = 1;
  let maxDomainVisits = 1;
  const domainVisits = new Map();
  for (const page of pages) {
    if (page.isArchived) continue;
    maxVisitCount = Math.max(maxVisitCount, page.visitCount);
    const visits = (domainVisits.get(page.domain) ?? 0) + page.visitCount;
    domainVisits.set(page.domain, visits);
    maxDomainVisits = Math.max(maxDomainVisits, visits);
  }
  return { maxVisitCount, domainVisits, maxDomainVisits };
}

/**
 * 返回未舍入的分量，先合成总分再分别舍入，避免中间值改变排序。
 * @param {object} page 页面记录
 * @param {{now:number, normalizers:object, domainBoost:object}} options 计算时刻、归一化因子、域名加权
 * @returns {{recency:number, frequency:number, open:number, domain:number, domainSource:string}} 0–1 分量
 */
export function computeScoreDetail(page, { now, normalizers, domainBoost }) {
  const ageDays = Math.max(0, now - page.lastVisitedAt) / DAY_MS;
  return {
    recency: 0.5 ** (ageDays / RECENCY_HALF_LIFE_DAYS),
    frequency: Math.log1p(page.visitCount) / Math.log1p(normalizers.maxVisitCount),
    open: page.isOpen ? 1 : 0,
    domain: domainBoost.domain,
    domainSource: domainBoost.domainSource,
  };
}

/** @param {object} detail 未舍入的四个评分分量 @returns {number} D-05 加权后保留两位小数的 0–1 分数。 */
export function combineScore(detail) {
  const score = SCORE_WEIGHTS.recency * detail.recency + SCORE_WEIGHTS.frequency * detail.frequency
    + SCORE_WEIGHTS.open * detail.open + SCORE_WEIGHTS.domain * detail.domain;
  return round2(score);
}

/** @param {number} x 数值 @returns {number} 四舍五入到两位小数；也供推荐与整理使用。 */
export function round2(x) {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}
