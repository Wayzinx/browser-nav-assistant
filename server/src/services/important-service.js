import { createPageRecord } from '../domain/page-merge.js';
import { sanitizeEntry } from '../domain/sync-sanitize.js';
import { normalizeUrl } from '../domain/url.js';
import { now } from '../lib/clock.js';
import { getPage, upsertPage } from '../store/page-repo.js';
import { bumpDataVersion } from '../store/state.js';
import { getEffectiveKeywords, isPrivacyFilterEnabled } from './privacy-service.js';

// @code C-BE-MENU-02
/**
 * 已有页面仅修改重要标记、非空标题与更新时间；新页面使用 manual 来源创建。
 * @param {{url:string,title?:string,important?:boolean}} input 路由已校验的字段，important 默认 true
 * @param {{now?:number}} [options] 可注入操作时间（毫秒）
 * @returns {{accepted:boolean,rejected:0|1,url:string,normalizedUrl:string,isImportant:boolean,created:boolean}} 拒收保留原重要状态
 */
export function setImportant(input, { now: at = now() } = {}) {
  const result = sanitizeEntry({ url: input.url, title: input.title }, {
    source: 'manual',
    keywords: getEffectiveKeywords(),
    privacyEnabled: isPrivacyFilterEnabled(),
    now: at,
  });
  const previous = getPage(input.url);
  if (!result.ok) {
    return {
      accepted: false,
      rejected: 1,
      url: previous?.url ?? input.url.trim(),
      normalizedUrl: normalizeUrl(input.url),
      isImportant: previous?.isImportant ?? false,
      created: false,
    };
  }
  // 标记动作不是一次访问；不合并观测，避免改动访问时间、次数和来源。
  const page = previous ?? createPageRecord(result.entry, 'manual', at);
  if (previous && input.title?.trim()) page.title = result.entry.title;
  page.isImportant = input.important ?? true;
  page.updatedAt = at;
  const saved = upsertPage(page);
  bumpDataVersion();
  return {
    accepted: true,
    rejected: 0,
    url: saved.url,
    normalizedUrl: saved.normalizedUrl,
    isImportant: saved.isImportant,
    created: !previous,
  };
}
