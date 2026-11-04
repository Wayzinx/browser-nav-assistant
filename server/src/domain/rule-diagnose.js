import { domainMatches } from './rule-match.js';

// @code C-BE-RULE-04

/** 不可识别时展示可直接照写的句式，来自技术方案 §6.6。 */
export const RULE_EXAMPLES = Object.freeze(['七天没访问的 GitHub issue 建议归档', '别归档 github.com 的页面', '如果我连续看了 3 个 React 文档，推荐相关 MDN 页面', '不要上传包含 password、token 的 URL', '飞书文档优先显示']);

/** @param {string} text 未识别子句原文 @param {string} [reason] 具体原因 @returns {{text:string,reason:string,examples:string[]}} 原因及可照写的例句副本。 */
export function buildUnparsed(text, reason = '没有识别到动作（归档 / 不要归档 / 推荐 / 不上传 / 优先）') {
  return { text, reason, examples: [...RULE_EXAMPLES] };
}

function isConflict(left, right) {
  if (left.enabled === false || right.enabled === false) return false;
  const types = [left.type, right.type];
  if (!types.includes('archive_candidate') || !types.includes('never_archive')) return false;
  return domainMatches(left.domain, right.domain) || domainMatches(right.domain, left.domain);
}

/**
 * @param {object[]} previews 本次预览规则
 * @param {object[]} [savedRules] 已保存规则，停用项不参与诊断
 * @returns {string[]} 同域、子域或全局范围的归档/保留冲突，只报告涉及本次预览的组合
 */
export function detectConflicts(previews, savedRules = []) {
  const all = [...previews, ...savedRules.filter((rule) => rule.enabled !== false)];
  const warnings = new Set();
  for (let index = 0; index < previews.length; index += 1) {
    for (let other = index + 1; other < all.length; other += 1) {
      if (!isConflict(all[index], all[other])) continue;
      warnings.add(`「${all[index].rawText}」与「${all[other].rawText}」冲突，执行时“永不归档”优先`);
    }
  }
  return [...warnings];
}
