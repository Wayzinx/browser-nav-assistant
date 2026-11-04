import { maskUrl } from './url.js';

// @code C-FE-CORE-05
const URL_PATTERN = /\b(?:https?|ftp|file|chrome|chrome-extension|about|data|javascript):(?:\/\/)?[^\s"'<>]+/gi;
const BODY_KEYS = new Set(['body', 'payload', 'requestbody', 'request_body']);

/** 递归脱敏同时排除请求体，避免调用方误把采集快照写进日志。 */
function scrub(value, seen = new WeakSet(), depth = 0) {
  if (typeof value === 'string') return value.replace(URL_PATTERN, (url) => maskUrl(url));
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;
  if (depth > 8 || seen.has(value)) return '[omitted]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => scrub(item, seen, depth + 1));
  if (value instanceof Error) {
    return scrub({ code: value.code, message: value.message, details: value.details }, seen, depth + 1);
  }
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !BODY_KEYS.has(key.toLowerCase()))
    .map(([key, item]) => [scrub(key), scrub(item, seen, depth + 1)]));
}

/**
 * @param {string} event 事件名称。
 * @param {Object} [details={}] 仅元数据；body / payload / requestBody 会被省略。
 * @param {'info'|'warn'|'error'|'debug'} [level='info']
 * @returns {Object} 脱敏后的结构化日志条目。
 */
export function log(event, details = {}, level = 'info') {
  const safeLevel = ['info', 'warn', 'error', 'debug'].includes(level) ? level : 'info';
  const safeDetails = scrub(details);
  const entry = {
    ts: new Date().toISOString(),
    level: safeLevel,
    event: scrub(String(event)),
    details: safeDetails,
    ...(safeDetails?.requestId ? { requestId: safeDetails.requestId } : {}),
  };
  const logs = Array.isArray(globalThis.__navLogs) ? globalThis.__navLogs : [];
  logs.push(entry);
  if (logs.length > 200) logs.splice(0, logs.length - 200);
  globalThis.__navLogs = logs;
  // 日志通道失败不应该改变业务流程的返回结果。
  try { console[safeLevel](JSON.stringify(entry)); } catch {}
  return entry;
}
