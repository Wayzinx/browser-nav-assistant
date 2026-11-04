import { readJsonBody, sendJson } from '../lib/http.js';
import { createValidator } from '../lib/validate.js';
import { updateSettings } from '../services/settings-service.js';

// @code C-BE-PRIV-03
// PUT 配置的字段边界来自 api-contract，与同步请求的通用数组上限不同。
const INTEGER_MAXIMUMS = Object.freeze({
  cleanupThresholdDays: 365,
  maxHistoryItems: 500,
  historyLookbackDays: 90,
});
const MAX_KEYWORDS = 50;
const MAX_KEYWORD_LENGTH = 50;

function readKeywords(validator) {
  const keywords = validator.value('privacySensitiveKeywords');
  const isValid = Array.isArray(keywords) && keywords.length <= MAX_KEYWORDS
    && keywords.every((keyword) => typeof keyword === 'string'
      && keyword.trim().length > 0 && keyword.length <= MAX_KEYWORD_LENGTH);
  if (!isValid) {
    // 契约规定关键词越界为 400，不能沿用 readArray 的 413 语义。
    validator.invalid('privacySensitiveKeywords');
    return undefined;
  }
  return [...keywords];
}

function parseSettingsPatch(body) {
  const validator = createValidator(body);
  const patch = {};
  for (const [field, max] of Object.entries(INTEGER_MAXIMUMS)) {
    if (validator.value(field) !== undefined) {
      patch[field] = validator.readInt(field, { min: 1, max });
    }
  }
  if (validator.value('enablePrivacyFilter') !== undefined) {
    patch.enablePrivacyFilter = validator.readBool('enablePrivacyFilter');
  }
  if (validator.value('privacySensitiveKeywords') !== undefined) {
    patch.privacySensitiveKeywords = readKeywords(validator);
  }
  if (!Object.keys(patch).length) validator.invalid('body');
  // 整批通过后再写仓储；非法字段不会导致其余合法字段部分生效。
  validator.assertValid();
  return patch;
}

async function handleUpdate(req, res) {
  const patch = parseSettingsPatch(await readJsonBody(req));
  sendJson(res, 200, updateSettings(patch));
}

/** @type {{method:string,path:string,handler:Function}[]} 只接受白名单配置的部分更新。 */
export const configUpdateRoutes = [
  { method: 'PUT', path: '/api/config', handler: handleUpdate },
];
