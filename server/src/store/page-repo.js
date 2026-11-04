import { buildDupKey, domainOf, normalizeUrl, parseGithubRepo } from '../domain/url.js';
import { createIndexes } from './indexes.js';
import { nextId, onReset } from './state.js';

// @code C-BE-CORE-10
const pages = new Map();
const indexes = createIndexes();
const PAGE_FIELDS = ['title', 'visitCount', 'lastVisitedAt', 'firstSeenAt', 'sources', 'isOpen', 'isActive', 'isArchived', 'archivedAt', 'mergedInto', 'isImportant', 'updatedAt'];

function buildRecord(input, previous, id) {
  const normalizedUrl = normalizeUrl(input.normalizedUrl || input.url);
  if (!normalizedUrl) throw new TypeError('页面必须具有合法的 normalizedUrl 或 url');
  const record = {
    id,
    url: previous?.url ?? input.url ?? normalizedUrl,
    normalizedUrl,
    dupKey: buildDupKey(normalizedUrl),
    domain: domainOf(normalizedUrl),
    repo: parseGithubRepo(normalizedUrl)?.repo ?? null,
    title: previous?.title ?? input.url ?? normalizedUrl,
    visitCount: 1,
    lastVisitedAt: 0,
    firstSeenAt: 0,
    sources: [],
    isOpen: false,
    isActive: false,
    isArchived: false,
    archivedAt: null,
    mergedInto: null,
    isImportant: false,
    updatedAt: 0,
  };
  for (const key of PAGE_FIELDS) {
    if (Object.hasOwn(input, key)) record[key] = structuredClone(input[key]);
    else if (previous && Object.hasOwn(previous, key)) record[key] = structuredClone(previous[key]);
  }
  return record;
}

/** @param {object} input service 已合并的 Page 字段 @returns {object} upsert 后深副本；合并口径由 SYNC domain 决定。 */
export function upsertPage(input) {
  const key = normalizeUrl(input.normalizedUrl || input.url);
  if (!key) throw new TypeError('页面 URL 不合法');
  const previous = pages.get(key);
  const record = buildRecord(input, previous, previous?.id ?? nextId('page'));
  if (previous) indexes.remove(previous);
  pages.set(key, record);
  indexes.add(record);
  return structuredClone(record);
}

/** @param {string} url 原始或归一化 URL @returns {object|null} 页面深副本。 */
export function getPage(url) { const page = pages.get(normalizeUrl(url)); return page ? structuredClone(page) : null; }
/** @returns {object[]} 全部页面副本，包含归档页面。 */
export function listPages() { return structuredClone([...pages.values()]); }
function readKeys(keys) { return keys.map((key) => structuredClone(pages.get(key))); }
/** @returns {object[]} 打开页面副本，只遍历 openSet。 */
export function listOpenPages() { return readKeys(indexes.openKeys()); }
/** @param {string} key 判重键 @returns {object[]} 索引桶页面副本。 */
export function listByDupKey(key) { return readKeys(indexes.keys('dupKey', key)); }
/** @param {string} domain 精确域名，子域聚合由 service 决定 @returns {object[]} 页面副本。 */
export function listByDomain(domain) { return readKeys(indexes.keys('domain', domain)); }
/** @param {string} repo GitHub owner/repo @returns {object[]} 页面副本。 */
export function listByRepo(repo) { return readKeys(indexes.keys('repo', repo)); }
/** @param {string} domain 精确域名 @returns {number} 未归档页面访问次数之和。 */
export function getDomainVisits(domain) { return indexes.domainVisits(domain); }
/** @returns {number} 包括归档页面的总数。 */
export function countPages() { return pages.size; }
/** @returns {void} 清主表、二级索引和打开集合；ID 序号由 resetState 复位。 */
export function clearPages() { pages.clear(); indexes.clear(); }
/** @param {object[]} records PERSIST 已校验的快照 Page @returns {void} 启动时恢复并重建索引。 */
export function restorePages(records) {
  clearPages();
  for (const input of records) {
    const record = buildRecord(input, null, input.id);
    pages.set(record.normalizedUrl, record);
    indexes.add(record);
  }
}

onReset(clearPages);
