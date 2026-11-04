import { MSG } from '../../shared/messages.js';
import { runSync, isSyncInFlight } from '../services/sync.js';
import { loadSyncState } from '../services/sync-state.js';

// @code C-FE-SYNC-02
export const handlers = {
  /**
   * 先记录是否加入已有任务；异常由 CORE 路由统一转换成消息失败信封。
   * @param {{mode?: 'auto'|'full', trigger?: 'user'|'auto'}} [payload={}] 同步入口参数。
   * @returns {Promise<{syncState: Object, result: Object|null, alreadyRunning: boolean, fullReason: string|null}>} 同步结果。
   */
  async [MSG.SYNC_NOW](payload = {}) {
    const joined = isSyncInFlight();
    const result = await runSync({ mode: payload.mode ?? 'auto', trigger: payload.trigger ?? 'user' });
    if (!result.ok) throw Object.assign(new Error(result.error.message), result.error);
    return { ...result.data, alreadyRunning: joined };
  },
  /**
   * 读取时恢复 SW 回收留下的中断状态，不发起同步请求。
   * @returns {Promise<{syncState: Object}>} 当前持久化同步状态。
   */
  async [MSG.GET_SYNC_STATE]() {
    return { syncState: await loadSyncState() };
  },
};
