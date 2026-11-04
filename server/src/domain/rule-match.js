import { domainOf, parseHttpUrl } from './url.js';

// @code C-BE-CORE-13
/** @param {string} domain 页面域名 @param {string|null} scope 规则域名 @returns {boolean} 等于或为子域，必须有点边界。 */
export function domainMatches(domain, scope) {
  if (!scope) return true;
  const clean = (value) => String(value ?? '').trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  const actual = clean(domain);
  const expected = clean(scope);
  return Boolean(actual && expected && (actual === expected || actual.endsWith(`.${expected}`)));
}

/** @param {object|string} page 页面记录或 URL @param {object} rule 规则 @returns {boolean} 域名和 path+query 条件取交集。 */
export function matchesRule(page, rule) {
  if (!rule || rule.enabled === false) return false;
  const raw = typeof page === 'string' ? page : page?.normalizedUrl || page?.url;
  const url = parseHttpUrl(raw);
  if (!url) return false;
  if (rule.domain && !domainMatches(domainOf(url), rule.domain)) return false;
  return !rule.urlPattern || `${url.pathname}${url.search}`.includes(rule.urlPattern);
}
