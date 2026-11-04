import { AppError } from '../lib/errors.js';
import { readJsonBody, sendJson } from '../lib/http.js';
import { createValidator } from '../lib/validate.js';
import { validateRuleInput } from '../domain/rule-schema.js';
import { saveRules, listAllRules, deleteRule, setRuleEnabled } from '../services/rule-service.js';

// @code C-BE-RULE-08
// 单次保存的业务上限，与通用同步数组的规模限制不同。
const MAX_RULES_PER_SAVE = 20;

function readRules(body) {
  const validator = createValidator(body);
  const raw = validator.value('rules');
  if (Array.isArray(raw) && raw.length > MAX_RULES_PER_SAVE) {
    validator.invalid('rules');
    validator.assertValid();
  }
  const inputs = validator.readArray('rules', { required: true, min: 1, max: MAX_RULES_PER_SAVE });
  const rules = (inputs ?? []).map((input, index) => {
    try {
      return validateRuleInput(input);
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== 'VALIDATION_FAILED') throw error;
      for (const field of error.details.fields) {
        validator.invalid(field === 'body' ? `rules[${index}]` : `rules[${index}].${field}`);
      }
      return null;
    }
  });
  // 所有条目都完成校验以后才进入 service，错误批次不消耗 ID，也不部分写入。
  validator.assertValid();
  return rules;
}

function readId(params) {
  const validator = createValidator(params);
  const id = validator.readString('id', { required: true, min: 1 });
  validator.assertValid();
  return id;
}

async function handleSave(req, res) {
  const rules = readRules(await readJsonBody(req));
  sendJson(res, 201, saveRules(rules));
}

async function handleEnable(req, res, { params }) {
  const validator = createValidator(await readJsonBody(req));
  const enabled = validator.readBool('enabled', { required: true });
  validator.assertValid();
  sendJson(res, 200, setRuleEnabled(readId(params), enabled));
}

/** @type {{method:string,path:string,handler:Function}[]} 规则 CRUD；未知字段忽略，PATCH 直接返回规则顶层 DTO。 */
export const ruleRoutes = [
  { method: 'POST', path: '/api/rules', handler: handleSave },
  { method: 'GET', path: '/api/rules', handler: (req, res) => sendJson(res, 200, listAllRules()) },
  { method: 'DELETE', path: '/api/rules/:id', handler: (req, res, { params }) => sendJson(res, 200, deleteRule(readId(params))) },
  { method: 'PATCH', path: '/api/rules/:id', handler: handleEnable },
];
