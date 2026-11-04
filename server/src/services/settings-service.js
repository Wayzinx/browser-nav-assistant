import { normalizeKeywords } from '../domain/privacy.js';
import { patchSettings } from '../store/settings-repo.js';
import { flushSnapshotSync } from '../store/snapshot-writer.js';
import { getPublicConfig } from './config-service.js';

// @code C-BE-PRIV-03
/**
 * 路由先完成整批校验；仓储统一递增 configVersion，关键词数组按整体替换处理。
 * @param {object} patch 已校验、只含可写字段的配置补丁
 * @returns {object} 与 GET /api/config 相同的完整 ConfigDto；启用快照时返回前落盘
 */
export function updateSettings(patch) {
  const settings = { ...patch };
  if (Object.hasOwn(patch, 'privacySensitiveKeywords')) {
    settings.privacySensitiveKeywords = normalizeKeywords(patch.privacySensitiveKeywords);
  }
  patchSettings(settings);
  flushSnapshotSync();
  return getPublicConfig();
}
