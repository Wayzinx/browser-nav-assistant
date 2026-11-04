import { now } from '../lib/clock.js';
import { nextId, onReset } from './state.js';

// @code C-BE-CORE-11
const rules = new Map();
const RULE_FIELDS = ['rawText', 'type', 'domain', 'urlPattern', 'inactiveDays', 'keywords', 'trigger', 'target', 'action', 'enabled', 'confidence', 'createdAt', 'updatedAt'];

function pickRule(input) {
  const record = {};
  for (const key of RULE_FIELDS) if (Object.hasOwn(input, key)) record[key] = structuredClone(input[key]);
  return record;
}

/** @returns {string} 正式规则 ID，删除不复用，reset 后从 1 开始。 */
export function nextRuleId() { return nextId('rule'); }
/** @param {object} input 已通过规则 schema 校验的字段 @returns {object} 正式规则的深副本。 */
export function insertRule(input) {
  const at = now();
  const record = {
    domain: null, urlPattern: null, inactiveDays: null,
    enabled: true, confidence: 'high', createdAt: at, updatedAt: at,
    ...pickRule(input), id: nextRuleId(),
  };
  rules.set(record.id, record);
  return structuredClone(record);
}
/** @returns {object[]} 按创建顺序返回规则深副本。 */
export function listRules() { return structuredClone([...rules.values()]); }
/** @param {string} id 正式规则 ID @returns {object|null} 规则深副本。 */
export function getRule(id) { const rule = rules.get(id); return rule ? structuredClone(rule) : null; }
/** @param {string} id 正式规则 ID @returns {boolean} 是否删除。 */
export function removeRule(id) { return rules.delete(id); }
/** @param {string} id 正式规则 ID @param {object} patch 已校验的规则字段 @returns {object|null} 更新后副本，保留 ID 与创建时间。 */
export function updateRule(id, patch) {
  const previous = rules.get(id);
  if (!previous) return null;
  const record = { ...previous, ...pickRule(patch), id, createdAt: previous.createdAt, updatedAt: patch.updatedAt ?? now() };
  rules.set(id, record);
  return structuredClone(record);
}
/** @returns {number} 全部规则数，含已停用规则。 */
export function countRules() { return rules.size; }
/** @returns {void} 清空规则；ID 序号由 resetState 复位。 */
export function clearRules() { rules.clear(); }
/** @param {object[]} records PERSIST 已校验的正式规则 @returns {void} 恢复创建顺序与正式 ID。 */
export function restoreRules(records) {
  clearRules();
  for (const input of records) rules.set(input.id, { ...pickRule(input), id: input.id });
}

onReset(clearRules);
