import { buildDupKey, domainOf, parseHttpUrl } from './url.js';

// @code C-BE-REC-05
/** 最近 20 条限制规则上下文，避免更久的历史补齐连续浏览次数。 */
export const RECENT_HISTORY_LIMIT = 20;
/** D-22 明确规则关联度与缺少目标记录时的固定搜索分数。 */
const RULE_REL = 0.95;
const SEARCH_SCORE = 0.8;

/** @param {object[]} rules 已保存规则 @param {{recentHistory?:object[]}} options 上下文 @returns {object[]} 启用且连续不同 dupKey 达到阈值的规则。 */
export function detectTriggeredRules(rules, { recentHistory = [] }) {
  const recent = recentHistory.slice().sort((a, b) => b.lastVisitTime - a.lastVisitTime).slice(0, RECENT_HISTORY_LIMIT);
  return rules.filter((rule) => {
    if (rule.type !== 'recommend_related' || rule.enabled === false || !rule.trigger || !rule.target) return false;
    const seen = new Set();
    for (const page of recent) {
      if (domainOf(page.url) !== rule.trigger.domain) break;
      const key = buildDupKey(page.url);
      if (key) seen.add(key);
      if (seen.size >= rule.trigger.minCount) return true;
    }
    return false;
  });
}

/** @param {object} entry RankedEntry @param {{triggeredRules:object[]}} options 已触发规则 @returns {object|null} 首个匹配目标域名的规则召回。 */
export function matchRuleTarget(entry, { triggeredRules }) {
  const rule = triggeredRules.find((item) => domainOf(entry.page.url) === item.target.domain);
  if (!rule) return null;
  return {
    ...entry, rel: RULE_REL, strategy: 'rule',
    reason: `你已连续浏览 ${rule.trigger.minCount} 个 ${rule.trigger.label || rule.trigger.domain} 页面，按你的规则推荐相关 ${rule.target.label || rule.target.domain} 页面`,
  };
}

/** @param {object} rule 已触发规则 @param {{currentPage:object|null}} options 当前上下文 @returns {object|null} 站内搜索候选，固定 final=0.8，不伪造历史页面。 */
export function buildSiteSearchFallback(rule, { currentPage }) {
  const url = parseHttpUrl(`https://${rule.target.domain}/`);
  if (!url || url.hostname !== rule.target.domain || url.port || url.username || url.password) return null;
  const query = (currentPage?.title || '').split(/[–|\-]/)[0].trim();
  url.pathname = '/zh-CN/search';
  url.searchParams.set('q', query);
  const label = rule.target.label || rule.target.domain;
  return {
    id: `rec_rule_${rule.id}`, url: url.href,
    title: `在 ${label} 中搜索「${query}」`, strategy: 'rule', fixedScore: SEARCH_SCORE,
    reason: `你已连续浏览 ${rule.trigger.minCount} 个 ${rule.trigger.label || rule.trigger.domain} 页面，库中暂无 ${label} 记录，按规则推荐站内搜索`,
  };
}
