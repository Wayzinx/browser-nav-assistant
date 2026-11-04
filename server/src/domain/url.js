import { LIMITS } from '../config.js';

// @code C-BE-CORE-09
const TRACKING_KEYS = new Set(['ref', 'ref_src', 'spm', 'from', 'fbclid', 'gclid', '_ga']);
const SEMANTIC_KEYS = ['q', 'query', 'wd', 'keyword', 'search', 'v', 'id'];

/** @param {string|URL} raw 原始地址 @returns {URL|null} 独立的 http(s) URL；坏记录由调用方计数。 */
export function parseHttpUrl(raw) {
  if (!(typeof raw === 'string' || raw instanceof URL)) return null;
  const text = String(raw).trim();
  if (!text || text.length > LIMITS.maxUrlLength) return null;
  try {
    const url = new URL(text);
    return ['http:', 'https:'].includes(url.protocol) ? url : null;
  } catch {
    // 单条非法地址不应让整个同步批次失败。
    return null;
  }
}

/** @param {string|URL} raw 页面地址 @returns {string|null} 保留业务参数、去跟踪参数及 hash 的存储主键。 */
export function normalizeUrl(raw) {
  const url = parseHttpUrl(raw);
  if (!url) return null;
  for (const key of [...url.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (lower.startsWith('utm_') || TRACKING_KEYS.has(lower)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  const path = url.pathname.replace(/\/+$/, '') || '/';
  // 按契约用 host 组装，避免把 URL 中的用户名或密码带进主键。
  return `${url.protocol}//${url.host}${path}${url.search}`;
}

/** @param {string|URL} raw 页面地址 @returns {string|null} 忽略协议与非语义参数的重复页 key。 */
export function buildDupKey(raw) {
  const url = parseHttpUrl(raw);
  if (!url) return null;
  const query = new URLSearchParams();
  for (const key of SEMANTIC_KEYS) {
    for (const value of url.searchParams.getAll(key)) query.append(key, value);
  }
  const suffix = query.toString();
  return `${url.host.replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '')}${suffix ? `?${suffix}` : ''}`;
}

/** @param {string|URL} raw 页面地址 @returns {string|null} 小写、去 www. 的域名，不含端口。 */
export function domainOf(raw) {
  return parseHttpUrl(raw)?.hostname.replace(/^www\./, '') ?? null;
}

/** @param {string|URL} raw 页面地址 @returns {{repo:string, kind:string}|null} GitHub 仓库及路径类型。 */
export function parseGithubRepo(raw) {
  const url = parseHttpUrl(raw);
  if (!url || domainOf(url) !== 'github.com') return null;
  const [owner, name, kind = 'repo'] = url.pathname.split('/').filter(Boolean);
  if (!owner || !name) return null;
  return { repo: `${owner}/${name}`.toLowerCase(), kind: kind.toLowerCase() };
}
