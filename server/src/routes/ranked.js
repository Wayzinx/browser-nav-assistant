import { resolveNow } from '../lib/clock.js';
import { sendJson } from '../lib/http.js';
import { createValidator } from '../lib/validate.js';
import { queryRanked } from '../services/rank-service.js';

// @code C-BE-RANK-05
/** 排序接口独有的分页上限，与 API 契约一致。 */
const RANKED_LIMIT = Object.freeze({ min: 1, max: 500, default: 20 });

function handleRanked(_req, res, { query }) {
  const validator = createValidator(query);
  const limit = validator.readInt('limit', { min: RANKED_LIMIT.min, max: RANKED_LIMIT.max, defaultValue: RANKED_LIMIT.default, coerce: true });
  const domain = validator.readString('domain');
  const openOnly = validator.readBool('openOnly', { defaultValue: false, coerce: true });
  validator.assertValid();
  const now = resolveNow(query);
  const result = queryRanked({ limit, domain, openOnly }, { now: query.has('now') ? now : undefined });
  sendJson(res, 200, { ...result, pages: result.pages.map(toRankedPageDto) });
}

/** @type {{method:string,path:string,handler:Function}[]} 排序读接口；不支持的方法由统一路由器返回 405。 */
export const rankedRoutes = [
  { method: 'GET', path: '/api/pages/ranked', handler: handleRanked },
];

/** @param {object} entry 排序快照的 RankedEntry @returns {object} 契约白名单 DTO，内部索引和归档字段不外泄。 */
export function toRankedPageDto({ page, score, scoreDetail, reason }) {
  return {
    id: page.id,
    url: page.url,
    normalizedUrl: page.normalizedUrl,
    title: page.title,
    domain: page.domain,
    visitCount: page.visitCount,
    lastVisitedAt: page.lastVisitedAt,
    firstSeenAt: page.firstSeenAt,
    sources: page.sources.slice(),
    isOpen: page.isOpen,
    isActive: page.isActive,
    isImportant: page.isImportant,
    score,
    scoreDetail: { ...scoreDetail },
    reason,
  };
}
