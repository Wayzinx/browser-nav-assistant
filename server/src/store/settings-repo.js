import { bumpConfigVersion, readSettings, writeSettings } from './state.js';

// @code C-BE-CORE-12
/** @returns {object} 当前配置深副本，默认值与配置覆盖不共享引用。 */
export function getSettings() { return readSettings(); }

/** @param {object} patch 路由已校验的配置字段 @returns {object} 更新后的完整配置。 */
export function patchSettings(patch) {
  const settings = writeSettings(patch);
  bumpConfigVersion();
  return settings;
}
