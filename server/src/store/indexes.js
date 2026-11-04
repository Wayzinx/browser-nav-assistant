// @code C-BE-CORE-10
/** @returns {object} 私有二级索引的仓储操作；不向 services 暴露可变 Map / Set。 */
export function createIndexes() {
  const buckets = { dupKey: new Map(), domain: new Map(), repo: new Map() };
  const open = new Set();
  const visits = new Map();
  const change = (page, direction) => {
    for (const [field, map] of Object.entries(buckets)) {
      const key = page[field];
      if (!key) continue;
      if (direction > 0) {
        if (!map.has(key)) map.set(key, new Set());
        map.get(key).add(page.normalizedUrl);
      } else {
        const bucket = map.get(key);
        bucket?.delete(page.normalizedUrl);
        if (!bucket?.size) map.delete(key);
      }
    }
    if (direction > 0 && page.isOpen) open.add(page.normalizedUrl);
    else open.delete(page.normalizedUrl);
    if (!page.isArchived) {
      const total = (visits.get(page.domain) ?? 0) + direction * page.visitCount;
      if (total > 0) visits.set(page.domain, total);
      else visits.delete(page.domain);
    }
  };
  return {
    add: (page) => change(page, 1),
    remove: (page) => change(page, -1),
    keys: (field, key) => [...(buckets[field]?.get(key) ?? [])],
    openKeys: () => [...open],
    domainVisits: (domain) => visits.get(domain) ?? 0,
    clear() {
      for (const map of Object.values(buckets)) map.clear();
      open.clear();
      visits.clear();
    },
  };
}
