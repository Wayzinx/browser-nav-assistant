import { handlers } from './handlers/index.js';
import { registerContextMenus, onMenuClick } from './services/context-menu.js';
import { log } from '../shared/logger.js';

// @code C-FE-CORE-01
// manifest.json 使用 MV3、模块 SW、本机后端 host_permissions 与默认安全 CSP；JSON 不放注释。

// @code C-FE-CORE-02
/** 只把契约定义的错误字段传给 popup，保留后端 details。 */
function errorEnvelope(error) {
  return {
    ok: false,
    error: {
      code: error?.code || 'INTERNAL',
      message: error?.message || '操作失败，请稍后重试',
      ...(error?.details !== undefined ? { details: error.details } : {}),
    },
  };
}

/**
 * @param {{type?: string, payload?: Object, requestId?: string}} message 请求信封。
 * @param {Object} [sender={}] Chrome 消息发送方。
 * @returns {Promise<{ok: true, data: unknown}|{ok: false, error: Object}>} 不向 popup 抛出异常。
 */
export async function dispatchMessage(message, sender = {}) {
  const type = message?.type;
  const handler = typeof type === 'string' ? handlers[type] : undefined;
  if (typeof handler !== 'function') {
    return { ok: false, error: { code: 'UNKNOWN_MESSAGE', message: '未知消息类型' } };
  }
  const requestId = message?.requestId;
  try {
    const data = await handler(message.payload ?? {}, sender);
    log('message.complete', { type, requestId });
    return { ok: true, data };
  } catch (error) {
    const result = errorEnvelope(error);
    log('message.failed', { type, requestId, code: result.error.code }, 'warn');
    return result;
  }
}

/** popup 关闭后 sendResponse 可能失败，不让它产生未处理的 Promise 拒绝。 */
function respond(sendResponse, result) {
  try { sendResponse(result); } catch { log('message.response-channel-closed', {}, 'debug'); }
}

/** 菜单模块尚未实现或执行失败时，只记录当前事件，不阻断其他监听器。 */
function runEvent(event, task) {
  Promise.resolve().then(task).catch((error) => {
    log(event, { code: error?.code || 'INTERNAL', message: error?.message }, 'warn');
  });
}

// 必须在模块顶层同步注册，SW 被唤醒时才能立即接收事件。
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  dispatchMessage(message, sender).then(
    (result) => respond(sendResponse, result),
    (error) => respond(sendResponse, errorEnvelope(error)),
  );
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  runEvent('menu.registration-failed', () => registerContextMenus());
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  runEvent('menu.action-failed', () => onMenuClick(info, tab));
});
