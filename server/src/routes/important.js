import { LIMITS } from '../config.js';
import { parseHttpUrl } from '../domain/url.js';
import { readJsonBody, sendJson } from '../lib/http.js';
import { createValidator } from '../lib/validate.js';
import { setImportant } from '../services/important-service.js';

// @code C-BE-MENU-02
/** 技术方案 §5.1：菜单标题截断到 500 字符，URL 原始长度不得截断。 */
const MAX_TITLE_LENGTH = 500;

async function handleImportant(req, res) {
  const validator = createValidator(await readJsonBody(req));
  const url = validator.readString('url', { required: true, max: LIMITS.maxUrlLength });
  const title = validator.readString('title', { defaultValue: '', max: MAX_TITLE_LENGTH, truncate: true });
  const important = validator.readBool('important', { defaultValue: true });
  if (!parseHttpUrl(url)) validator.invalid('url');
  validator.assertValid();
  sendJson(res, 200, setImportant({ url, title, important }));
}

/** @type {{method:string,path:string,handler:Function}[]} 重要标记入口；省略 important 时默认 true。 */
export const importantRoutes = [
  { method: 'POST', path: '/api/pages/important', handler: handleImportant },
];
