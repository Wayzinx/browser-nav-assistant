import { LIMITS } from '../config.js';
import { now } from '../lib/clock.js';
import { readJsonBody, sendJson } from '../lib/http.js';
import { createValidator } from '../lib/validate.js';
import { syncContext } from '../services/sync-service.js';

// @code C-BE-SYNC-01
/**
 * 整个请求结构校验通过后才进入 service；单条坏记录由清洗层拒收。
 * @param {unknown} body 已解析的 JSON 值
 * @returns {{activeTab:object|null,openTabs:unknown[],history:unknown[],mode:string,clientVersion?:string,cursor?:number}} 白名单上下文
 */
export function parseSyncBody(body) {
  const validator = createValidator(body);
  const rawActiveTab = validator.value('activeTab');
  if (rawActiveTab !== undefined && rawActiveTab !== null &&
      (typeof rawActiveTab !== 'object' || Array.isArray(rawActiveTab))) {
    validator.invalid('activeTab');
  }
  const openTabs = validator.readArray('openTabs', { defaultValue: [], max: LIMITS.maxItemsPerSync });
  const history = validator.readArray('history', { defaultValue: [], max: LIMITS.maxItemsPerSync });
  const mode = validator.readEnum('mode', { defaultValue: 'full', values: ['full', 'incremental'] });
  const clientVersion = validator.readString('clientVersion');
  const cursor = validator.value('cursor');
  if (cursor !== undefined && (typeof cursor !== 'number' || !Number.isFinite(cursor))) {
    validator.invalid('cursor');
  }
  validator.assertValid();
  return { activeTab: rawActiveTab ?? null, openTabs, history, mode, clientVersion, cursor };
}

async function handleSync(req, res, { reqId }) {
  const input = parseSyncBody(await readJsonBody(req));
  sendJson(res, 200, syncContext(input, { now: now(), reqId }));
}

/** @type {{method:string,path:string,handler:Function}[]} 同步路由使用统一 JSON 读取和响应工具。 */
export const syncRoutes = [
  { method: 'POST', path: '/api/sync', handler: handleSync },
];
