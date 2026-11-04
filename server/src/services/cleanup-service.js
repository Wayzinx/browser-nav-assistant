import { buildCleanupSuggestions } from '../domain/cleanup.js';
import { now } from '../lib/clock.js';
import { listPages } from '../store/page-repo.js';
import { listRules } from '../store/rule-repo.js';
import { getSettings } from '../store/settings-repo.js';

// @code C-BE-CLEAN-04
/**
 * 整理只使用访问时间、打开状态与 URL，无须重算页面评分。
 * @param {{now?:number}} [options] 已在路由校验的查询时间
 * @returns {object} summary/suggestions/thresholdDays/generatedAt
 */
export function getCleanupSuggestions({ now: at = now() } = {}) {
  return buildCleanupSuggestions(listPages(), { rules: listRules(), settings: getSettings(), now: at });
}
