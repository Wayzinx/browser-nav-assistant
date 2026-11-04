import { DEFAULT_SETTINGS } from '../config.js';

// @code C-BE-CORE-12
/** 仅保留最近 50 次同步，避免运行日志随浏览历史增长。 */
const SYNC_LOG_CAPACITY = 50;
const versions = { data: 0, rule: 0, config: 0 };
const sequences = { page: 0, rule: 0, sync: 0 };
const resetCallbacks = new Set();
const changeCallbacks = new Set();
let settings = structuredClone(DEFAULT_SETTINGS);
let syncLogs = [];

/** @returns {{data:number,rule:number,config:number}} 版本副本，进程内永不回退。 */
export function getVersions() { return { ...versions }; }
function notifyChange() { for (const callback of changeCallbacks) callback(); }
function bump(kind) { versions[kind] += 1; notifyChange(); return versions[kind]; }
/** @returns {number} 页面版本；批量业务写入后由 service 调用一次。 */
export function bumpDataVersion() { return bump('data'); }
/** @returns {number} 规则版本。 */
export function bumpRuleVersion() { return bump('rule'); }
/** @returns {number} 配置版本。 */
export function bumpConfigVersion() { return bump('config'); }
/** @param {Function} callback 同步变更通知 @returns {Function} 取消订阅函数。 */
export function onStateChange(callback) { changeCallbacks.add(callback); return () => changeCallbacks.delete(callback); }
/** @param {Function} callback 同步重置回调，按注册顺序执行 @returns {Function} 取消订阅函数。 */
export function onReset(callback) { resetCallbacks.add(callback); return () => resetCallbacks.delete(callback); }
/** @param {'page'|'rule'|'sync'} kind ID 类型 @returns {string} 类型前缀加不复用序号。 */
export function nextId(kind) {
  if (!Object.hasOwn(sequences, kind)) throw new TypeError('未知 ID 类型');
  sequences[kind] += 1;
  return `${kind}_${sequences[kind]}`;
}
/** @returns {object} 快照序号副本。 */
export function getSequences() { return { ...sequences }; }
/** @returns {object} 配置副本；仅供 settings-repo 包装使用。 */
export function readSettings() { return structuredClone(settings); }
/** @param {object} patch 已校验的配置白名单 @returns {object} 更新后配置副本。 */
export function writeSettings(patch) {
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (Object.hasOwn(patch, key)) settings[key] = structuredClone(patch[key]);
  }
  return readSettings();
}

/** @param {object} entry 同步计数与时刻，不接收 URL @returns {object} 保存的同步日志副本。 */
export function appendSyncLog(entry) {
  const record = { id: nextId('sync') };
  for (const key of ['syncedAt', 'mode', 'received', 'created', 'updated', 'rejected', 'durationMs', 'clientVersion', 'ok']) {
    if (Object.hasOwn(entry, key)) record[key] = structuredClone(entry[key]);
  }
  if (entry.rejectedByReason) record.rejectedByReason = {
    invalid_url: entry.rejectedByReason.invalid_url ?? 0,
    privacy: entry.rejectedByReason.privacy ?? 0,
  };
  syncLogs.push(record);
  if (syncLogs.length > SYNC_LOG_CAPACITY) syncLogs.shift();
  return structuredClone(record);
}
/** @returns {object|null} 最近同步；尚未同步为 null。 */
export function getLastSync() { return syncLogs.length ? structuredClone(syncLogs.at(-1)) : null; }
/** @returns {object[]} 最近至多 50 条同步日志，按时间顺序。 */
export function listSyncLogs() { return structuredClone(syncLogs); }

/** @returns {void} 先递增版本并清基础状态，再重置仓储/缓存，最后通知持久化。 */
export function resetState() {
  for (const key of Object.keys(versions)) versions[key] += 1;
  for (const key of Object.keys(sequences)) sequences[key] = 0;
  syncLogs = [];
  settings = structuredClone(DEFAULT_SETTINGS);
  for (const callback of resetCallbacks) callback();
  notifyChange();
}

/** @param {object} snapshot PERSIST 已校验的快照元数据 @returns {void} 恢复元数据，不恢复旧缓存版本。 */
export function hydrateState(snapshot) {
  writeSettings(snapshot.settings ?? {});
  for (const key of Object.keys(sequences)) {
    const value = snapshot.seq?.[key];
    if (Number.isSafeInteger(value) && value >= 0) sequences[key] = Math.max(sequences[key], value);
  }
  syncLogs = snapshot.lastSyncAt == null ? [] : [{ id: `sync_${sequences.sync}`, syncedAt: snapshot.lastSyncAt }];
}
