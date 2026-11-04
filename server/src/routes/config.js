import { sendJson } from '../lib/http.js';
import { getPublicConfig } from '../services/config-service.js';

// @code C-BE-DIAG-02
/** @type {{method:string,path:string,handler:Function}[]} 配置查询只输出公开的 ConfigDto。 */
export const configRoutes = [
  { method: 'GET', path: '/api/config', handler: (req, res) => sendJson(res, 200, getPublicConfig()) },
];
