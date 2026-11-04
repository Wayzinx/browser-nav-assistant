import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadConfig } from '../config.js';
import { now } from './clock.js';

// @code C-BE-CORE-06
const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });
let { logLevel: currentLevel, logFile } = loadConfig();

function maskUrls(value) {
  return value.replace(/https?:\/\/[^\s"'<>]+/gi, (raw) => {
    try { return new URL(raw).host; }
    catch { /* 无法解析的 URL 也不可原样写进错误堆栈。 */ return '***'; }
  });
}

/**
 * 同步文件日志保证请求结束时，夹具即可按字节偏移提取证据。
 * @param {'debug'|'info'|'warn'|'error'} level 日志级别
 * @param {string} msg 事件名称，不传入请求体或完整页面 URL
 * @param {object} [fields] 结构化上下文
 * @returns {void}
 */
export function log(level, msg, fields = {}) {
  if (!Object.hasOwn(LEVELS, level) || LEVELS[level] < LEVELS[currentLevel]) return;
  // 对堆栈等嵌套字段也只保留 URL host，避免异常信息绕过业务层的隐私过滤。
  const line = JSON.stringify({ ...fields, ts: new Date(now()).toISOString(), level, msg },
    (key, value) => typeof value === 'string' ? maskUrls(value) : value);
  console.log(line);
  if (logFile) {
    mkdirSync(dirname(logFile), { recursive: true });
    appendFileSync(logFile, `${line}\n`, 'utf8');
  }
}

/**
 * @param {'debug'|'info'|'warn'|'error'} level 最低输出级别
 * @param {string|null} [file] 同步日志目的文件，null 表示只写 stdout
 * @returns {void}
 */
export function setLogLevel(level, file = logFile) {
  if (!Object.hasOwn(LEVELS, level)) throw new TypeError('日志级别不合法');
  currentLevel = level;
  logFile = file;
  if (logFile) mkdirSync(dirname(logFile), { recursive: true });
}

/**
 * 固定请求上下文，后续字段无法覆盖 reqId 等绑定字段。
 * @param {object} fields 请求级字段
 * @returns {{log:Function, debug:Function, info:Function, warn:Function, error:Function}}
 */
export function childLogger(fields = {}) {
  const bound = { ...fields };
  const write = (level, msg, extra = {}) => log(level, msg, { ...extra, ...bound });
  return {
    log: write,
    debug: (msg, extra) => write('debug', msg, extra),
    info: (msg, extra) => write('info', msg, extra),
    warn: (msg, extra) => write('warn', msg, extra),
    error: (msg, extra) => write('error', msg, extra),
  };
}
