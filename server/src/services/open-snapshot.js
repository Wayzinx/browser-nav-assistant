import { getPage, listOpenPages, upsertPage } from '../store/page-repo.js';

// @code C-BE-SYNC-05
/**
 * 只遍历上次打开集合与本次通过清洗的打开集合，避免扫描全部历史页面。
 * @param {{openUrls:Iterable<string>,activeUrl:string|null}} input 归一化 URL 快照
 * @returns {void} 更新 isOpen / isActive，不改变历史统计或来源
 */
export function applyOpenSnapshot({ openUrls, activeUrl }) {
  const currentOpen = new Set(openUrls);
  if (activeUrl) currentOpen.add(activeUrl);
  const affectedUrls = new Set([...listOpenPages().map((page) => page.normalizedUrl), ...currentOpen]);
  for (const normalizedUrl of affectedUrls) {
    const page = getPage(normalizedUrl);
    if (!page) continue;
    const isOpen = currentOpen.has(normalizedUrl);
    const isActive = isOpen && normalizedUrl === activeUrl;
    if (page.isOpen !== isOpen || page.isActive !== isActive) {
      upsertPage({ normalizedUrl, isOpen, isActive });
    }
  }
}
