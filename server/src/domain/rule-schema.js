import { LIMITS } from '../config.js';
import { AppError } from '../lib/errors.js';
import { createValidator } from '../lib/validate.js';

// @code C-BE-RULE-05

/** 规则类型对应的唯一动作，保存阶段不可由客户端任意指定。 */
export const ACTION_BY_TYPE = Object.freeze({ archive_candidate: 'suggest_archive', never_archive: 'keep', recommend_related: 'recommend', privacy_filter: 'exclude_upload', boost_domain: 'boost' });

/** 规则类型契约，顺序与原登记保持一致。 */
export const RULE_TYPES = Object.freeze(['archive_candidate', 'never_archive', 'recommend_related', 'privacy_filter', 'boost_domain']);

// 这三个上限只服务 RULE 的结构字段，取自代码点的字段约束。
const MAX_INACTIVE_DAYS = 3650;
const MAX_KEYWORDS = 20;
const MAX_TRIGGER_COUNT = 20;

function readDomain(validator, key, required = false) {
  const value = validator.readString(key, { required, nullable: !required, defaultValue: null, trim: true, min: 1, max: 253 });
  if (typeof value !== 'string') return value;
  const domain = value.toLowerCase().replace(/^www\./u, '');
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(domain)) validator.invalid(key);
  return domain;
}

function copyErrors(parent, nested, key) {
  try {
    nested.assertValid();
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== 'VALIDATION_FAILED') throw error;
    for (const field of error.details.fields) parent.invalid(field === 'body' ? key : `${key}.${field}`);
  }
}

function readSite(parent, key, isTrigger) {
  const validator = createValidator(parent.value(key));
  const site = { domain: readDomain(validator, 'domain', true) };
  if (isTrigger) site.minCount = validator.readInt('minCount', { required: true, min: 1, max: MAX_TRIGGER_COUNT });
  const label = validator.readString('label', { trim: true, min: 1, max: LIMITS.maxRuleTextLength });
  if (label !== undefined) site.label = label;
  copyErrors(parent, validator, key);
  return site;
}

function readKeywords(validator) {
  const raw = validator.value('keywords');
  // readArray 的通用规模错误是 413；规则字段不合法按 RULE 契约返回 400。
  if (Array.isArray(raw) && raw.length > MAX_KEYWORDS) {
    validator.invalid('keywords');
    return [];
  }
  const keywords = validator.readArray('keywords', { required: true, min: 1, max: MAX_KEYWORDS });
  return (keywords ?? []).map((word, index) => {
    if (typeof word !== 'string' || !word.trim() || word.length > LIMITS.maxRuleTextLength) {
      validator.invalid(`keywords[${index}]`);
      return '';
    }
    return word.trim().toLowerCase();
  });
}

/**
 * @param {object} input 不可信的单条客户端规则
 * @returns {object} 经重新校验的白名单 DTO；归档天数限定 1–3650，必填次数为正整数；不采纳客户端 ID、时间与 notes
 * @throws {AppError} 字段不合法时抛 400 VALIDATION_FAILED，details.fields 使用相对单条规则的字段路径
 */
export function validateRuleInput(input) {
  const validator = createValidator(input);
  const type = validator.readEnum('type', { required: true, values: RULE_TYPES });
  const rawText = validator.readString('rawText', { required: true, trim: true, min: 1, max: LIMITS.maxRuleTextLength });
  const domain = readDomain(validator, 'domain');
  const urlPattern = validator.readString('urlPattern', { nullable: true, defaultValue: null, trim: true, min: 1, max: LIMITS.maxUrlLength });
  const inactiveDays = validator.readInt('inactiveDays', {
    required: type === 'archive_candidate', nullable: type !== 'archive_candidate',
    defaultValue: null, min: 1, max: MAX_INACTIVE_DAYS,
  });
  const action = validator.readEnum('action', { values: Object.values(ACTION_BY_TYPE), defaultValue: ACTION_BY_TYPE[type] });
  const enabled = validator.readBool('enabled', { defaultValue: true });
  const confidence = validator.readEnum('confidence', { values: ['high', 'medium'], defaultValue: 'high' });
  if (type && action !== ACTION_BY_TYPE[type]) validator.invalid('action');
  if (type === 'never_archive' && !domain && !urlPattern) {
    validator.invalid('domain');
    validator.invalid('urlPattern');
  }
  if (type === 'boost_domain' && !domain) validator.invalid('domain');
  const rule = {
    rawText, type, domain, urlPattern, inactiveDays: type === 'archive_candidate' ? inactiveDays : null,
    action, enabled, confidence,
  };
  if (type === 'privacy_filter') rule.keywords = readKeywords(validator);
  if (type === 'recommend_related') {
    rule.trigger = readSite(validator, 'trigger', true);
    rule.target = readSite(validator, 'target', false);
  }
  validator.assertValid();
  return rule;
}
