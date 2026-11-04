import { LIMITS } from '../config.js';
import { parseHttpUrl } from '../domain/url.js';
import { readJsonBody, sendJson } from '../lib/http.js';
import { createValidator } from '../lib/validate.js';
import { addManualPage } from '../services/manual-page-service.js';

// @code C-BE-MENU-01
/** 技术方案 §5.1：菜单标题截断到 500 字符，URL 原始长度不得截断。 */
const MAX_TITLE_LENGTH = 500;

async function handleManualPage(req, res) {
  const validator = createValidator(await readJsonBody(req));
  const url = validator.readString('url', { required: true, max: LIMITS.maxUrlLength });
  const title = validator.readString('title', { defaultValue: '', max: MAX_TITLE_LENGTH, truncate: true });
  if (!parseHttpUrl(url)) validator.invalid('url');
  validator.assertValid();
  sendJson(res, 200, addManualPage({ url, title }));
}

/** @type {{method:string,path:string,handler:Function}[]} 单页添加入口；只将白名单字段传入 service。 */
export const manualPageRoutes = [
  { method: 'POST', path: '/api/pages/manual', handler: handleManualPage },
];
