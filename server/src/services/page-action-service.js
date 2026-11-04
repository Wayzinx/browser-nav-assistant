import { normalizeUrl } from '../domain/url.js';
import { now } from '../lib/clock.js';
import { AppError } from '../lib/errors.js';
import { getPage, upsertPage } from '../store/page-repo.js';
import { bumpDataVersion } from '../store/state.js';

// @code C-BE-CLEAN-05
function setArchived(urls, isArchived, at) {
  const keys = [...new Set(urls.map(normalizeUrl))];
  const pages = keys.map(getPage).filter(Boolean);
  if (!pages.length) throw new AppError('NOT_FOUND', 404, '页面不存在');
  let affected = 0;
  for (const page of pages) {
    if (page.isArchived === isArchived) continue;
    upsertPage({
      ...page, isArchived, archivedAt: isArchived ? at : null,
      mergedInto: isArchived ? page.mergedInto : null, updatedAt: at,
    });
    affected += 1;
  }
  if (affected) bumpDataVersion();
  return { affected, notFound: keys.length - pages.length };
}

/**
 * 按归一化 URL 去重；只统计实际状态变化，归档页面仍保留在仓储中。
 * @param {string[]} urls 已校验的页面 URL
 * @param {{now?:number}} [options] 操作时间
 * @returns {{ok:true,affected:number,archivedAt:number,notFound:number}}
 */
export function archivePages(urls, { now: at = now() } = {}) {
  const result = setArchived(urls, true, at);
  return { ok: true, affected: result.affected, archivedAt: at, notFound: result.notFound };
}

/**
 * 撤销归档时清除归档时间与合并关联；版本变更让排序、推荐缓存失效。
 * @param {string[]} urls 已校验的页面 URL
 * @param {{now?:number}} [options] 操作时间
 * @returns {{ok:true,affected:number,notFound:number}}
 */
export function unarchivePages(urls, { now: at = now() } = {}) {
  return { ok: true, ...setArchived(urls, false, at) };
}

function combinePages(keep, donors, at) {
  const pages = [keep, ...donors];
  // 整理合并是多个页面统计求和，与同步重复上报的 visitCount 取 max 不同。
  return {
    ...keep,
    visitCount: pages.reduce((sum, page) => sum + page.visitCount, 0),
    lastVisitedAt: Math.max(...pages.map((page) => page.lastVisitedAt)),
    firstSeenAt: Math.min(...pages.map((page) => page.firstSeenAt)),
    sources: [...new Set(pages.flatMap((page) => page.sources))],
    isImportant: pages.some((page) => page.isImportant),
    isArchived: false, archivedAt: null, mergedInto: null, updatedAt: at,
  };
}

/**
 * 先查保留页再写入；已归档的成员不重复并入，重放同一请求不会重复累计次数。
 * @param {{urls:string[],keepUrl:string}} input 已校验的合并组与保留 URL
 * @param {{now?:number}} [options] 操作时间
 * @returns {{ok:true,keepUrl:string,merged:number}}
 */
export function mergePages({ urls, keepUrl }, { now: at = now() } = {}) {
  const keep = getPage(keepUrl);
  if (!keep) throw new AppError('NOT_FOUND', 404, '页面不存在');
  const keys = [...new Set(urls.map(normalizeUrl))].filter((key) => key !== keep.normalizedUrl);
  const donors = keys.map(getPage).filter((page) => page && !page.isArchived);
  if (donors.length) {
    upsertPage(combinePages(keep, donors, at));
    for (const page of donors) upsertPage({
      ...page, isArchived: true, archivedAt: at, mergedInto: keep.normalizedUrl, updatedAt: at,
    });
    bumpDataVersion();
  }
  return { ok: true, keepUrl: keep.url, merged: donors.length };
}
