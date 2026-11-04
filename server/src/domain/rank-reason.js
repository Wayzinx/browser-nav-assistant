import { DAY_MS } from '../config.js';

// @code C-BE-RANK-03
/** D-23：按优先顺序取前三句，不因后续命中规则而挤掉更高优先级的事实。 */
const MAX_REASON_CLAUSES = 3;
const RECENT_DAYS = 3;
const REPEATED_VISITS = 3;
const FREQUENT_VISITS = 5;
const COMMON_DOMAIN_AFFINITY = 0.6;
const DOMAIN_REASONS = Object.freeze({
  important: '已被你标记为重要',
  protected: '属于受保护域名',
  boost: '命中优先域名规则',
});

function describeVisit(page, ageDays, threshold) {
  if (ageDays < RECENT_DAYS && page.visitCount >= REPEATED_VISITS) return `最近 3 天内多次访问（${page.visitCount} 次）`;
  if (ageDays < 1) return '今天访问过';
  if (ageDays < RECENT_DAYS) return '最近 3 天内访问';
  const days = Math.floor(ageDays);
  return days >= threshold ? `已 ${days} 天未访问` : `${days} 天前访问`;
}

/**
 * @param {object} page 页面记录
 * @param {{now:number, settings:object, scoreDetail:object}} options 时刻、整理阈值与未舍入的域名分
 * @returns {string} 非空理由，最多三句，以中文逗号连接
 */
export function buildRankReason(page, { now, settings, scoreDetail }) {
  const ageDays = Math.max(0, now - page.lastVisitedAt) / DAY_MS;
  const clauses = [];
  if (page.isActive) clauses.push('正在浏览');
  clauses.push(describeVisit(page, ageDays, settings.cleanupThresholdDays));
  if (ageDays >= RECENT_DAYS && page.visitCount >= FREQUENT_VISITS) clauses.push(`高频访问（${page.visitCount} 次）`);
  if (page.isOpen && !page.isActive) clauses.push('当前仍处于打开状态');
  const domainReason = DOMAIN_REASONS[scoreDetail.domainSource];
  if (domainReason) clauses.push(domainReason);
  else if (scoreDetail.domain >= COMMON_DOMAIN_AFFINITY) clauses.push(`常用域名 ${page.domain}`);
  return clauses.slice(0, MAX_REASON_CLAUSES).join('，');
}
