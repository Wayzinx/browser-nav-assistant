#!/usr/bin/env node
// @code C-BE-PERF-03
// 性能基准（F-PERF-01）：对已启动的后端，经真实 POST /api/sync 每批 500 条导入 10 万合成页面，
// 再各调用推荐 / 排序接口 20 次，打印 p50 / p95 / max 并与阈值比较。
// 用法：node scripts/bench-perf.mjs [baseUrl]，默认 http://127.0.0.1:3000。
// 不 spawn 子进程、不直接写存储、不调用 reset；请对空的后端运行（否则导入数量校验会失败）。
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { now as clockNow } from '../server/src/lib/clock.js';
import { DAY_MS } from '../server/src/config.js';

/** 默认后端地址（契约 defaultPort 3000）。 */
const DEFAULT_BASE_URL = 'http://127.0.0.1:3000';
/** 合成页面总数与每批条数（/api/sync 单次 history 上限 500）。 */
const TOTAL_PAGES = 100_000;
const BATCH_SIZE = 500;
/** 每个接口的计时调用次数。 */
const ROUNDS = 20;
/** p95 阈值（毫秒）：推荐 < 100，排序 < 50（F-PERF-01 AC1 / AC2）。 */
const REC_P95_LIMIT_MS = 100;
const RANKED_P95_LIMIT_MS = 50;
/** 合成数据使用的站点；github.com 页面按「所有者 / 仓库 / 类型 / 编号」生成。 */
const HOSTS = ['github.com', 'developer.mozilla.org', 'react.dev', 'docs.example.net', 'example.com', 'news.example.org'];
const GITHUB_KINDS = ['pull', 'issues', 'actions', 'tree'];
const HOUR_MS = 3_600_000;

/**
 * 最近秩法百分位：升序后取第 ceil(p/100 × n) 个（20 个样本时 p50 = 第 10 个，p95 = 第 19 个）。不修改输入。
 * @param {number[]} samples 样本
 * @param {number} p 百分位（0 < p ≤ 100）
 * @returns {number} 百分位值
 */
export function percentile(samples, p) {
  if (!Array.isArray(samples) || samples.length === 0) throw new Error('percentile 需要非空样本数组');
  if (!(p > 0 && p <= 100)) throw new Error('percentile 的 p 必须在 (0, 100] 之间');
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil((p / 100) * sorted.length) - 1];
}

/**
 * 生成第 i 个合成页面：按序号轮换站点，github.com 页面分布在 10 个所有者 × 50 个仓库中。
 * @param {number} i 序号
 * @param {number} now 基准时间，毫秒
 * @returns {{url:string,title:string,lastVisitTime:number,visitCount:number}} 历史记录
 */
function buildSyntheticPage(i, now) {
  const host = HOSTS[i % HOSTS.length];
  const path = host === 'github.com'
    ? `/owner${i % 10}/project${i % 50}/${GITHUB_KINDS[i % GITHUB_KINDS.length]}/${i}`
    : `/page/${i}`;
  return {
    url: `https://${host}${path}`,
    title: `Synthetic page ${i}`,
    lastVisitTime: now - (i % 60) * DAY_MS - (i % 24) * HOUR_MS,
    visitCount: 1 + (i % 9),
  };
}

/**
 * 发一个 JSON 请求并完整读取响应；非 2xx 直接抛错。
 * @param {string} baseUrl 后端地址
 * @param {string} path 路径
 * @param {object} [body] 请求体（有则 POST）
 * @returns {Promise<{ms:number,body:object}>} 耗时（含读取响应体）与响应 JSON
 */
async function callJson(baseUrl, path, body) {
  const init = body === undefined
    ? { method: 'GET' }
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const started = performance.now();
  const res = await fetch(`${baseUrl}${path}`, init);
  const text = await res.text();
  const ms = performance.now() - started;
  if (!res.ok) throw new Error(`${init.method} ${path} 返回 ${res.status}：${text.slice(0, 200)}`);
  return { ms, body: JSON.parse(text) };
}

/**
 * 分批导入合成页面，并校验每批成功、累计新建数与 health 中的页面总数。
 * @param {string} baseUrl 后端地址
 * @param {number} now 基准时间
 * @returns {Promise<object>} 最后一个 GitHub PR 页面（用作推荐的当前页）
 */
async function importPages(baseUrl, now) {
  let created = 0;
  let prPage = null;
  for (let start = 0; start < TOTAL_PAGES; start += BATCH_SIZE) {
    const history = [];
    for (let i = start; i < Math.min(start + BATCH_SIZE, TOTAL_PAGES); i += 1) history.push(buildSyntheticPage(i, now));
    const { body } = await callJson(baseUrl, '/api/sync', { history });
    if (body.ok !== true) throw new Error(`第 ${start / BATCH_SIZE + 1} 批同步 ok 不是 true`);
    created += body.created;
    prPage = history.find((page) => page.url.includes('/pull/')) || prPage;
  }
  if (created !== TOTAL_PAGES) throw new Error(`累计新建 ${created} 条，期望 ${TOTAL_PAGES}（后端需为空库）`);
  const { body: health } = await callJson(baseUrl, '/api/health');
  if (health.pageCount !== TOTAL_PAGES) throw new Error(`health.pageCount=${health.pageCount}，期望 ${TOTAL_PAGES}`);
  return prPage;
}

/**
 * 连续调用 ROUNDS 次并校验每次响应，返回耗时统计。
 * @param {() => Promise<{ms:number,body:object}>} call 单次调用
 * @param {(body:object) => void} check 响应校验，不合格时抛错
 * @returns {Promise<{p50:number,p95:number,max:number}>} 耗时统计（毫秒）
 */
async function measure(call, check) {
  const samples = [];
  for (let round = 0; round < ROUNDS; round += 1) {
    const { ms, body } = await call();
    check(body);
    samples.push(ms);
  }
  return { p50: percentile(samples, 50), p95: percentile(samples, 95), max: Math.max(...samples) };
}

/**
 * 跑完整基准：导入 → 推荐 20 次 → 排序 20 次。
 * @param {{baseUrl?:string,now?:number}} [options] 后端地址与基准时间
 * @returns {Promise<{rec:object,ranked:object,pass:boolean}>} 两个接口的耗时统计与是否达标
 */
export async function runBench({ baseUrl = DEFAULT_BASE_URL, now = clockNow() } = {}) {
  const prPage = await importPages(baseUrl, now);
  const rec = await measure(
    () => callJson(baseUrl, '/api/recommendations/next', { currentPage: { url: prPage.url, title: prPage.title }, openTabs: [] }),
    (body) => { if (!Array.isArray(body.recommendations) || body.recommendations.length > 5) throw new Error('推荐响应格式不正确'); },
  );
  const ranked = await measure(
    () => callJson(baseUrl, '/api/pages/ranked?limit=20'),
    (body) => { if (!Array.isArray(body.pages) || body.pages.length !== 20) throw new Error('排序响应 pages 不是 20 条'); },
  );
  const pass = rec.p95 < REC_P95_LIMIT_MS && ranked.p95 < RANKED_P95_LIMIT_MS;
  return { rec, ranked, pass };
}

/**
 * 命令行入口：打印结果，不达标或出错时以非 0 退出。
 * @returns {Promise<void>}
 */
async function main() {
  const baseUrl = process.argv[2] || DEFAULT_BASE_URL;
  const fmt = (s) => `p50=${s.p50.toFixed(1)}ms p95=${s.p95.toFixed(1)}ms max=${s.max.toFixed(1)}ms`;
  try {
    const { rec, ranked, pass } = await runBench({ baseUrl });
    process.stdout.write(`POST /api/recommendations/next ${fmt(rec)}（阈值 p95 < ${REC_P95_LIMIT_MS}ms）\n`);
    process.stdout.write(`GET /api/pages/ranked?limit=20 ${fmt(ranked)}（阈值 p95 < ${RANKED_P95_LIMIT_MS}ms）\n`);
    process.stdout.write(pass ? '结果：达标\n' : '结果：未达标\n');
    process.exitCode = pass ? 0 : 1;
  } catch (error) {
    process.stderr.write(`基准失败：${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
