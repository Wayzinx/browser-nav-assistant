import { AppError } from './errors.js';

// @code C-BE-CORE-07
/** @returns {number} 当前真实时间，毫秒；业务层通过参数接收该值。 */
export function now() {
  return Date.now();
}

/**
 * 覆盖值必须是正整数毫秒时间戳；非法值不可悄悄回退到当前时间。
 * @param {URLSearchParams} [query] 路由查询参数
 * @returns {number} 覆盖时间或当前时间
 */
export function resolveNow(query) {
  if (!query?.has('now')) return now();
  const raw = query.get('now');
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value <= 0) {
    throw new AppError('VALIDATION_FAILED', 400, '?now= 必须是正整数毫秒时间戳', { fields: ['now'] });
  }
  return value;
}
