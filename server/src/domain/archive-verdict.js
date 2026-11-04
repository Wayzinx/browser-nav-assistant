import { DAY_MS, DEFAULT_SETTINGS } from '../config.js';
import { matchesRule } from './rule-match.js';

// @code C-BE-CLEAN-01
/**
 * D-20 按整天比较；14 天 23 小时仍算 14 天，未来访问不产生负天数。
 * @param {number} timestamp 访问时间，毫秒
 * @param {number} now 本次判定时间，毫秒
 * @returns {number} 向下取整的未访问天数
 */
export function ageInDays(timestamp, now) {
  return Math.max(0, Math.floor((now - timestamp) / DAY_MS));
}

function protectedReason(rule, ageDays) {
  const scope = rule.domain ? `域名配置（${rule.domain}）` : `规则配置（${rule.urlPattern}）`;
  return `被保护${scope}，不建议归档${ageDays >= 3 ? `，虽已 ${ageDays} 天未访问` : ''}`;
}

/**
 * D-24 命中即停：保护、重要、打开、规则归档、默认归档；归档严格要求整天数 > 阈值。
 * @param {object} page 已校验的 Page
 * @param {{rules:object[],settings:object,now:number}} options 本次判定上下文
 * @returns {{verdict:string,ageDays:number,threshold:number|null,ruleId:string|null,reason:string}}
 */
export function decideArchive(page, { rules = [], settings = DEFAULT_SETTINGS, now }) {
  const ageDays = ageInDays(page.lastVisitedAt, now);
  const result = { verdict: 'none', ageDays, threshold: null, ruleId: null, reason: '' };
  const protection = rules.find((rule) => rule.type === 'never_archive' && matchesRule(page, rule));
  if (protection) return {
    ...result, verdict: 'keep', ruleId: protection.id, reason: protectedReason(protection, ageDays),
  };
  if (page.isImportant) return { ...result, verdict: 'keep', reason: '你已标记为重要，不建议归档' };
  if (page.isOpen) return { ...result, verdict: 'open' };

  let archiveRule = null;
  for (const rule of rules) {
    if (rule.type !== 'archive_candidate' || !matchesRule(page, rule) || ageDays <= rule.inactiveDays) continue;
    if (!archiveRule || rule.inactiveDays < archiveRule.inactiveDays) archiveRule = rule;
  }
  const threshold = archiveRule?.inactiveDays ?? settings.cleanupThresholdDays;
  if (ageDays <= threshold) return { ...result, threshold };
  const reason = `超过 ${threshold} 天未访问（已 ${ageDays} 天），且不在当前打开的 tab 中`;
  return {
    ...result, verdict: 'archive', threshold, ruleId: archiveRule?.id ?? null,
    reason: archiveRule ? `${reason}；命中规则「${archiveRule.rawText}」` : reason,
  };
}
