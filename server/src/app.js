import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { loadConfig } from './config.js';
import { now } from './lib/clock.js';
import { AppError } from './lib/errors.js';
import { sendError, sendJson } from './lib/http.js';
import { childLogger, setLogLevel } from './lib/logger.js';
import { getSettings } from './store/settings-repo.js';
import { buildRouteTable, matchRoute } from './routes/index.js';

// @code C-BE-CORE-03
/** @param {object} req 请求 @param {object} res 响应 @returns {void} 仅允许插件和本机 http 来源。 */
export function applyCors(req, res) {
  const origin = req.headers.origin;
  res.setHeader('vary', 'Origin');
  res.setHeader('access-control-expose-headers', 'x-request-id');
  if (typeof origin === 'string' && /^(?:chrome-extension:\/\/[a-z0-9-]+|http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?)$/i.test(origin)) {
    res.setHeader('access-control-allow-origin', origin);
  }
  if (req.method === 'OPTIONS') {
    res.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type, x-request-id');
  }
}

function logPath(path) {
  let decoded = path;
  try { decoded = decodeURIComponent(path); } catch { /* 错误编码按原始路径检查，不记录 query。 */ }
  const keywords = getSettings().privacySensitiveKeywords;
  return keywords.some((word) => decoded.toLowerCase().includes(word.toLowerCase())) ? '***' : path;
}

/** @param {object} req 请求 @param {object} res 响应 @param {object} context app 上下文 @returns {Promise<void>} 统一请求生命周期。 */
export async function handleRequest(req, res, context) {
  const started = performance.now();
  const reqId = req.headers['x-request-id'] ?? `req_${randomBytes(4).toString('hex')}`;
  const logger = childLogger({ reqId });
  let path = '/';
  res.setHeader('x-request-id', reqId);
  res.once('finish', () => logger.info('access', {
    method: req.method, path: logPath(path), status: res.statusCode,
    ms: Math.round((performance.now() - started) * 100) / 100,
  }));
  applyCors(req, res);
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    path = url.pathname;
    if (req.method === 'OPTIONS') { sendJson(res, 204); return; }
    const route = matchRoute(context.routes, req.method, path);
    await route.handler(req, res, { ...context, reqId, logger, params: route.params, query: url.searchParams });
  } catch (error) {
    if (error instanceof AppError) {
      if (error.allowedMethods) res.setHeader('allow', error.allowedMethods.join(', '));
      sendError(res, error.status, error.code, error.message, error.details);
    } else {
      logger.error('unhandled', { stack: error?.stack ?? String(error) });
      sendError(res, 500, 'INTERNAL', '服务内部错误', { reqId });
    }
  }
}

/** @param {object} [config] 运行配置 @returns {import('node:http').Server} 未监听的 HTTP server，便于启动编排与独立验证。 */
export function createApp(config = loadConfig()) {
  setLogLevel(config.logLevel, config.logFile);
  const context = { config, startedAt: now(), routes: buildRouteTable(config) };
  return createServer((req, res) => { void handleRequest(req, res, context); });
}
