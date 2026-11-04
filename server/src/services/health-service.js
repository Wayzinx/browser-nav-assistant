import { APP_VERSION, loadConfig } from '../config.js';
import { now } from '../lib/clock.js';
import { countPages } from '../store/page-repo.js';
import { countRules, listRules } from '../store/rule-repo.js';
import { getLastSync } from '../store/state.js';

// @code C-BE-CORE-15
const DEFAULT_STARTED_AT = now();

// @code C-BE-DIAG-01
/** @param {{config?:object,startedAt?:number}} [context] 启动上下文 @returns {object} 完整健康检查 DTO，独立于业务模块实现。 */
export function getHealth({ config = loadConfig(), startedAt = DEFAULT_STARTED_AT } = {}) {
  return {
    status: 'ok',
    version: APP_VERSION,
    uptime: Math.max(0, Math.floor((now() - startedAt) / 1000)),
    pageCount: countPages(),
    ruleCount: countRules(),
    enabledRuleCount: listRules().filter((rule) => rule.enabled).length,
    lastSyncAt: getLastSync()?.syncedAt ?? null,
    persistence: config.snapshotFile ? 'snapshot' : 'memory',
    startedAt,
  };
}
