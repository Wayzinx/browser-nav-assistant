import { storageGet } from './storage.js';
import { getApiBase } from './api-client.js';
import { SK } from '../../shared/storage-keys.js';

const CONFIG_NUMBERS = ['cleanupThresholdDays', 'maxHistoryItems', 'historyLookbackDays', 'recencyHalfLifeDays', 'minRecommendationScore'];
const STATS = ['uploaded', 'filtered', 'received', 'created', 'updated', 'rejected'];
const CHECK_IDS = ['backend', 'tabs', 'history', 'storage', 'apiBaseUrl', 'lastSync', 'ruleCount', 'activeTab', 'privacy', 'incognito', 'version'];

function scrubText(text) {
  return text
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`]+/gi, '[已移除 URL]')
    .replace(/\b(?:about|data|blob):[^\s<>"'`]+/gi, '[已移除 URL]')
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s<>"'`]*)?/gi, '[已移除 URL]');
}

function scrubValue(value, depth) {
  if (typeof value === 'string') return scrubText(value);
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [scrubText(key),
      depth === 0 && key === 'apiBaseUrl' && typeof item === 'string' ? item : scrubValue(item, depth + 1),
    ]));
  }
  return value;
}

// @code C-FE-DIAG-10
/** @param {unknown} value 报告值。 @returns {unknown} 递归脱敏的副本，仅根节点 apiBaseUrl 保留 URL。 */
export function scrubUrls(value) {
  return scrubValue(value, 0);
}

function numbersOnly(source, keys) {
  return Object.fromEntries(keys.filter((key) => typeof source?.[key] === 'number' && Number.isFinite(source[key]))
    .map((key) => [key, source[key]]));
}

function publicConfig(config) {
  const result = numbersOnly(config, CONFIG_NUMBERS);
  if (typeof config?.enablePrivacyFilter === 'boolean') result.enablePrivacyFilter = config.enablePrivacyFilter;
  if (typeof config?.apiVersion === 'string') result.apiVersion = config.apiVersion;
  for (const key of ['privacySensitiveKeywords', 'baseSensitiveKeywords']) {
    if (Array.isArray(config?.[key])) result[key] = config[key].filter((word) => typeof word === 'string');
  }
  if (config?.weights) result.weights = numbersOnly(config.weights, ['recency', 'frequency', 'open', 'domain']);
  if (config?.limits) result.limits = numbersOnly(config.limits, ['maxItemsPerSync', 'maxUrlLength', 'maxRuleTextLength', 'maxBodyBytes']);
  return result;
}

function publicSync(state) {
  const status = ['idle', 'syncing', 'success', 'error'].includes(state?.status) ? state.status : 'idle';
  return { status, lastSuccessAt: Number.isFinite(state?.lastSuccessAt) ? state.lastSuccessAt : null,
    stats: numbersOnly(state?.stats, STATS) };
}

// @code C-FE-DIAG-10
/** @returns {Promise<object>} 只含诊断、公开配置与同步计数/时间的报告，不复制整个缓存或浏览记录。 */
export async function buildReport() {
  const [diagnostics, cache, state, apiBaseUrl] = await Promise.all([
    storageGet(SK.LAST_DIAGNOSTICS, null), storageGet(SK.CACHE, {}),
    storageGet(SK.SYNC_STATE, null), getApiBase(),
  ]);
  const checks = (Array.isArray(diagnostics?.items) ? diagnostics.items : [])
    .filter((item) => CHECK_IDS.includes(item?.id))
    .map((item) => ({ id: item.id, status: item.status, detail: typeof item.detail === 'string' ? item.detail : '',
      name: typeof item.name === 'string' ? item.name : item.id,
      ...(typeof item.value === 'string' || typeof item.value === 'number' ? { value: item.value } : {}),
      hint: Array.isArray(item.hint) ? item.hint.filter((step) => typeof step === 'string') : [],
    }));
  return scrubUrls({
    generatedAt: Date.now(), extensionVersion: chrome.runtime.getManifest().version,
    apiBaseUrl, checks, config: publicConfig(cache?.config?.data), sync: publicSync(state),
  });
}
