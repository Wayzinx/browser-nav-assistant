import { LIMITS } from '../config.js';
import { createValidator } from '../lib/validate.js';
import { readJsonBody, sendJson } from '../lib/http.js';
import { resolveNow } from '../lib/clock.js';
import { parseHttpUrl } from '../domain/url.js';
import { recommendNext } from '../services/recommend-service.js';

// @code C-BE-REC-01
function readPage(raw, field, validator, history = false) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    validator.invalid(field);
    return null;
  }
  const item = createValidator(raw);
  const url = item.readString('url', { required: true, min: 1, max: LIMITS.maxUrlLength });
  const title = item.readString('title', { defaultValue: '' });
  if (!parseHttpUrl(url)) item.invalid('url');
  // 契约为 number(ms)，浏览器会提供小数毫秒；按原值校验，保留访问时间精度。
  const lastVisitTime = history ? item.value('lastVisitTime') : undefined;
  if (history && (!Number.isFinite(lastVisitTime) || lastVisitTime < 0)) item.invalid('lastVisitTime');
  try {
    item.assertValid();
  } catch (error) {
    // 子项错误带完整字段路径，调用方可以定位具体数组元素。
    error.details.fields = error.details.fields.map((key) => `${field}.${key}`);
    throw error;
  }
  return history ? { url, title, lastVisitTime } : { url, title };
}

/** @param {object} input 请求体 @returns {object} 白名单上下文；currentPage 必填可为 null，数组最多 500 条。 */
export function parseRecommendBody(input) {
  const validator = createValidator(input);
  const rawCurrent = validator.value('currentPage');
  if (rawCurrent === undefined) validator.invalid('currentPage');
  const openTabs = validator.readArray('openTabs', { defaultValue: [], max: LIMITS.maxArrayItems });
  const recentHistory = validator.readArray('recentHistory', { defaultValue: [], max: LIMITS.maxArrayItems });
  const currentPage = rawCurrent === null || rawCurrent === undefined ? null : readPage(rawCurrent, 'currentPage', validator);
  validator.assertValid();
  const pages = openTabs.map((page, i) => readPage(page, `openTabs[${i}]`, validator));
  const history = recentHistory.map((page, i) => readPage(page, `recentHistory[${i}]`, validator, true));
  validator.assertValid();
  return {
    currentPage,
    openTabs: pages,
    recentHistory: history,
  };
}

async function recommend(req, res, { query }) {
  const input = parseRecommendBody(await readJsonBody(req));
  const now = resolveNow(query);
  const result = recommendNext(input, { now, nowOverride: query.has('now') ? now : undefined });
  sendJson(res, 200, result);
}

/** @type {{method:string,path:string,handler:Function}[]} 推荐查询不写入页面或规则。 */
export const recommendationRoutes = [
  { method: 'POST', path: '/api/recommendations/next', handler: recommend },
];
