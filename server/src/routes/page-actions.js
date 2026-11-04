import { LIMITS } from '../config.js';
import { normalizeUrl } from '../domain/url.js';
import { readJsonBody, sendJson } from '../lib/http.js';
import { createValidator } from '../lib/validate.js';
import { archivePages, mergePages, unarchivePages } from '../services/page-action-service.js';

// @code C-BE-CLEAN-05
/** 合并请求上限独立于同步上限，与合并接口的 2–50 条契约一致。 */
const MAX_MERGE_URLS = 50;

function readActionUrls(validator, min, max) {
  const urls = validator.value('urls');
  // 本接口数组超限按契约返回 400；公共 readArray 的 413 口径用于同步接口。
  if (!Array.isArray(urls) || urls.length < min || urls.length > max ||
      urls.some((url) => typeof url !== 'string' || !normalizeUrl(url))) {
    validator.invalid('urls');
    return [];
  }
  return [...urls];
}

function parseArchiveBody(body) {
  const validator = createValidator(body);
  const urls = readActionUrls(validator, 1, LIMITS.maxArrayItems);
  validator.assertValid();
  return urls;
}

function parseMergeBody(body) {
  const validator = createValidator(body);
  const urls = readActionUrls(validator, 2, MAX_MERGE_URLS);
  const keepUrl = validator.readString('keepUrl', { required: true, min: 1, max: LIMITS.maxUrlLength });
  const keys = new Set(urls.map(normalizeUrl));
  if (keys.size < 2) validator.invalid('urls');
  if (!normalizeUrl(keepUrl) || !keys.has(normalizeUrl(keepUrl))) validator.invalid('keepUrl');
  validator.assertValid();
  return { urls, keepUrl };
}

async function handleArchive(req, res) {
  sendJson(res, 200, archivePages(parseArchiveBody(await readJsonBody(req))));
}

async function handleUnarchive(req, res) {
  sendJson(res, 200, unarchivePages(parseArchiveBody(await readJsonBody(req))));
}

async function handleMerge(req, res) {
  sendJson(res, 200, mergePages(parseMergeBody(await readJsonBody(req))));
}

/** @type {{method:string,path:string,handler:Function}[]} 整理操作路由，完整校验后才修改状态。 */
export const pageActionRoutes = [
  { method: 'POST', path: '/api/pages/archive', handler: handleArchive },
  { method: 'POST', path: '/api/pages/unarchive', handler: handleUnarchive },
  { method: 'POST', path: '/api/pages/merge', handler: handleMerge },
];
