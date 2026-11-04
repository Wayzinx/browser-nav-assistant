import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { normalizeKeywords } from '../domain/privacy.js';
import { readJsonBody, sendJson } from '../lib/http.js';
import { countPages, listPages } from '../store/page-repo.js';
import { countRules, listRules } from '../store/rule-repo.js';
import { getSettings } from '../store/settings-repo.js';
import { getLastSync, getSequences, getVersions, listSyncLogs, resetState } from '../store/state.js';

/** 页面数超过该值时只返回摘要与 hash，避免测试证据体积失控。 */
const STATE_PAGE_LIMIT = 2000;
/** 状态快照只暴露对比数据变化所需的字段；score 是排序服务的派生值，读取它可能触发缓存重建，因此不返回。 */
const STATE_PAGE_FIELDS = ['id', 'url', 'normalizedUrl', 'domain', 'title', 'visitCount', 'lastVisitedAt', 'firstSeenAt',
  'sources', 'isOpen', 'isActive', 'isArchived', 'archivedAt', 'mergedInto', 'isImportant'];

// @code C-BE-CORE-14
/** @returns {void} 仅委派给状态仓储，业务模块自行经 onReset 订阅清理。 */
export function resetAll() { resetState(); }

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** 与日志一致：命中敏感关键词的 URL 只保留 host，其余字符串原样返回（BE-RUN-07）。 */
function maskSensitive(value, keywords) {
  if (typeof value === 'string') {
    return value.replace(/https?:\/\/[^\s"'<>]+/gi, (raw) => {
      const lower = raw.toLowerCase();
      if (!keywords.some((keyword) => lower.includes(keyword))) return raw;
      try { return `${new URL(raw).host}/***`; } catch { /* 无法解析的 URL 整体打码 */ return '***'; }
    });
  }
  if (Array.isArray(value)) return value.map((item) => maskSensitive(item, keywords));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskSensitive(v, keywords)]));
  return value;
}

/** @param {string|null} file 快照路径 @returns {object|null} 持久化文件的只读摘要；文件尚未写出时 exists=false。 */
function describePersist(file) {
  if (!file) return null;
  try {
    const buf = readFileSync(file);
    return { enabled: true, file, exists: true, size: buf.length, sha256: sha256(buf) };
  } catch {
    // 快照按防抖异步写出，用例结束时文件可能还不存在；这不是错误。
    return { enabled: true, file, exists: false, size: 0, sha256: null };
  }
}

// @code C-BE-CORE-14
/**
 * 测试状态快照：只读取仓储，不触发任何写入、版本变化或缓存重建（BE-RUN-07）。
 * @param {object} config 运行配置（取 snapshotFile）
 * @returns {object} { dataVersion, versions, counts, pages, pagesTruncated, pagesHash, rules, config, sequences, lastSync, persist }
 */
export function readTestState(config) {
  const settings = getSettings();
  const rules = listRules();
  const keywords = normalizeKeywords([
    ...settings.privacySensitiveKeywords,
    ...rules.filter((rule) => rule.type === 'privacy_filter').flatMap((rule) => rule.keywords || []),
  ]);
  const pages = listPages()
    .map((page) => Object.fromEntries(STATE_PAGE_FIELDS.filter((key) => Object.hasOwn(page, key)).map((key) => [key, page[key]])))
    .sort((a, b) => String(a.normalizedUrl).localeCompare(String(b.normalizedUrl)));
  const masked = maskSensitive(pages, keywords);
  const versions = getVersions();
  return {
    dataVersion: versions.data,
    versions,
    counts: { pages: countPages(), rules: countRules(), openPages: pages.filter((p) => p.isOpen).length, archivedPages: pages.filter((p) => p.isArchived).length, syncLogs: listSyncLogs().length },
    pagesTruncated: masked.length > STATE_PAGE_LIMIT,
    pagesHash: sha256(JSON.stringify(masked)),
    pages: masked.length > STATE_PAGE_LIMIT ? [] : masked,
    rules: maskSensitive(rules, keywords),
    config: settings,
    sequences: getSequences(),
    lastSync: getLastSync(),
    persist: describePersist(config?.snapshotFile ?? null),
  };
}

/** @type {{method:string,path:string,handler:Function}[]} 只有 buildRouteTable 显式启用才注册。 */
export const testApiRoutes = [
  {
    method: 'POST', path: '/api/__test__/reset',
    async handler(req, res) {
      await readJsonBody(req);
      resetAll();
      sendJson(res, 200, { ok: true });
    },
  },
  {
    method: 'GET', path: '/api/__test__/state',
    async handler(req, res, context) {
      sendJson(res, 200, readTestState(context.config));
    },
  },
];
