import { LIMITS } from '../config.js';
import { readJsonBody, sendJson } from '../lib/http.js';
import { createValidator } from '../lib/validate.js';
import { previewRules } from '../services/rule-service.js';

// @code C-BE-RULE-07
async function handleParse(req, res) {
  const validator = createValidator(await readJsonBody(req));
  const text = validator.readString('text', { required: true, trim: true, min: 1, max: LIMITS.maxRuleTextLength });
  validator.assertValid();
  sendJson(res, 200, previewRules(text));
}

/** @type {{method:string,path:string,handler:Function}[]} 自然语言预览入口，只校验和解析，不写库。 */
export const ruleParseRoutes = [
  { method: 'POST', path: '/api/rules/parse', handler: handleParse },
];
