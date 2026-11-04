// @code C-BE-RULE-02
const DIGITS = Object.freeze({ 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 });
const UNITS = Object.freeze({ 十: 10, 百: 100, 千: 1000, 万: 10000 });
const NUMBER_TEXT = '[+-]?\\d+(?:\\.\\d+)?|[零〇一二两三四五六七八九十百千万几半]+';
const DOMAIN_PATTERN = /(?:[a-z0-9-]+\.)+[a-z]{2,}(?![a-z0-9-])/giu;
const SITE_ALIASES = [
  [/\bGitHub\b/giu, 'github.com'],
  [/\bMDN\b/giu, 'developer.mozilla.org'],
  [/\bReact\b/giu, 'react.dev'],
  [/\bGoogle\b|谷歌/giu, 'google.com'],
  [/\bStack\s+Overflow\b/giu, 'stackoverflow.com'],
  [/\bnpm\b/giu, 'npmjs.com'],
  [/飞书/gu, 'feishu.cn'],
  [/语雀/gu, 'yuque.com'],
];
// 月按技术方案固定为 30 天，不读取日历或系统时间。
const DAYS_BY_UNIT = Object.freeze({ 天: 1, 日: 1, 周: 7, 星期: 7, 月: 30 });

/** @param {string|number} input 阿拉伯或中文整数 @returns {number|null} 非负安全整数；模糊数量和非法数字返回 null。 */
export function parseChineseNumber(input) {
  const text = String(input).trim();
  if (/^\d+$/u.test(text)) {
    const value = Number(text);
    return Number.isSafeInteger(value) ? value : null;
  }
  if (!/^[零〇一二两三四五六七八九十百千万]+$/u.test(text)) return null;
  if (!/[十百千万]/u.test(text)) {
    const value = Number([...text].map((digit) => DIGITS[digit]).join(''));
    return Number.isSafeInteger(value) ? value : null;
  }
  let total = 0;
  let section = 0;
  let digit = 0;
  for (const character of text) {
    if (Object.hasOwn(DIGITS, character)) {
      digit = DIGITS[character];
    } else if (character === '万') {
      total += (section + digit || 1) * UNITS[character];
      section = 0;
      digit = 0;
    } else {
      section += (digit || 1) * UNITS[character];
      digit = 0;
    }
  }
  const value = total + section + digit;
  return Number.isSafeInteger(value) ? value : null;
}

/** @param {string} text 子句原文 @returns {number|null} 首个明确时长换算的天数，未提供或数字不合法时为 null。 */
export function extractDays(text) {
  const match = new RegExp(`(${NUMBER_TEXT})\\s*(?:个\\s*)?(天|日|周|星期|月)`, 'u').exec(text);
  if (!match) return null;
  const number = parseChineseNumber(match[1]);
  const unit = match[2];
  const days = number === null ? null : number * DAYS_BY_UNIT[unit];
  return Number.isSafeInteger(days) ? days : null;
}

/**
 * @param {string} text 子句原文
 * @returns {{domain:string,label:string,index:number}[]} 显式域名和站点别名按位置排序，同一域名只保留首次出现
 */
export function extractDomains(text) {
  const explicit = [...text.matchAll(DOMAIN_PATTERN)].map((match) => ({
    domain: match[0].toLowerCase().replace(/^www\./u, ''), label: match[0], index: match.index,
  }));
  const matches = [...explicit];
  for (const [pattern, domain] of SITE_ALIASES) {
    for (const match of text.matchAll(pattern)) {
      // 别名不能在显式域名内部再次命中，例如 react.dev 不能变成两个站点。
      if (explicit.some((item) => match.index < item.index + item.label.length && match.index + match[0].length > item.index)) continue;
      matches.push({ domain, label: match[0], index: match.index });
    }
  }
  matches.sort((left, right) => left.index - right.index);
  const seen = new Set();
  return matches.filter(({ domain }) => {
    if (seen.has(domain)) return false;
    seen.add(domain);
    return true;
  });
}

/** @param {string} text 子句原文 @returns {string|null} 最先出现的受支持页面类型对应的 path 子串。 */
export function extractPageType(text) {
  const types = [
    [/\bissues?\b/iu, '/issues/'],
    [/\b(?:PR|pull\s+requests?)\b/iu, '/pull/'],
    [/\b(?:actions?|CI)\b/iu, '/actions'],
    [/搜索结果(?:页)?|搜索页/u, '/search'],
  ];
  const matches = types.map(([pattern, value]) => ({ index: text.search(pattern), value }));
  return matches.filter((item) => item.index >= 0).sort((left, right) => left.index - right.index)[0]?.value ?? null;
}

/** @param {string} text 子句原文 @returns {string[]} 包含/含有/带有/含后的关键词，转小写，按首次出现顺序去重。 */
export function extractKeywords(text) {
  const match = /(?:包含|含有|带有|含)\s*(.*?)(?:\s*的\s*(?:URL|网址|链接|页面|地址)|$)/iu.exec(text);
  if (!match) return [];
  const keywords = match[1].split(/[、，,\/\s]+|和|及/gu)
    .map((word) => word.replace(/^["'“”‘’「」\[\]【】]+|["'“”‘’「」\[\]【】]+$/gu, '').trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(keywords)];
}

/** @param {string} text 子句原文 @returns {number|null} 连续或一连访问的显式次数；未指定或数字非法时为 null，0 保留供上层拒绝。 */
export function extractCount(text) {
  const match = new RegExp(`(?:连续|一连)\\s*(?:看|访问|浏览|打开)\\s*(?:了\\s*)?(${NUMBER_TEXT})\\s*(?:个|篇|次|页)`, 'u').exec(text);
  return match ? parseChineseNumber(match[1]) : null;
}
