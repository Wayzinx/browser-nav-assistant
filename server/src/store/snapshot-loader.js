import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DEFAULT_SETTINGS } from '../config.js';
import { normalizeUrl } from '../domain/url.js';
import { log } from '../lib/logger.js';

// @code C-BE-PERSIST-02
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isTimestamp(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isStrings(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isPage(page) {
  return isRecord(page) && /^page_[1-9]\d*$/.test(page.id) &&
    typeof page.url === 'string' && typeof page.normalizedUrl === 'string' &&
    normalizeUrl(page.url) === page.normalizedUrl && Boolean(page.normalizedUrl) &&
    typeof page.title === 'string' && Number.isSafeInteger(page.visitCount) && page.visitCount >= 1 &&
    ['lastVisitedAt', 'firstSeenAt', 'updatedAt'].every((key) => isTimestamp(page[key])) &&
    ['isOpen', 'isActive', 'isArchived', 'isImportant'].every((key) => typeof page[key] === 'boolean') &&
    isStrings(page.sources) && (page.archivedAt === null || isTimestamp(page.archivedAt)) &&
    (page.mergedInto === null || (typeof page.mergedInto === 'string' && Boolean(normalizeUrl(page.mergedInto))));
}

function isRule(rule) {
  return isRecord(rule) && /^rule_[1-9]\d*$/.test(rule.id) &&
    typeof rule.rawText === 'string' && typeof rule.type === 'string' && typeof rule.action === 'string' &&
    typeof rule.enabled === 'boolean' && ['high', 'medium'].includes(rule.confidence) &&
    ['domain', 'urlPattern'].every((key) => rule[key] === null || typeof rule[key] === 'string') &&
    (rule.inactiveDays === null || (Number.isSafeInteger(rule.inactiveDays) && rule.inactiveDays > 0)) &&
    (rule.keywords === undefined || isStrings(rule.keywords)) &&
    ['trigger', 'target'].every((key) => rule[key] === undefined || isRecord(rule[key])) &&
    isTimestamp(rule.createdAt) && isTimestamp(rule.updatedAt);
}

function isSettings(settings) {
  return isRecord(settings) && Object.keys(DEFAULT_SETTINGS).every((key) => {
    const value = settings[key];
    if (Array.isArray(DEFAULT_SETTINGS[key])) return isStrings(value);
    if (typeof DEFAULT_SETTINGS[key] === 'number') return Number.isSafeInteger(value) && value > 0;
    return typeof value === typeof DEFAULT_SETTINGS[key];
  });
}

function isSnapshot(snapshot) {
  if (!isRecord(snapshot) || snapshot.schemaVersion !== 1 || !isTimestamp(snapshot.savedAt) ||
      !Array.isArray(snapshot.pages) || !snapshot.pages.every(isPage) ||
      !Array.isArray(snapshot.rules) || !snapshot.rules.every(isRule) || !isSettings(snapshot.settings) ||
      !isRecord(snapshot.seq) || !['page', 'rule', 'sync'].every((key) => isTimestamp(snapshot.seq[key])) ||
      !(snapshot.lastSyncAt === null || isTimestamp(snapshot.lastSyncAt))) return false;
  // 序号必须覆盖已有 ID，避免重启后新记录与已恢复记录使用相同 ID。
  return snapshot.pages.every((page) => Number(page.id.slice(5)) <= snapshot.seq.page) &&
    snapshot.rules.every((rule) => Number(rule.id.slice(5)) <= snapshot.seq.rule) &&
    new Set(snapshot.pages.map((page) => page.id)).size === snapshot.pages.length &&
    new Set(snapshot.pages.map((page) => page.normalizedUrl)).size === snapshot.pages.length &&
    new Set(snapshot.rules.map((rule) => rule.id)).size === snapshot.rules.length;
}

function removeTemporarySnapshots(file) {
  try {
    const folder = dirname(file);
    const prefix = `${basename(file)}.`;
    for (const name of readdirSync(folder)) {
      // 只清理当前快照对应的临时文件，其他文件由其所属模块处理。
      if (!name.startsWith(prefix) || !name.endsWith('.tmp')) continue;
      try { rmSync(join(folder, name), { force: true }); }
      catch (error) { log('warn', 'snapshot_tmp_cleanup_failed', { code: error.code }); }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') log('warn', 'snapshot_tmp_cleanup_failed', { code: error.code });
  }
}

/**
 * 只加载正式文件；损坏 JSON、结构或未知版本都返回失败，入口随后以空状态启动。
 * @param {string} file 正式快照路径
 * @returns {{ok:boolean,data?:object,reason?:string}} 永不返回 null，也不把快照内容写入日志
 */
export function loadSnapshot(file) {
  removeTemporarySnapshots(file);
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (!isSnapshot(data)) {
      log('warn', 'snapshot_load_failed', { reason: 'INVALID_SCHEMA' });
      return { ok: false, reason: 'INVALID_SCHEMA' };
    }
    return { ok: true, data };
  } catch (error) {
    const reason = error.code === 'ENOENT' ? 'NOT_FOUND' : error instanceof SyntaxError ? 'INVALID_JSON' : 'READ_FAILED';
    if (reason !== 'NOT_FOUND') log('warn', 'snapshot_load_failed', { reason, code: error.code });
    return { ok: false, reason };
  }
}
