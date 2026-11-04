import { domainOf, parseHttpUrl } from './url.js';

// @code C-BE-REC-03
/** D-17 的内置文档域名；域名清单是产品规则，不是样例推荐数据。 */
const DOC_DOMAINS = new Set(['developer.mozilla.org', 'react.dev', 'docs.internal.com', 'vuejs.org', 'nodejs.org']);
/** 文档页上下文强于普通同域名关联，遵循 D-22 的 rel 口径。 */
const SITE_REL = { doc: 0.8, domain: 0.6 };

/** @param {string} url 当前页面 URL @returns {boolean} 内置域名或文档路径；不将 guidelines 误当 guide。 */
export function isDocPage(url) {
  const parsed = parseHttpUrl(url);
  return Boolean(parsed && (DOC_DOMAINS.has(domainOf(parsed)) || /\/(docs|reference|learn|guide)\b/.test(parsed.pathname)));
}

/** @param {object} entry RankedEntry @param {{currentPage:object|null}} options 上下文 @returns {object|null} 文档同域名召回。 */
export function matchSameDocSite(entry, { currentPage }) {
  const domain = domainOf(currentPage?.url);
  if (!domain || !isDocPage(currentPage.url) || domainOf(entry.page.url) !== domain) return null;
  return {
    ...entry, rel: SITE_REL.doc, strategy: 'same_doc_site',
    reason: `你正在看 ${domain} 文档，这是同站点访问 ${entry.page.visitCount} 次的高频页面`,
  };
}

/** @param {object} entry RankedEntry @param {{currentPage:object|null}} options 上下文 @returns {object|null} 非文档上下文的同域名召回。 */
export function matchSameDomain(entry, { currentPage }) {
  const domain = domainOf(currentPage?.url);
  if (!domain || isDocPage(currentPage.url) || domainOf(entry.page.url) !== domain) return null;
  return {
    ...entry, rel: SITE_REL.domain, strategy: 'same_domain',
    reason: `与当前页面同域名，历史评分较高（${entry.score.toFixed(2)}）`,
  };
}
