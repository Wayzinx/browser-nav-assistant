import { createPageRecord, mergeObservation } from '../domain/page-merge.js';
import { sanitizeEntry } from '../domain/sync-sanitize.js';
import { now } from '../lib/clock.js';
import { countPages, getPage, upsertPage } from '../store/page-repo.js';
import { bumpDataVersion } from '../store/state.js';
import { getEffectiveKeywords, isPrivacyFilterEnabled } from './privacy-service.js';

// @code C-BE-MENU-01
/**
 * 合并 manual 来源，只写目标单页；拒收不写库、不分配 ID、不改变版本或同步日志。
 * @param {{url:string,title?:string}} input 路由已校验的白名单字段
 * @param {{now?:number}} [options] 可注入操作时间（毫秒）
 * @returns {{accepted:boolean,rejected:0|1,created:boolean,pageCount:number}} 页面总数含归档页
 */
export function addManualPage(input, { now: at = now() } = {}) {
  const result = sanitizeEntry({ url: input.url, title: input.title }, {
    source: 'manual',
    keywords: getEffectiveKeywords(),
    privacyEnabled: isPrivacyFilterEnabled(),
    now: at,
  });
  if (!result.ok) {
    return { accepted: false, rejected: 1, created: false, pageCount: countPages() };
  }
  const previous = getPage(input.url);
  const page = previous
    ? mergeObservation(previous, result.entry, 'manual', at)
    : createPageRecord(result.entry, 'manual', at);
  // 打开状态属于同步快照；手动添加不能以单条观测刷新该状态。
  page.isOpen = previous?.isOpen ?? false;
  page.isActive = previous?.isActive ?? false;
  // 手动添加以本次操作时间作为最近访问时间（C-BE-MENU-01）。
  page.lastVisitedAt = at;
  page.updatedAt = at;
  upsertPage(page);
  bumpDataVersion();
  return { accepted: true, rejected: 0, created: !previous, pageCount: countPages() };
}
