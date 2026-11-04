import { LIMITS } from '../config.js';
import { AppError } from './errors.js';

// @code C-BE-CORE-08
/**
 * 字段仅通过 read* 白名单读出；先累积字段错误，最后 assertValid 一次报告。
 * @param {object|URLSearchParams} [input] 已解析的请求体或查询参数
 * @returns {object} 支持 readArray/readString/readInt/readBool/readEnum/assertValid 的校验器
 */
export function createValidator(input = {}) {
  const fields = [];
  const validator = {
    value(key) {
      if (input instanceof URLSearchParams) return input.has(key) ? input.get(key) : undefined;
      return input && Object.hasOwn(input, key) ? input[key] : undefined;
    },
    invalid(key) { if (!fields.includes(key)) fields.push(key); },
    assertValid() {
      if (fields.length) throw new AppError('VALIDATION_FAILED', 400, '请求字段类型或取值不合法', { fields: [...fields] });
    },
  };
  if (!input || typeof input !== 'object' || Array.isArray(input)) validator.invalid('body');
  for (const [name, read] of Object.entries({ readArray, readString, readInt, readBool, readEnum })) {
    validator[name] = (key, options) => read(validator, key, options);
  }
  return validator;
}

function readValue(validator, key, options) {
  const value = validator.value(key);
  if (value === undefined) {
    if (options.required) validator.invalid(key);
    return { missing: true, value: options.defaultValue };
  }
  if (value === null && options.nullable) return { missing: true, value: null };
  return { missing: false, value };
}

/** @param {object} validator 校验器 @param {string} key 白名单字段 @param {object} [options] required/defaultValue/min/max @returns {Array|undefined} 数组副本。 */
export function readArray(validator, key, options = {}) {
  const { missing, value } = readValue(validator, key, options);
  if (missing) return value;
  if (!Array.isArray(value)) { validator.invalid(key); return undefined; }
  const max = options.max ?? LIMITS.maxArrayItems;
  if (value.length > max) throw new AppError('PAYLOAD_TOO_LARGE', 413, `${key} 数组超过上限`, { limit: max });
  if (value.length < (options.min ?? 0)) validator.invalid(key);
  return structuredClone(value);
}

/** @param {object} validator 校验器 @param {string} key 白名单字段 @param {object} [options] required/defaultValue/min/max/trim/truncate @returns {string|undefined} 字符串。 */
export function readString(validator, key, options = {}) {
  const { missing, value } = readValue(validator, key, options);
  if (missing) return value;
  if (typeof value !== 'string') { validator.invalid(key); return undefined; }
  const text = options.trim ? value.trim() : value;
  if (text.length < (options.min ?? 0)) validator.invalid(key);
  if (options.max !== undefined && text.length > options.max) {
    if (options.truncate) return text.slice(0, options.max);
    validator.invalid(key);
  }
  return text;
}

/** @param {object} validator 校验器 @param {string} key 白名单字段 @param {object} [options] required/defaultValue/min/max/coerce @returns {number|undefined} 安全整数。 */
export function readInt(validator, key, options = {}) {
  const { missing, value } = readValue(validator, key, options);
  if (missing) return value;
  const number = options.coerce && typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(number) || number < (options.min ?? -Infinity) || number > (options.max ?? Infinity)) {
    validator.invalid(key);
    return undefined;
  }
  return number;
}

/** @param {object} validator 校验器 @param {string} key 白名单字段 @param {object} [options] required/defaultValue/coerce @returns {boolean|undefined} 布尔值。 */
export function readBool(validator, key, options = {}) {
  const { missing, value } = readValue(validator, key, options);
  if (missing) return value;
  const boolean = options.coerce && ['true', 'false'].includes(value) ? value === 'true' : value;
  if (typeof boolean !== 'boolean') { validator.invalid(key); return undefined; }
  return boolean;
}

/** @param {object} validator 校验器 @param {string} key 白名单字段 @param {object} [options] required/defaultValue/values @returns {unknown} 枚举项。 */
export function readEnum(validator, key, options = {}) {
  const { missing, value } = readValue(validator, key, options);
  if (missing) return value;
  if (!options.values?.includes(value)) { validator.invalid(key); return undefined; }
  return value;
}
