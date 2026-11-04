// @code C-BE-CORE-05
/** 已知错误携带契约错误码，集中由 app 转为统一 JSON。 */
export class AppError extends Error {
  /**
   * @param {string} code 契约登记的错误码
   * @param {number} status HTTP 状态码
   * @param {string} message 中文说明
   * @param {object} [details] 可选字段错误等信息
   */
  constructor(code, status, message, details) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}
