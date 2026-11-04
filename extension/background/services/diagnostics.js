import { callApi, getApiBase } from './api-client.js';
import { storageSet } from './storage.js';
import { readCache, writeCache } from './cache.js';
import { checkBackend, checkLastSync, checkRuleCount, checkPrivacy, checkVersion } from './diag-checks-backend.js';
import { checkTabs, checkHistory, checkStorage, checkActiveTab, checkIncognito } from './diag-checks-env.js';
import { DEFAULTS } from '../../shared/constants.js';
import { SK } from '../../shared/storage-keys.js';

const NAMES = Object.freeze({
  backend: '后端服务连接', tabs: 'tabs 权限', history: 'history 权限', storage: 'storage 可用',
  apiBaseUrl: 'API Base URL', lastSync: '最近一次同步', ruleCount: '当前规则数量',
  activeTab: 'activeTab 权限', privacy: '隐私过滤', incognito: '无痕模式', version: '版本兼容',
});
const STATUSES = ['ok', 'warn', 'fail', 'info'];
let pending = Promise.resolve();

// @code C-FE-DIAG-09
/** @param {string} id 检查标识。 @param {Function} check 独立检查。 @returns {Promise<object>} 异常转换为可操作的失败项。 */
export async function safeCheck(id, check) {
  try {
    const result = await check();
    if (!result || !STATUSES.includes(result.status) || typeof result.detail !== 'string') {
      throw new Error('检查返回值无效');
    }
    const hint = Array.isArray(result.hint) ? result.hint.filter((step) => typeof step === 'string') : [];
    if (['warn', 'fail'].includes(result.status) && !hint.length) hint.push('检查插件权限和后端服务，然后点击「重新检测」');
    return { ...result, id, name: NAMES[id] || id, hint };
  } catch (error) {
    return { id, name: NAMES[id] || id, status: 'fail', detail: error?.message || '检查发生异常',
      hint: ['在 chrome://extensions 中重新加载插件，然后点击「重新检测」'] };
  }
}

async function checkApiBase() {
  const apiBaseUrl = await getApiBase();
  const allowed = await chrome.permissions.contains({ origins: [`${new URL(apiBaseUrl).origin}/*`] });
  return {
    status: allowed ? 'ok' : 'warn', value: apiBaseUrl,
    detail: allowed ? '地址格式有效，已获访问授权' : '地址格式有效，但未授权访问该地址',
    hint: allowed ? [] : ['在 manifest 的 host_permissions 中加入该地址，然后重新加载插件'],
  };
}

async function loadConfig() {
  const response = await callApi('GET', '/api/config', undefined, { retry: false });
  if (response.ok && response.status === 200 && response.data && !Array.isArray(response.data)) {
    await writeCache('config', response.data);
    return { ...response.data, source: 'server' };
  }
  const config = (await readCache('config'))?.data;
  return config && typeof config === 'object' && !Array.isArray(config) ? { ...config, source: 'cache' }
    : { enablePrivacyFilter: true, privacySensitiveKeywords: [...DEFAULTS.PRIVACY_SENSITIVE_KEYWORDS], source: 'default' };
}

function publicItem(item) {
  const { id, name, status, detail, hint, value, action } = item;
  return { id, name, status, detail, hint,
    ...(value === undefined ? {} : { value }), ...(action ? { action } : {}) };
}

async function executeDiagnostics() {
  const backend = await safeCheck('backend', () => checkBackend());
  const health = backend.status === 'ok' ? backend.health : null;
  // 顺序与契约一致；每个独立检查都经过同一异常隔离边界。
  const checks = [
    backend,
    await safeCheck('tabs', () => checkTabs()),
    await safeCheck('history', () => checkHistory()),
    await safeCheck('storage', () => checkStorage()),
    await safeCheck('apiBaseUrl', () => checkApiBase()),
    await safeCheck('lastSync', () => checkLastSync(health)),
    await safeCheck('ruleCount', () => checkRuleCount(health)),
    await safeCheck('activeTab', () => checkActiveTab()),
    await safeCheck('privacy', async () => checkPrivacy(await loadConfig())),
    await safeCheck('incognito', () => checkIncognito()),
    await safeCheck('version', () => checkVersion(health)),
  ];
  const items = checks.map(publicItem);
  const summary = { ok: 0, warn: 0, fail: 0, info: 0 };
  for (const item of items) summary[item.status]++;
  const result = { checkedAt: Date.now(), summary, items };
  await storageSet(SK.LAST_DIAGNOSTICS, result);
  return result;
}

// @code C-FE-DIAG-09
/** @returns {Promise<{checkedAt:number,summary:object,items:object[]}>} 每次完整执行；串行保护共享探测 key。 */
export function runDiagnostics() {
  const run = pending.then(executeDiagnostics, executeDiagnostics);
  pending = run.catch(() => {});
  return run;
}
