import { AppError } from './lib/errors.js';

// @code C-BE-CORE-02
/** 一天的毫秒数，供时间衰减与归档边界共用。 */
export const DAY_MS = 86_400_000;
/** 可覆盖配置的初始值；冻结数组，避免仓储复位时沿用被修改的默认值。 */
export const DEFAULT_SETTINGS = Object.freeze({
  cleanupThresholdDays: 14,
  maxHistoryItems: 100,
  historyLookbackDays: 30,
  enablePrivacyFilter: true,
  privacySensitiveKeywords: Object.freeze(['password', 'token', 'bank', 'secret']),
});
/** 四个评分因子权重之和为 1，保证最终分数可复算。 */
export const SCORE_WEIGHTS = Object.freeze({ recency: 0.4, frequency: 0.3, open: 0.2, domain: 0.1 });
/** 跨模块共享的输入规模上限，与 API 契约保持一致。 */
export const LIMITS = Object.freeze({
  maxItemsPerSync: 500,
  maxUrlLength: 2048,
  maxRuleTextLength: 500,
  maxBodyBytes: 1_048_576,
  maxArrayItems: 500,
});
/** 最近访问分数每 7 天减半。 */
export const RECENCY_HALF_LIFE_DAYS = 7;
/** 推荐候选的最低最终分数。 */
export const MIN_RECOMMENDATION_SCORE = 0.3;
/** 产品版本与协议主版本分别用于展示、兼容性检查。 */
export const APP_VERSION = '1.0.0';
export const API_VERSION = '1';

/**
 * 唯一的环境变量入口；可注入环境对象以独立验证配置。
 * @param {Record<string, string|undefined>} [env] 进程环境
 * @returns {{port:number, host:string, enableTestApi:boolean, logFile:string|null, logLevel:string, snapshotFile:string|null}}
 */
export function loadConfig(env = process.env) {
  const portText = env.PORT ?? '3000';
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new AppError('VALIDATION_FAILED', 400, 'PORT 必须是 1–65535 的整数', { fields: ['PORT'] });
  }
  const logLevel = env.LOG_LEVEL || 'info';
  if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) {
    throw new AppError('VALIDATION_FAILED', 400, 'LOG_LEVEL 取值不合法', { fields: ['LOG_LEVEL'] });
  }
  return {
    port,
    host: env.HOST || '127.0.0.1',
    enableTestApi: env.ENABLE_TEST_API === '1',
    logFile: env.LOG_FILE || null,
    logLevel,
    snapshotFile: env.SNAPSHOT_FILE || null,
  };
}
