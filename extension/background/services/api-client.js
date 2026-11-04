import { DEFAULT_API_BASE, DEFAULTS } from '../../shared/constants.js';
import { SK } from '../../shared/storage-keys.js';
import { log } from '../../shared/logger.js';
import { storageGet, storagePatch } from './storage.js';

// @code C-FE-CORE-03
let requestSequence = 0;

/** @returns {string} 每次实际 HTTP 请求的关联 ID。 */
export function nextRequestId() {
  return `ext_${Date.now()}_${++requestSequence}`;
}

/** @returns {Promise<string>} 读取持久化地址；未配置时使用 api-contract 的默认端口。 */
export async function getApiBase() {
  const configured = await storageGet(SK.API_BASE_URL, DEFAULT_API_BASE);
  try {
    if (typeof configured !== 'string' || !configured.trim()) throw new Error();
    const url = new URL(configured.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error();
    }
    return url.href.replace(/\/+$/, '');
  } catch {
    throw Object.assign(new Error('地址格式错误'), { code: 'INVALID_URL' });
  }
}

/** 只返回可展示的错误字段，不透出底层 fetch 异常或请求体。 */
function mapException(error, aborted = false) {
  if (aborted || ['TimeoutError', 'AbortError'].includes(error?.name)) {
    return { code: 'TIMEOUT', message: '连接后端超时，请检查后端服务' };
  }
  if (error instanceof TypeError) {
    return { code: 'BACKEND_UNREACHABLE', message: '无法连接后端，请检查后端服务和 API 地址' };
  }
  return {
    code: error?.code || 'INTERNAL',
    message: error?.code ? error.message : '请求处理失败',
    ...(error?.details !== undefined ? { details: error.details } : {}),
  };
}

/** 解析所有 2xx（含 201）；非 JSON 与 HTTP 业务错误分开处理。 */
async function readResponse(response) {
  let data;
  try {
    data = await response.json();
  } catch (error) {
    if (['AbortError', 'TimeoutError'].includes(error?.name)) throw error;
    return { ok: false, status: response.status, error: { code: 'INVALID_RESPONSE', message: '后端返回的不是有效 JSON' } };
  }
  if (data === null || typeof data !== 'object') {
    return { ok: false, status: response.status, error: { code: 'INVALID_RESPONSE', message: '后端返回的 JSON 结构无效' } };
  }
  if (response.ok) return { ok: true, status: response.status, data };
  const backend = data.error;
  return {
    ok: false,
    status: response.status,
    error: {
      code: typeof backend?.code === 'string' ? backend.code : `HTTP_${response.status}`,
      message: typeof backend?.message === 'string' ? backend.message : `后端请求失败（HTTP ${response.status}）`,
      ...(backend?.details !== undefined ? { details: backend.details } : {}),
    },
  };
}

/** 每次尝试都使用新的请求 ID，超时覆盖读取响应体的全过程。 */
async function requestOnce(method, base, path, encodedBody, timeoutMs, attempt) {
  const requestId = nextRequestId();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let result;
  log('api.request', { requestId, method, path, attempt, timeoutMs });
  try {
    const response = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-request-id': requestId },
      ...(encodedBody === undefined ? {} : { body: encodedBody }),
      signal: controller.signal,
    });
    result = await readResponse(response);
  } catch (error) {
    result = { ok: false, error: mapException(error, controller.signal.aborted) };
  } finally {
    clearTimeout(timer);
  }
  log('api.response', {
    requestId, method, path, attempt, status: result.status ?? null,
    ok: result.ok, errorCode: result.error?.code ?? null,
  }, result.ok ? 'info' : 'warn');
  await updateConnection(result);
  return result;
}

/** 恢复标记只由恢复模块清除，普通成功请求保留原有标记。 */
async function updateConnection(result) {
  const networkFailure = ['BACKEND_UNREACHABLE', 'TIMEOUT'].includes(result.error?.code);
  try {
    await storagePatch(SK.CONNECTION, (current) => {
      const previous = current && typeof current === 'object' ? current : {};
      const now = Date.now();
      const status = result.ok ? 'online' : networkFailure ? 'offline' : (previous.status || 'unknown');
      return {
        ...previous,
        status,
        since: status === previous.status ? (previous.since ?? now) : now,
        lastCheckedAt: now,
        lastErrorCode: result.ok ? null : result.error.code,
        recoverPending: networkFailure || previous.recoverPending === true,
      };
    });
  } catch (error) {
    log('api.connection-storage-error', { code: error?.code || 'STORAGE_FAILED' }, 'warn');
  }
}

/** 只有 GET 的可恢复失败重试一次；所有 4xx 与写操作都立即返回。 */
function shouldRetry(method, result, retry, attempt) {
  if (method !== 'GET' || retry === false || retry === 0 || attempt >= 1 || result.ok) return false;
  if (result.status >= 400 && result.status < 500) return false;
  return ['BACKEND_UNREACHABLE', 'TIMEOUT', 'INVALID_RESPONSE'].includes(result.error?.code)
    || result.status >= 500;
}

/** 本地编码失败与后端断连分开，不能把不可序列化参数误报为离线。 */
function encodeBody(body) {
  if (body === undefined) return undefined;
  try {
    return JSON.stringify(body);
  } catch {
    throw Object.assign(new Error('请求体不是可序列化的 JSON'), { code: 'INVALID_REQUEST' });
  }
}

/**
 * @param {string} method HTTP 方法。
 * @param {string} path 以 / 开始的本后端路径，可带查询参数。
 * @param {unknown} [body] JSON 请求体；日志不会记录它。
 * @param {{timeoutMs?: number, retry?: boolean|number}} [options={}] retry=false/0 关闭 GET 重试；最多一次。
 * @returns {Promise<{ok: true, status: number, data: Object}|{ok: false, status?: number, error: {code: string, message: string, details?: unknown}}>} 统一结果信封。
 */
export async function callApi(method, path, body, options = {}) {
  try {
    const verb = String(method).toUpperCase();
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
      throw Object.assign(new Error('接口路径无效'), { code: 'INVALID_URL' });
    }
    const pathname = path.split('?')[0];
    const defaultTimeout = pathname === '/api/health' ? DEFAULTS.HEALTH_TIMEOUT_MS
      : pathname === '/api/sync' ? DEFAULTS.SYNC_TIMEOUT_MS : DEFAULTS.API_TIMEOUT_MS;
    const timeoutMs = options.timeoutMs ?? defaultTimeout;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw Object.assign(new Error('请求超时配置无效'), { code: 'INVALID_TIMEOUT' });
    }
    const base = await getApiBase();
    const encodedBody = encodeBody(body);
    let result = await requestOnce(verb, base, path, encodedBody, timeoutMs, 0);
    if (shouldRetry(verb, result, options.retry, 0)) {
      result = await requestOnce(verb, base, path, encodedBody, timeoutMs, 1);
    }
    return result;
  } catch (error) {
    return { ok: false, error: mapException(error) };
  }
}
