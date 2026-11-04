import { callApi, getApiBase } from './api-client.js';
import { loadSyncState } from './sync-state.js';
import { readCache, writeCache } from './cache.js';
import { DAY_MS, DEFAULTS, DEFAULT_API_BASE, EXPECTED_API_MAJOR } from '../../shared/constants.js';

function failed(id, name, error, hint) {
  return { id, name, status: 'fail', detail: error?.message || '检查失败，请重新检测', hint };
}

function backendFailure(result, latencyMs, hint) {
  const code = result.error?.code;
  const non200 = Number.isInteger(result.status) && result.status !== 200;
  const kind = non200 ? 'http' : code === 'TIMEOUT' ? 'timeout'
    : code === 'INVALID_RESPONSE' ? 'not_json' : result.status === 200 ? 'http' : 'refused';
  const message = kind === 'http' ? `HTTP ${result.status ?? '错误'}：后端健康检查未通过`
    : kind === 'timeout' ? '连接超时' : kind === 'not_json' ? '返回的不是 JSON 或 JSON 结构无效' : '连接被拒绝';
  return {
    id: 'backend', name: '后端服务连接', status: 'fail',
    detail: `${message}；${result.error?.message || '请检查后端健康状态'}；耗时 ${latencyMs} ms`,
    latencyMs, health: null, error: { kind, message }, hint,
  };
}

// @code C-FE-DIAG-01
/** @param {{timeoutMs?: number}} [options={}] 单次请求超时。 @returns {Promise<object>} 健康检查及原始健康快照。 */
export async function checkBackend({ timeoutMs = DEFAULTS.HEALTH_TIMEOUT_MS } = {}) {
  const startedAt = Date.now();
  let base = DEFAULT_API_BASE;
  let result;
  try {
    base = await getApiBase();
    result = await callApi('GET', '/api/health', undefined, { timeoutMs, retry: false });
  } catch (error) {
    result = { ok: false, error: { code: error?.code, message: error?.message } };
  }
  const latencyMs = Math.max(0, Date.now() - startedAt);
  const hint = [
    '运行 ./scripts/start.sh 启动后端',
    '核对端口与 API Base URL 是否一致',
    '确认 manifest 的 host_permissions 包含该地址',
    `在浏览器中直接打开 ${base}/api/health 自查`,
  ];
  if (!result.ok || result.status !== 200 || result.data?.status !== 'ok') {
    return backendFailure(result, latencyMs, hint);
  }
  return {
    id: 'backend', name: '后端服务连接', status: 'ok',
    detail: `后端服务连接正常；耗时 ${latencyMs} ms`,
    value: `version=${result.data.version ?? '未知'}，${latencyMs} ms`,
    latencyMs, health: result.data, error: null, hint: [],
  };
}

// @code C-FE-DIAG-06
/** @param {object|null} health 同一轮健康快照。 @returns {Promise<object>} 最近同步及数据丢失提示。 */
export async function checkLastSync(health) {
  const item = { id: 'lastSync', name: '最近一次同步', status: 'warn', hint: ['点击「立即同步」同步浏览器上下文'] };
  try {
    const state = await loadSyncState();
    if (state?.status === 'error') {
      return { ...item, status: 'fail', detail: `最近一次同步失败：${state.lastError?.message || '原因未知'}`,
        hint: ['先处理「后端服务连接」，再点击「立即同步」重试'], action: 'sync' };
    }
    if (state?.status === 'syncing') {
      return { ...item, detail: '同步进行中，请等待完成后重新检测', hint: ['等待同步完成，再点击「重新检测」'] };
    }
    const at = state?.lastSuccessAt;
    if (!Number.isFinite(at) || at <= 0) return { ...item, detail: '从未同步', action: 'sync' };
    const uploaded = Number.isInteger(state.stats?.uploaded) ? state.stats.uploaded : '未知';
    const detail = `最近同步时间：${new Date(at).toLocaleString('zh-CN')}；上传 ${uploaded} 条`;
    const lost = health && (health.pageCount === 0 || health.lastSyncAt === null
      || (health.persistence === 'memory' && health.startedAt > at));
    if (lost) return { ...item, detail: `后端数据少于本地同步记录，请全量同步；${detail}`, action: 'fullSync' };
    if (Date.now() - at > DAY_MS) return { ...item, detail: `超过 24 小时未同步；${detail}`, action: 'sync' };
    return { ...item, status: 'ok', detail, value: uploaded, hint: [] };
  } catch (error) {
    return failed(item.id, item.name, error, ['检查插件存储，并在首页重新同步']);
  }
}

async function getRulesCache() {
  const cached = await readCache('rules');
  const rules = cached?.data?.rules ?? cached?.data;
  return Array.isArray(rules) ? rules : null;
}

// @code C-FE-DIAG-07
/** @param {object|null} health 同一轮后端规则数。 @returns {Promise<object>} 缓存核对及真实重拉结果。 */
export async function checkRuleCount(health) {
  const item = { id: 'ruleCount', name: '当前规则数量', status: 'warn', hint: ['在规则页签刷新规则，再重新检测'] };
  try {
    const rules = await getRulesCache();
    const count = rules?.length;
    if (!Number.isInteger(health?.ruleCount) || health.ruleCount < 0) {
      return { ...item, detail: '后端规则数不可用，暂时无法核对本地缓存', ...(count === undefined ? {} : { value: count }) };
    }
    if (count === health.ruleCount) {
      return { ...item, status: 'ok', detail: `本地缓存与后端均为 ${count} 条规则`, value: count, hint: [] };
    }
    const mismatch = `规则数不一致：本地 ${count ?? '未缓存'}，后端 ${health.ruleCount}`;
    const response = await callApi('GET', '/api/rules', undefined, { retry: false });
    if (!response.ok || !Array.isArray(response.data?.rules)) {
      return { ...item, detail: `${mismatch}；自动重新拉取失败：${response.error?.message || '规则响应无效'}`,
        ...(count === undefined ? {} : { value: count }) };
    }
    await writeCache('rules', response.data);
    const refreshed = response.data.rules.length;
    return { ...item, detail: `${mismatch}；已自动重新拉取 ${refreshed} 条规则，请重新检测核对`, value: refreshed };
  } catch (error) {
    return failed(item.id, item.name, error, item.hint);
  }
}

// @code C-FE-DIAG-08
/** @param {object|null} config 本轮配置，带 server/cache/default 来源。 @returns {Promise<object>} 隐私开关及关键词可用性。 */
export async function checkPrivacy(config) {
  const item = { id: 'privacy', name: '隐私过滤', status: 'warn', hint: ['检查后端配置 enablePrivacyFilter 和 privacySensitiveKeywords'] };
  try {
    const enabled = config?.enablePrivacyFilter;
    const keywords = config?.privacySensitiveKeywords;
    const count = Array.isArray(keywords) ? keywords.filter((word) => typeof word === 'string' && word.trim()).length : 0;
    const source = config?.source || 'server';
    if (enabled === false) return { ...item, detail: `隐私过滤已关闭（enablePrivacyFilter=false）；来源：${source}` };
    if (enabled !== true || count === 0) return { ...item, detail: `隐私配置无效或关键词为空；来源：${source}` };
    const detail = `隐私过滤已启用，关键词 ${count} 个；来源：${source}`;
    if (source !== 'server') return { ...item, detail: `${detail}；后端配置不可用，正在使用兜底配置` };
    return { ...item, status: 'ok', detail, value: count, hint: [] };
  } catch (error) {
    return failed(item.id, item.name, error, item.hint);
  }
}

// @code C-FE-DIAG-08
/** @param {object|null} health 本轮健康快照。 @returns {Promise<object>} API 主版本兼容检查。 */
export async function checkVersion(health) {
  const item = { id: 'version', name: '版本兼容', status: 'warn', hint: ['升级插件或后端，使主版本一致'] };
  try {
    if (!health) return { ...item, detail: '后端不可达，无法确认版本兼容性' };
    const version = health.version;
    const valid = typeof version === 'string' && /^\d+\.\d+\.\d+(?:[-+].*)?$/.test(version);
    const compatible = valid && Number(version.split('.')[0]) === EXPECTED_API_MAJOR;
    return { ...item, status: compatible ? 'ok' : 'fail', value: version ?? '未知',
      detail: compatible ? `后端版本 ${version}，主版本兼容` : `后端版本 ${version ?? '未知'}，插件期望主版本 ${EXPECTED_API_MAJOR}，请升级插件或后端`,
      hint: compatible ? [] : item.hint };
  } catch (error) {
    return failed(item.id, item.name, error, item.hint);
  }
}
