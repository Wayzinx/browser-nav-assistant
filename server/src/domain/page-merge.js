// @code C-BE-SYNC-03
function observationTime(observation, source, now, page) {
  if (source === 'active_tab' || source === 'manual') return now;
  // 未提供 lastAccessed 的打开标签不能把已有历史伪造为刚刚访问。
  return observation.lastVisitedAt || page?.lastVisitedAt || now;
}

/**
 * 打开状态统一由完整同步快照处理；ID 和二级索引由仓储生成。
 * @param {object} observation 清洗后的白名单观测
 * @param {string} source history / open_tab / active_tab / manual
 * @param {number} now 本批服务器时刻（毫秒）
 * @returns {object} 待入库的 Page 字段，不修改观测
 */
export function createPageRecord(observation, source, now) {
  const visitedAt = observationTime(observation, source, now);
  return {
    url: observation.url,
    normalizedUrl: observation.normalizedUrl,
    title: observation.title || observation.url,
    visitCount: Math.max(observation.visitCount, 1),
    lastVisitedAt: visitedAt,
    firstSeenAt: visitedAt,
    sources: [source],
    isOpen: false,
    isActive: false,
    isImportant: false,
    isArchived: false,
    archivedAt: null,
    mergedInto: null,
    updatedAt: now,
  };
}

/**
 * 历史累计次数取最大值；首见取最小值，空标题不覆盖，来源保持并集。
 * @param {object} page 已有仓储 Page
 * @param {object} observation 清洗后的白名单观测
 * @param {string} source 本条来源
 * @param {number} now 本批服务器时刻（毫秒）
 * @returns {object} 新 Page 副本，保留归档、重要标记和原始 URL
 */
export function mergeObservation(page, observation, source, now) {
  const visitedAt = observationTime(observation, source, now, page);
  return {
    ...page,
    title: observation.title || page.title || page.url,
    visitCount: Math.max(page.visitCount, observation.visitCount, 1),
    lastVisitedAt: source === 'active_tab' || source === 'manual'
      ? now : Math.max(page.lastVisitedAt, visitedAt),
    firstSeenAt: Math.min(page.firstSeenAt || visitedAt, visitedAt),
    sources: [...new Set([...page.sources, source])],
    updatedAt: now,
  };
}
