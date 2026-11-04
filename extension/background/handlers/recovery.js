import { MSG } from '../../shared/messages.js';
import { maybeAutoResync } from '../services/recovery.js';

// @code C-FE-CACHE-03
export const handlers = {
  /**
   * 返回恢复结果，由 CORE 包装消息信封及异常。
   * @param {Object} [payload={}]
   * @param {Object} [sender={}] Chrome 消息发送方。
   * @returns {Promise<{resynced: boolean, reason: string}>}
   */
  async [MSG.RECOVER_IF_NEEDED](payload = {}, sender = {}) {
    return maybeAutoResync();
  },
};
