import { sendJson } from '../lib/http.js';
import { getHealth } from '../services/health-service.js';

// @code C-BE-CORE-15
// @code C-BE-DIAG-01
/** @type {{method:string,path:string,handler:Function}[]} 骨架就绪探针。 */
export const healthRoutes = [
  { method: 'GET', path: '/api/health', handler: (req, res, context) => sendJson(res, 200, getHealth(context)) },
];
