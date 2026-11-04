import { AppError } from '../lib/errors.js';
import { parseRuleText } from '../domain/rule-parser.js';
import { insertRule, listRules, removeRule, updateRule, countRules } from '../store/rule-repo.js';
import { bumpRuleVersion } from '../store/state.js';

// @code C-BE-RULE-06

/** @param {string} id 正式规则 ID @returns {{deleted:string,ruleCount:number}} 删除结果；不存在时不写库、不递增版本。 */
export function deleteRule(id) {
  if (!removeRule(id)) throw new AppError('NOT_FOUND', 404, `规则 ${id} 不存在`);
  bumpRuleVersion();
  return { deleted: id, ruleCount: countRules() };
}

/** @returns {{rules:object[],total:number}} 按创建顺序的规则深副本，包含停用项。 */
export function listAllRules() {
  const rules = listRules();
  return { rules, total: rules.length };
}

/** @param {string} text 已校验的规则文本 @returns {{rules:object[],unparsed:object[],warnings:string[]}} 仅预览并诊断与已保存启用规则的冲突，不消耗正式 ID 或版本。 */
export function previewRules(text) {
  return parseRuleText(text, { savedRules: listRules() });
}

/** @param {object[]} inputs 路由已完成整批 schema 校验的白名单规则 @returns {{rules:object[],ruleCount:number}} 正式 ID 与时间由仓储分配，整批只通知一次版本变更。 */
export function saveRules(inputs) {
  const rules = inputs.map((input) => insertRule(input));
  bumpRuleVersion();
  return { rules, ruleCount: countRules() };
}

/** @param {string} id 正式规则 ID @param {boolean} enabled 已校验的启停状态 @returns {object} 更新后的顶层规则 DTO；不存在时不递增版本。 */
export function setRuleEnabled(id, enabled) {
  const rule = updateRule(id, { enabled });
  if (!rule) throw new AppError('NOT_FOUND', 404, '规则不存在');
  bumpRuleVersion();
  return rule;
}
