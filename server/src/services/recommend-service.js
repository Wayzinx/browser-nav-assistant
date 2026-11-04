import { now as clockNow } from '../lib/clock.js';
import { getVersions } from '../store/state.js';
import { listRules } from '../store/rule-repo.js';
import { getSettings } from '../store/settings-repo.js';
import { getRankSnapshot } from './rank-service.js';
import { buildRecCacheKey, getCachedRecs, putCachedRecs } from './rec-cache.js';
import { buildDupKey, domainOf, normalizeUrl, parseGithubRepo } from '../domain/url.js';
import { matchSameRepo } from '../domain/rec-same-repo.js';
import { matchSameDocSite, matchSameDomain } from '../domain/rec-site.js';
import { matchGlobalTop } from '../domain/rec-fallback.js';
import { RECENT_HISTORY_LIMIT, detectTriggeredRules, matchRuleTarget, buildSiteSearchFallback } from '../domain/rec-rule-trigger.js';
import { rankRecommendations } from '../domain/rec-rank.js';

// @code C-BE-REC-07
/** 每个索引桶只读取 Top 50，合并后最多 200；请求耗时不随全库条数增长。 */
const BUCKET_LIMIT = 50;
const CANDIDATE_LIMIT = 200;

/** @param {object} snapshot 冻结的 RankSnapshot @param {object} options currentPage/triggeredRules @returns {object[]} 索引召回；规则优先，同一 URL 只选一个策略。 */
export function collectCandidates(snapshot, { currentPage, triggeredRules = [] }) {
  const options = { currentPage, triggeredRules };
  const selected = new Map();
  const append = (bucket = []) => {
    for (const entry of bucket.slice(0, BUCKET_LIMIT)) {
      const key = entry.page.normalizedUrl || normalizeUrl(entry.page.url);
      if (selected.has(key)) continue;
      if (selected.size >= CANDIDATE_LIMIT) break;
      const candidate = matchRuleTarget(entry, options) || matchSameRepo(entry, options)
        || matchSameDocSite(entry, options) || matchSameDomain(entry, options) || matchGlobalTop(entry);
      selected.set(key, candidate);
    }
  };
  for (const rule of triggeredRules) {
    const bucket = snapshot.domainTop.get(rule.target.domain) || [];
    if (bucket.length) append(bucket);
    else {
      const candidate = buildSiteSearchFallback(rule, options);
      if (candidate && selected.size < CANDIDATE_LIMIT) selected.set(candidate.url, candidate);
    }
    if (selected.size >= CANDIDATE_LIMIT) break;
  }
  const repo = parseGithubRepo(currentPage?.url)?.repo;
  if (repo) append(snapshot.repoTop.get(repo));
  const domain = domainOf(currentPage?.url);
  if (domain) append(snapshot.domainTop.get(domain));
  append(snapshot.ordered);
  return [...selected.values()];
}

/** @param {object} input 路由已校验的上下文 @param {{now?:number,nowOverride?:number}} [options] 请求时间 @returns {object} RecResult；缓存先查，查询不写页面与规则。 */
export function recommendNext(input, { now = clockNow(), nowOverride } = {}) {
  const recentHistory = input.recentHistory.slice().sort((a, b) => b.lastVisitTime - a.lastVisitTime).slice(0, RECENT_HISTORY_LIMIT);
  const key = buildRecCacheKey({
    currentUrl: normalizeUrl(input.currentPage?.url) || '',
    openDupKeys: [...new Set(input.openTabs.map((page) => buildDupKey(page.url)).filter(Boolean))].sort(),
    recentDupKeys: recentHistory.map((page) => buildDupKey(page.url)),
    versions: getVersions(), nowOverride,
  });
  const cached = getCachedRecs(key, now);
  if (cached) return { ...cached, cached: true };
  const rules = listRules();
  const triggeredRules = detectTriggeredRules(rules, { recentHistory });
  const candidates = collectCandidates(getRankSnapshot({ now: nowOverride }), { currentPage: input.currentPage, triggeredRules });
  const recommendations = rankRecommendations(candidates, { ...input, now, rules, settings: getSettings() });
  const result = { recommendations, cached: false, generatedAt: now };
  putCachedRecs(key, result, now);
  return result;
}
