import { AppError } from '../lib/errors.js';
import { syncRoutes } from './sync.js';
import { rankedRoutes } from './ranked.js';
import { recommendationRoutes } from './recommendations.js';
import { cleanupRoutes } from './cleanup.js';
import { pageActionRoutes } from './page-actions.js';
import { ruleParseRoutes } from './rules-parse.js';
import { ruleRoutes } from './rules.js';
import { healthRoutes } from './health.js';
import { configRoutes } from './config.js';
import { configUpdateRoutes } from './config-update.js';
import { manualPageRoutes } from './manual-pages.js';
import { importantRoutes } from './important.js';
import { testApiRoutes } from './test-api.js';

// @code C-BE-CORE-04
/** @param {object} config 运行配置 @returns {object[]} 编译后的所有模块路由；测试接口只在显式启用时合并。 */
export function buildRouteTable(config) {
  const routes = [
    ...syncRoutes, ...rankedRoutes, ...recommendationRoutes, ...cleanupRoutes,
    ...pageActionRoutes, ...ruleParseRoutes, ...ruleRoutes, ...healthRoutes,
    ...configRoutes, ...configUpdateRoutes, ...manualPageRoutes, ...importantRoutes,
    ...(config.enableTestApi ? testApiRoutes : []),
  ];
  return routes.map((route) => {
    const keys = [];
    const pattern = route.path.split('/').map((part) => {
      if (part.startsWith(':')) { keys.push(part.slice(1)); return '([^/]+)'; }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('/');
    return { ...route, keys, pattern: new RegExp(`^${pattern}$`) };
  });
}

/** @param {object[]} table 已编译路由 @param {string} method HTTP 方法 @param {string} path URL pathname @returns {object} 匹配结果及解码参数；区分 404 与 405。 */
export function matchRoute(table, method, path) {
  const candidates = table.filter((route) => route.pattern.test(path));
  if (!candidates.length) throw new AppError('NOT_FOUND', 404, '接口不存在');
  const route = candidates.find((candidate) => candidate.method === method);
  if (!route) {
    const error = new AppError('METHOD_NOT_ALLOWED', 405, '此接口不支持该请求方法');
    error.allowedMethods = [...new Set(candidates.map((candidate) => candidate.method))];
    throw error;
  }
  const values = route.pattern.exec(path).slice(1);
  const params = {};
  try {
    route.keys.forEach((key, index) => { params[key] = decodeURIComponent(values[index]); });
  } catch {
    // 路径参数编码不合法属于请求错误，不能变成未知异常。
    throw new AppError('VALIDATION_FAILED', 400, '路径参数编码不合法', { fields: route.keys });
  }
  return { ...route, params };
}
