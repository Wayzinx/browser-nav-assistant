import {
  API_VERSION,
  LIMITS,
  MIN_RECOMMENDATION_SCORE,
  RECENCY_HALF_LIFE_DAYS,
  SCORE_WEIGHTS,
} from '../config.js';
import { getSettings } from '../store/settings-repo.js';
import { getEffectiveKeywords } from './privacy-service.js';

// @code C-BE-DIAG-02
/** @returns {object} 完整 ConfigDto；有效关键词由 PRIV 合并，嵌套值不共享可变引用。 */
export function getPublicConfig() {
  const settings = getSettings();
  return {
    cleanupThresholdDays: settings.cleanupThresholdDays,
    maxHistoryItems: settings.maxHistoryItems,
    enablePrivacyFilter: settings.enablePrivacyFilter,
    privacySensitiveKeywords: [...getEffectiveKeywords()],
    baseSensitiveKeywords: [...settings.privacySensitiveKeywords],
    historyLookbackDays: settings.historyLookbackDays,
    recencyHalfLifeDays: RECENCY_HALF_LIFE_DAYS,
    weights: {
      recency: SCORE_WEIGHTS.recency,
      frequency: SCORE_WEIGHTS.frequency,
      open: SCORE_WEIGHTS.open,
      domain: SCORE_WEIGHTS.domain,
    },
    minRecommendationScore: MIN_RECOMMENDATION_SCORE,
    apiVersion: API_VERSION,
    // maxArrayItems 只供内部校验使用，公开字段按契约逐项挑选。
    limits: {
      maxItemsPerSync: LIMITS.maxItemsPerSync,
      maxUrlLength: LIMITS.maxUrlLength,
      maxRuleTextLength: LIMITS.maxRuleTextLength,
      maxBodyBytes: LIMITS.maxBodyBytes,
    },
  };
}
