import { now as clockNow } from '../lib/clock.js';
import { log } from '../lib/logger.js';
import { listPages } from '../store/page-repo.js';
import { listRules } from '../store/rule-repo.js';
import { getSettings } from '../store/settings-repo.js';
import { getVersions, onReset, onStateChange } from '../store/state.js';
import { computeNormalizers, computeScoreDetail, combineScore, round2 } from '../domain/scoring.js';
import { resolveDomainBoost } from '../domain/domain-boost.js';
import { buildRankReason } from '../domain/rank-reason.js';
import { buildBucketTopK } from '../domain/top-k.js';

// @code C-BE-RANK-04
/** 默认快照一分钟内新鲜，一小时内返回旧值并后台刷新，超过一小时必须同步刷新。 */
const RANK_FRESH_MS = 60_000;
const RANK_STALE_MAX_MS = 3_600_000;
/** 时间覆盖与默认缓存隔离，限制复算请求的内存占用。 */
const NOW_LRU_SIZE = 8;
/** 域名筛选选项最多 50 个，始终基于全部未归档页面。 */
const DOMAIN_LIST_LIMIT = 50;
const nowCache = new Map();
let defaultSnapshot = null;
let rebuildTask = null;

function versionKey(versions) {
  return `${versions.data}:${versions.rule}:${versions.config}`;
}

function compareEntries(a, b) {
  return b.score - a.score || b.page.lastVisitedAt - a.page.lastVisitedAt;
}

function scorePage(page, context) {
  const domainBoost = resolveDomainBoost(page, context);
  const detail = computeScoreDetail(page, { ...context, domainBoost });
  return {
    page,
    score: combineScore(detail),
    scoreDetail: {
      recency: round2(detail.recency),
      frequency: round2(detail.frequency),
      open: detail.open,
      domain: round2(detail.domain),
      domainSource: detail.domainSource,
    },
    reason: buildRankReason(page, { ...context, scoreDetail: detail }),
  };
}

function indexEntries(ordered) {
  const byUrl = new Map();
  const byDomain = new Map();
  const bestByDupKey = new Map();
  const openOrdered = [];
  for (const entry of ordered) {
    const page = entry.page;
    byUrl.set(page.normalizedUrl, entry);
    if (!byDomain.has(page.domain)) byDomain.set(page.domain, []);
    byDomain.get(page.domain).push(entry);
    if (page.isOpen) openOrdered.push(entry);
    if (!bestByDupKey.has(page.dupKey)) bestByDupKey.set(page.dupKey, page.normalizedUrl);
  }
  const domainList = [...byDomain.keys()].sort((a, b) => byDomain.get(b).length - byDomain.get(a).length || a.localeCompare(b));
  return {
    byUrl, byDomain, bestByDupKey, openOrdered,
    domainTop: buildBucketTopK(ordered, (entry) => entry.page.domain),
    repoTop: buildBucketTopK(ordered, (entry) => entry.page.repo),
    domainList: domainList.slice(0, DOMAIN_LIST_LIMIT),
  };
}

/**
 * 只通过仓储读数据；整个快照使用同一个 now 与版本号，归档页不参与评分或归一化。
 * @param {{now?:number}} [options] 评分时刻
 * @returns {object} RankSnapshot，ordered 内每项为 { page, score, scoreDetail, reason }
 */
export function buildRankSnapshot({ now = clockNow() } = {}) {
  const versions = getVersions();
  const pages = listPages().filter((page) => !page.isArchived);
  const context = { now, normalizers: computeNormalizers(pages), rules: listRules(), settings: getSettings() };
  const ordered = pages.map((page) => scorePage(page, context)).sort(compareEntries);
  return { versions, builtAt: now, ordered, ...indexEntries(ordered) };
}

/**
 * @param {{now?:number}} [options] 仅显式传入 now 才走独立的容量 8 LRU
 * @returns {object} RankSnapshot：versions/builtAt/ordered/byUrl/domainTop/repoTop/bestByDupKey/domainList
 */
export function getRankSnapshot({ now } = {}) {
  const versions = getVersions();
  const key = versionKey(versions);
  if (now !== undefined) {
    const cacheKey = `${key}:${now}`;
    let snapshot = nowCache.get(cacheKey);
    if (snapshot) nowCache.delete(cacheKey);
    else snapshot = buildRankSnapshot({ now });
    nowCache.set(cacheKey, snapshot);
    if (nowCache.size > NOW_LRU_SIZE) nowCache.delete(nowCache.keys().next().value);
    return snapshot;
  }
  const age = defaultSnapshot ? clockNow() - defaultSnapshot.builtAt : Infinity;
  if (!defaultSnapshot || key !== versionKey(defaultSnapshot.versions) || age < 0 || age > RANK_STALE_MAX_MS) {
    defaultSnapshot = buildRankSnapshot();
  } else if (age > RANK_FRESH_MS) {
    scheduleRankRebuild();
  }
  return defaultSnapshot;
}

/** @returns {void} 写后合并为一个 setImmediate 任务，始终基于执行时的最新仓储状态预建默认快照。 */
export function scheduleRankRebuild() {
  if (rebuildTask !== null) return;
  rebuildTask = setImmediate(() => {
    rebuildTask = null;
    try {
      defaultSnapshot = buildRankSnapshot();
    } catch (error) {
      // 后台失败保留旧快照并记录错误；下一次读仍会按版本/过时上限同步重试。
      log('error', '排序快照重建失败', { stack: error.stack });
    }
  });
}

/** @returns {void} 清理两类缓存与尚未执行的重建，避免 reset 后返回旧数据或重放旧任务。 */
export function resetRankCache() {
  if (rebuildTask !== null) clearImmediate(rebuildTask);
  rebuildTask = null;
  defaultSnapshot = null;
  nowCache.clear();
}

/** @param {object} snapshot 排序快照 @returns {string[]} 全部未归档域名的前 50 项副本，不受查询筛选影响。 */
export function listRankedDomains(snapshot = getRankSnapshot()) {
  return snapshot.domainList.slice();
}

function selectEntries(snapshot, domain, openOnly) {
  if (!domain) return openOnly ? snapshot.openOrdered : snapshot.ordered;
  const buckets = [];
  for (const [name, bucket] of snapshot.byDomain) {
    if (name === domain || name.endsWith(`.${domain}`)) buckets.push(bucket);
  }
  let selected = buckets.length === 1 ? buckets[0] : buckets.flat().sort(compareEntries);
  if (openOnly) selected = selected.filter((entry) => entry.page.isOpen);
  return selected;
}

/**
 * @param {{limit:number, domain?:string, openOnly?:boolean}} input 路由已校验的查询
 * @param {{now?:number}} [options] 可选时间覆盖
 * @returns {{pages:object[], total:number, domains:string[], generatedAt:number}} pages 为 RankedEntry，交由路由转 DTO
 */
export function queryRanked({ limit, domain, openOnly = false }, options = {}) {
  const snapshot = getRankSnapshot(options);
  const selected = selectEntries(snapshot, domain?.trim().toLowerCase(), openOnly);
  return {
    pages: selected.slice(0, limit),
    total: selected.length,
    domains: listRankedDomains(snapshot),
    generatedAt: snapshot.builtAt,
  };
}

onReset(resetRankCache);
onStateChange(scheduleRankRebuild);
