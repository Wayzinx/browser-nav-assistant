import { DEFAULTS } from '../../shared/constants.js';
import { isHttpUrl } from '../../shared/url.js';

/**
 * 按系统页、敏感关键词顺序判断，保留配置顺序中的第一个命中词供本地标注。
 * @param {string|null} url 完整 URL。
 * @param {string[]} [keywords=[]] 禁用关键词过滤时传空数组。
 * @returns {{uploadable: boolean, reason: 'system'|'sensitive'|null, keyword?: string}} 分类结果。
 */
// @code C-FE-PRIV-01
export function classifyUrl(url, keywords = []) {
  if (!isHttpUrl(url)) return { uploadable: false, reason: 'system' };
  const value = url.toLowerCase();
  for (const word of keywords) {
    const keyword = word.trim().toLowerCase();
    // 空白词不能匹配所有页面；命中顺序仍与配置保持一致。
    if (keyword && value.includes(keyword)) {
      return { uploadable: false, reason: 'sensitive', keyword };
    }
  }
  return { uploadable: true, reason: null };
}

// @code C-FE-PRIV-01
function uploadFields(entry, isHistory = false) {
  const record = {
    url: entry.url,
    title: typeof entry.title === 'string' && entry.title.trim() ? entry.title : entry.url,
  };
  // 内部标记、其他 URL 和附加对象不属于冻结的上行字段。
  const fields = isHistory ? ['lastVisitTime', 'visitCount'] : ['lastAccessed'];
  for (const field of fields) {
    if (Number.isFinite(entry[field])) record[field] = entry[field];
  }
  return record;
}

/**
 * 在投影上传字段之前过滤；只返回可上传条目与计数，不记录被过滤的 URL。
 * @param {{active: Object|null, tabs: Object[], history: Object[]}} snapshot 采集快照。
 * @param {{enabled: boolean, keywords: string[], source: 'server'|'cache'|'default'}} privacy 隐私配置。
 * @returns {{payload: {active: Object|null, tabs: Object[], history: Object[]}, filteredCount: number, skippedSystem: number}} 上传快照及过滤统计。
 */
// @code C-FE-PRIV-01
export function filterForUpload(snapshot, privacy) {
  const keywords = privacy.enabled === false ? [] : privacy.keywords ?? DEFAULTS.PRIVACY_SENSITIVE_KEYWORDS;
  let filteredCount = 0;
  let skippedSystem = 0;
  const retain = (entry) => {
    // 无痕优先于 URL 分类；系统页不计入界面展示的隐私过滤条数。
    if (!isUploadableTab(entry)) {
      if (entry?.incognito === true) filteredCount++;
      else skippedSystem++;
      return false;
    }
    const classification = classifyUrl(entry.url, keywords);
    if (!classification.uploadable) filteredCount++;
    return classification.uploadable;
  };
  return {
    payload: {
      active: snapshot.active && retain(snapshot.active) ? uploadFields(snapshot.active) : null,
      tabs: snapshot.tabs.filter(retain).map((entry) => uploadFields(entry)),
      history: snapshot.history.filter(retain).map((entry) => uploadFields(entry, true)),
    },
    // 计数在上面的过滤执行后读取，包含 active、tabs 和 history 的全部条目。
    filteredCount,
    skippedSystem,
  };
}

/**
 * 仅生成契约登记的本地标注；无痕条目在展示及上行之前已被剔除。
 * @param {{uploadable: boolean, reason: string|null, keyword?: string}} classification 分类结果。
 * @returns {string} 可展示的过滤原因。
 */
// @code C-FE-PRIV-01
export function privacyLabel(classification) {
  if (classification.reason === 'sensitive') return `含 ${classification.keyword} · 不上传`;
  if (classification.reason === 'system') return '系统页 · 跳过';
  return '';
}

/**
 * 检查浏览器标签的无痕与协议限制；关键词由统一过滤流程处理。
 * @param {Object} tab 浏览器标签页；无痕或非 http(s) 为 false。
 * @returns {boolean} 是否为可上传的普通 http(s) 标签。
 */
// @code C-FE-PRIV-03
export function isUploadableTab(tab) {
  return Boolean(tab && tab.incognito !== true && isHttpUrl(tab.url));
}
