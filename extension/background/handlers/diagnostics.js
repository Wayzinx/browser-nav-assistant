import { MSG } from '../../shared/messages.js';
import { DEFAULTS } from '../../shared/constants.js';
import { runDiagnostics } from '../services/diagnostics.js';
import { checkBackend } from '../services/diag-checks-backend.js';
import { buildReport } from '../services/diag-report.js';

// @code C-FE-DIAG-09
/** 诊断消息处理器；业务异常统一交给 CORE 转换为响应信封。 */
export const handlers = {
  /** @param {object} [payload={}] @param {object} [sender={}] @returns {Promise<object>} 完整诊断快照。 */
  async [MSG.RUN_DIAGNOSTICS](payload = {}, sender = {}) {
    return runDiagnostics();
  },
  /** @param {{timeoutMs?:number}} [payload={}] @param {object} [sender={}] @returns {Promise<object>} 单次轻量连通检查。 */
  async [MSG.CHECK_CONNECTION](payload = {}, sender = {}) {
    const timeoutMs = Number.isFinite(payload.timeoutMs) && payload.timeoutMs > 0
      ? payload.timeoutMs : DEFAULTS.CONNECTION_TIMEOUT_MS;
    const result = await checkBackend({ timeoutMs });
    return { connected: result.status === 'ok', latencyMs: result.latencyMs,
      version: result.health?.version ?? null, error: result.error ?? null };
  },
  /** @param {object} [payload={}] @param {object} [sender={}] @returns {Promise<{report:object,text:string}>} 脱敏报告与对应 JSON。 */
  async [MSG.GET_DIAG_REPORT](payload = {}, sender = {}) {
    const report = await buildReport();
    return { report, text: JSON.stringify(report, null, 2) };
  },
};
