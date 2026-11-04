import { normalizeKeywords } from '../domain/privacy.js';
import { listRules } from '../store/rule-repo.js';
import { getSettings } from '../store/settings-repo.js';
import { getVersions, onReset } from '../store/state.js';

// @code C-BE-PRIV-02
let keywordCache = null;

/** @returns {string[]} 配置与启用的 privacy_filter 规则的并集副本；空配置不会补回默认词。 */
export function getEffectiveKeywords() {
  const versions = getVersions();
  if (!keywordCache || keywordCache.rule !== versions.rule || keywordCache.config !== versions.config) {
    const settings = getSettings();
    const ruleKeywords = listRules()
      .filter((rule) => rule.enabled && rule.type === 'privacy_filter')
      .flatMap((rule) => rule.keywords);
    keywordCache = {
      rule: versions.rule,
      config: versions.config,
      keywords: normalizeKeywords([...settings.privacySensitiveKeywords, ...ruleKeywords]),
    };
  }
  return [...keywordCache.keywords];
}

/** @returns {boolean} 当前过滤开关；关闭过滤不影响公开关键词表。 */
export function isPrivacyFilterEnabled() {
  return getSettings().enablePrivacyFilter;
}

/** @returns {void} reset 时丢弃版本与关键词，避免沿用上轮配置或规则。 */
export function resetKeywordCache() {
  keywordCache = null;
}

/**
 * 只输出原因和域名计数，URL 的用户名、路径、查询串与片段都不会进入日志摘要。
 * @param {{url:unknown,reason:'privacy'|'invalid_url'}[]} entries 本批被拒收的记录
 * @returns {{rejectedByReason:{privacy:number,invalid_url:number},rejectedDomains:Record<string,number>}} 拒收摘要
 */
export function summarizeRejected(entries) {
  const rejectedByReason = { invalid_url: 0, privacy: 0 };
  const domains = new Map();
  for (const { url, reason } of entries) {
    if (!Object.hasOwn(rejectedByReason, reason)) continue;
    rejectedByReason[reason] += 1;
    // 非字符串和非法 URL 也计入拒收，但不能作为域名写入日志。
    if (typeof url !== 'string') continue;
    try {
      const parsed = new URL(url);
      if (['http:', 'https:'].includes(parsed.protocol)) {
        domains.set(parsed.hostname, (domains.get(parsed.hostname) ?? 0) + 1);
      }
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      // URL 无法解析时只有原因计数，避免把原始输入当作域名回显。
    }
  }
  return { rejectedByReason, rejectedDomains: Object.fromEntries(domains) };
}

onReset(resetKeywordCache);
