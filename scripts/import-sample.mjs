import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../server/src/config.js';
import { now } from '../server/src/lib/clock.js';

// @code C-BE-DEMO-03
// D-01：最新历史保留 5 分钟余量，全部历史使用同一偏移量。
const SAMPLE_LAG_MS = 5 * 60 * 1000;
// 两次网络请求各自限时，服务无响应时也能给出失败提示并退出。
const REQUEST_TIMEOUT_MS = 5000;

/**
 * 平移副本，保留 URL、访问次数与任意两条历史的时间间隔，不修改原样例。
 * @param {{history:object[], activeTab?:object|null, openTabs?:object[]}} sample 原始样例
 * @param {number} [timestamp] 导入基准时间，毫秒
 * @returns {object} 最新 lastVisitTime 等于 timestamp 减 5 分钟的同步请求体
 */
export function shiftSampleTimes(sample, timestamp = now()) {
  if (!Array.isArray(sample.history) || sample.history.length === 0) {
    throw new TypeError('样例 history 必须是非空数组');
  }
  if (!Number.isSafeInteger(timestamp) || sample.history.some((item) => !Number.isSafeInteger(item.lastVisitTime))) {
    throw new TypeError('样例访问时间和导入基准时间必须是整数毫秒时间戳');
  }
  const latest = Math.max(...sample.history.map((item) => item.lastVisitTime));
  const offset = timestamp - SAMPLE_LAG_MS - latest;
  const shifted = structuredClone(sample);
  for (const item of shifted.history) item.lastVisitTime += offset;
  return shifted;
}

// @code C-BE-DEMO-02
// JSON 必须与真相源完全一致，因此将数据的追溯标注放在其唯一读取入口。
async function readSample() {
  return JSON.parse(await readFile(new URL('../resources/sample-history.json', import.meta.url), 'utf8'));
}

async function requestJson(base, route, options = {}) {
  const response = await fetch(new URL(route, base), {
    ...options,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    redirect: 'error',
  });
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new Error(`${options.method ?? 'GET'} /${route} 返回 HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * 只经真实同步接口导入，再查询 health；任何请求失败都向调用者抛错。
 * @param {{apiBase?:string, now?:number}} [options] 目标服务地址与导入基准时间
 * @returns {Promise<{sync:object, health:object}>} 服务器返回的同步统计和健康信息
 */
export async function importSample({ apiBase = `http://127.0.0.1:${loadConfig().port}`, now: timestamp = now() } = {}) {
  const base = new URL(`${apiBase.replace(/\/+$/, '')}/`);
  if (!['http:', 'https:'].includes(base.protocol)) throw new TypeError('API_BASE 必须是 http(s) 地址');
  const payload = shiftSampleTimes(await readSample(), timestamp);
  const sync = await requestJson(base, 'api/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (sync?.ok !== true) throw new Error('同步接口未返回 ok=true');
  process.stdout.write(`${JSON.stringify(sync)}\n`);
  const health = await requestJson(base, 'api/health');
  if (health?.status !== 'ok') throw new Error('健康检查未返回 status=ok');
  process.stdout.write(`${JSON.stringify(health)}\n`);
  return { sync, health };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  // API_BASE 仅属于导入命令；服务端的 PORT 等配置仍由 loadConfig 读取。
  importSample({ apiBase: process.env.API_BASE || undefined }).catch((error) => {
    process.stderr.write(`样例导入失败：${error.message}。请先运行 ./scripts/start.sh，并检查 API_BASE 与 PORT。\n`);
    process.exitCode = 1;
  });
}
