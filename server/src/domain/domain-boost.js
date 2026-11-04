import { matchesRule } from './rule-match.js';

// @code C-BE-RANK-02
/**
 * 域名加权来源按重要、保护、优先、亲和度的顺序决定；归档候选规则不降权。
 * @param {object} page 页面记录
 * @param {{rules:object[], normalizers:object}} options 已保存的规则与未归档页面统计
 * @returns {{domain:number, domainSource:string}} 未舍入的 0–1 域名分及其来源
 */
export function resolveDomainBoost(page, { rules, normalizers }) {
  if (page.isImportant) return { domain: 1, domainSource: 'important' };
  if (rules.some((rule) => rule.type === 'never_archive' && matchesRule(page, rule))) {
    return { domain: 1, domainSource: 'protected' };
  }
  if (rules.some((rule) => rule.type === 'boost_domain' && matchesRule(page, rule))) {
    return { domain: 1, domainSource: 'boost' };
  }
  return {
    domain: (normalizers.domainVisits.get(page.domain) ?? 0) / normalizers.maxDomainVisits,
    domainSource: 'affinity',
  };
}
