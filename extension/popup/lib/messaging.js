import { MSG } from '../../shared/messages.js';
import { log } from '../../shared/logger.js';

let sequence = 0;

function failure(code, message) {
  return { ok: false, error: { code, message } };
}

function normalizeResponse(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    return failure('INVALID_RESPONSE', '扩展返回了无效响应。');
  }
  if (response.ok === true && Object.hasOwn(response, 'data')) {
    return { ok: true, data: response.data };
  }
  const error = response.error;
  if (response.ok === false && error && typeof error.code === 'string'
    && error.code && typeof error.message === 'string' && error.message) {
    return { ok: false, error: { ...error } };
  }
  return failure('INVALID_RESPONSE', '扩展响应不符合通信协议。');
}

// @code C-FE-CORE-07
/**
 * 向后台发送带超时的消息；所有通信结果都转换为响应信封。
 * @param {string} type 消息类型。
 * @param {object} [payload={}] 请求参数。
 * @param {{timeoutMs?: number}} [options={}] 可覆盖默认超时。
 * @returns {Promise<{ok: boolean, data?: unknown, error?: object}>} 响应信封。
 */
export function send(type, payload = {}, options = {}) {
  return new Promise((resolve) => {
    const requestId = `pop_${Date.now()}_${++sequence}`;
    const fallbackMs = type === MSG.SYNC_NOW ? 15000 : 10000;
    const candidate = options?.timeoutMs;
    const timeoutMs = Number.isFinite(candidate) && candidate > 0 ? candidate : fallbackMs;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      log('popup.message.result', { requestId, type, ok: result.ok, code: result.error?.code });
      resolve(result);
    };
    const timer = setTimeout(() => finish(failure('TIMEOUT', '扩展响应超时，请重试。')), timeoutMs);
    try {
      const runtime = globalThis.chrome?.runtime;
      if (typeof runtime?.sendMessage !== 'function') {
        finish(failure('INTERNAL', '扩展通信不可用，请重新加载扩展。'));
        return;
      }
      log('popup.message.send', { requestId, type });
      const pending = runtime.sendMessage({ type, payload, requestId }, (response) => {
        const lastError = runtime.lastError;
        finish(lastError
          ? failure('INTERNAL', lastError.message || '扩展通信失败，请重试。')
          : normalizeResponse(response));
      });
      if (pending && typeof pending.then === 'function') {
        pending.then((response) => finish(normalizeResponse(response)), () => {
          finish(failure('INTERNAL', '扩展通信失败，请重试。'));
        });
      }
    } catch {
      finish(failure('INTERNAL', '扩展通信失败，请重新加载扩展。'));
    }
  });
}
