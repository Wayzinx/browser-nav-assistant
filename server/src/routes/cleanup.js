import { resolveNow } from '../lib/clock.js';
import { sendJson } from '../lib/http.js';
import { getCleanupSuggestions } from '../services/cleanup-service.js';

// @code C-BE-CLEAN-04
function handleCleanup(_req, res, { query }) {
  sendJson(res, 200, getCleanupSuggestions({ now: resolveNow(query) }));
}

/** @type {{method:string,path:string,handler:Function}[]} 整理查询路由，时间覆盖先校验再进入业务层。 */
export const cleanupRoutes = [
  { method: 'GET', path: '/api/pages/cleanup-suggestions', handler: handleCleanup },
];
