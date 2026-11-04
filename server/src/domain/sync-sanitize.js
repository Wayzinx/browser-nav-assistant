import { LIMITS } from '../config.js';
import { findSensitiveKeyword } from './privacy.js';
import { normalizeUrl } from './url.js';

// @code C-BE-SYNC-02
/** 标题按契约截断到 500 字符，与单页添加接口的上限一致。 */
const MAX_TITLE_LENGTH = 500;
/** 只纠正超过五分钟的未来时刻，保留正常的客户端时钟偏差。 */
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

/**
 * 缺失时刻用 0 表示，合并层据此保留已有时间或使用服务器时刻。
 * @param {unknown} timestamp 客户端毫秒时间戳
 * @param {number} now 本批服务器时刻
 * @returns {number} 毫秒值；超过允许的未来偏差时返回 now
 */
export function clampTimestamp(timestamp, now) {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) return 0;
  return timestamp > now + MAX_CLOCK_SKEW_MS ? now : timestamp;
}

/**
 * 隐私判断始终使用完整原始 URL，避免 hash 或跟踪参数中的敏感词被删掉后漏收。
 * @param {unknown} raw 单条观测，只提取白名单字段
 * @param {{source:string,keywords:string[],privacyEnabled:boolean,now:number}} options 本批清洗上下文
 * @returns {{ok:true,entry:object}|{ok:false,reason:'invalid_url'|'privacy'}} 拒收结果不携带原始 URL
 */
export function sanitizeEntry(raw, { source, keywords, privacyEnabled, now }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      typeof raw.url !== 'string' || raw.url.length > LIMITS.maxUrlLength) {
    return { ok: false, reason: 'invalid_url' };
  }
  const normalizedUrl = normalizeUrl(raw.url);
  // URL 编码可能扩张长度；仓储再次解析主键时也使用同一上限。
  if (!normalizedUrl || normalizedUrl.length > LIMITS.maxUrlLength) {
    return { ok: false, reason: 'invalid_url' };
  }
  if (privacyEnabled && findSensitiveKeyword(raw.url, keywords)) {
    return { ok: false, reason: 'privacy' };
  }
  const timestamp = source === 'history' ? raw.lastVisitTime : raw.lastAccessed;
  const visitCount = source === 'history' && Number.isFinite(raw.visitCount)
    ? Math.max(1, raw.visitCount) : 1;
  return {
    ok: true,
    entry: {
      url: raw.url,
      normalizedUrl,
      title: typeof raw.title === 'string' ? raw.title.trim().slice(0, MAX_TITLE_LENGTH) : '',
      visitCount,
      lastVisitedAt: source === 'active_tab' || source === 'manual' ? now : clampTimestamp(timestamp, now),
    },
  };
}
