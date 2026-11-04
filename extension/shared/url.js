// @code C-FE-CORE-05
/** 安全解析外部输入；非法值不会打断采集或日志。 */
function parseUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** @param {unknown} value @returns {boolean} 是否为可采集的 http(s) URL。 */
export function isHttpUrl(value) {
  const url = parseUrl(value);
  return url !== null && (url.protocol === 'http:' || url.protocol === 'https:');
}

/** @param {unknown} value @returns {boolean} 非 http(s) 或非法地址均不可上传。 */
export function isSystemUrl(value) {
  return !isHttpUrl(value);
}

/**
 * @param {unknown} value
 * @param {string} [extensionId=chrome.runtime.id] 本插件 ID。
 * @returns {boolean}
 */
export function isOwnExtensionUrl(value, extensionId = globalThis.chrome?.runtime?.id) {
  const url = parseUrl(value);
  return Boolean(extensionId && url?.protocol === 'chrome-extension:' && url.host === extensionId);
}

/** @param {unknown} value @returns {string} 只返回 host，不保留路径、查询或凭据。 */
export function hostOf(value) {
  return parseUrl(value)?.host ?? '';
}

/** @param {unknown} value @returns {string} 日志 URL 仅保留 host；其他值使用固定占位。 */
export function maskUrl(value) {
  const url = parseUrl(value);
  return url?.host || (url ? '[system-url]' : '[invalid-url]');
}
