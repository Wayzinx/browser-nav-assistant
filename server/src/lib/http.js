import { LIMITS } from '../config.js';
import { AppError } from './errors.js';

// @code C-BE-CORE-05
/**
 * 流式限制字节数；超限立即丢弃累计块并排空输入，保留连接写回 413。
 * 空请求体视为 {}，有内容时才要求 application/json。
 * @param {import('node:http').IncomingMessage} req 请求流
 * @param {number} [maxBytes] 最大请求体字节数
 * @returns {Promise<unknown>} JSON 值，结构校验由路由负责
 */
export function readJsonBody(req, maxBytes = LIMITS.maxBodyBytes) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    const isJson = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() === 'application/json';
    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('aborted', onAborted);
    };
    const fail = (error) => {
      chunks = [];
      cleanup();
      req.resume();
      reject(error);
    };
    const onData = (chunk) => {
      size += chunk.length;
      if (size > maxBytes) return fail(new AppError('PAYLOAD_TOO_LARGE', 413, '请求体超过 1 MB 上限'));
      if (!isJson) return fail(new AppError('UNSUPPORTED_MEDIA_TYPE', 415, 'Content-Type 必须是 application/json'));
      chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      if (!size) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks, size).toString('utf8')));
      } catch {
        // 不把原文或解析错误附入响应，避免回显敏感字段。
        reject(new AppError('INVALID_JSON', 400, '请求体不是合法 JSON'));
      }
      chunks = [];
    };
    const onAborted = () => fail(new AppError('INVALID_JSON', 400, '请求体未完整接收'));
    req.on('data', onData);
    req.once('end', onEnd);
    req.once('aborted', onAborted);
    req.once('error', fail);
    if (Number(req.headers['content-length']) > maxBytes) {
      fail(new AppError('PAYLOAD_TOO_LARGE', 413, '请求体超过 1 MB 上限'));
    }
  });
}

/**
 * @param {import('node:http').ServerResponse} res 响应流
 * @param {number} status 状态码，204 不发送响应体
 * @param {unknown} [body] JSON 响应数据
 * @param {Record<string,string>} [headers] 额外响应头
 * @returns {void}
 */
export function sendJson(res, status, body, headers = {}) {
  if (res.writableEnded || res.destroyed) return;
  const data = status === 204 ? '' : JSON.stringify(body ?? null);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    ...(status === 204 ? {} : { 'content-length': Buffer.byteLength(data) }),
    ...headers,
  });
  res.end(data);
}

/**
 * @param {import('node:http').ServerResponse} res 响应流
 * @param {number} status HTTP 状态码
 * @param {string} code 已登记错误码
 * @param {string} message 中文错误说明
 * @param {object} [details] 可选错误详情
 * @returns {void}
 */
export function sendError(res, status, code, message, details) {
  const error = { code, message };
  if (details !== undefined) error.details = details;
  sendJson(res, status, { error });
}
