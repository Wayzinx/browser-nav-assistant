// 测试数据工具：所有测试数据都通过真实的 POST /api/sync 导入（不允许直接写后端存储）。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './evidence.mjs';

export const DAY = 86_400_000;
export const HOUR = 3_600_000;
// PRD 决策 D-01：样例导入时把 resource.json 整体平移到「最新一条 = 导入时刻 − 5 分钟」。PRD 修改 D-01 时同步修改这里
export const SAMPLE_LAG_MS = 5 * 60_000;

/** 读取只读的样例数据 resource.json（每次返回新对象，可以放心修改） */
export function readResource() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'resource.json'), 'utf8'));
}

/**
 * 样例数据时间平移（PRD 决策 D-01：最新一条 lastVisitTime = now − SAMPLE_LAG_MS）。
 * 平移后各页面之间的相对天数不变，例如 issues/100 仍然比最新一条早 24.31 天。
 * @param {{ now?: number, lagMs?: number, transform?: (p: any) => any }} [opts]
 */
export function samplePayload({ now = Date.now(), lagMs = SAMPLE_LAG_MS, transform } = {}) {
  const raw = readResource();
  const latest = Math.max(...raw.history.map((h) => h.lastVisitTime));
  const shift = now - lagMs - latest;
  const payload = { ...raw, history: raw.history.map((h) => ({ ...h, lastVisitTime: h.lastVisitTime + shift })) };
  return transform ? transform(payload) : payload;
}

/** resource.json 中某个 URL 平移后的 lastVisitTime（用来算期望值，不要手写时间戳） */
export function shiftedTime(url, now, lagMs = SAMPLE_LAG_MS) {
  const raw = readResource();
  const latest = Math.max(...raw.history.map((h) => h.lastVisitTime));
  const item = raw.history.find((h) => h.url === url);
  if (!item) throw new Error(`resource.json 中没有 ${url}`);
  return item.lastVisitTime + (now - lagMs - latest);
}

export const daysAgo = (days, now = Date.now()) => now - days * DAY;

/** 构造一条 history 项 */
export const historyItem = (url, { title = url, daysAgo: d = 0, visitCount = 1, now = Date.now() } = {}) =>
  ({ url, title, lastVisitTime: now - d * DAY, visitCount });

/**
 * 生成 n 条合成历史（性能用例使用）。确定性生成，不依赖随机数，保证每次运行数据一致。
 * @param {number} n
 * @param {{ now?: number }} [opts]
 */
export function bulkHistory(n, { now = Date.now() } = {}) {
  const hosts = ['github.com', 'developer.mozilla.org', 'react.dev', 'docs.internal.com', 'example.com', 'news.example.org'];
  return Array.from({ length: n }, (_, i) => {
    const host = hosts[i % hosts.length];
    const p = host === 'github.com' ? `/org/repo${i % 50}/issues/${i}` : `/page/${i}`;
    return { url: `https://${host}${p}`, title: `Synthetic page ${i}`, lastVisitTime: now - (i % 60) * DAY - (i % 24) * HOUR, visitCount: 1 + (i % 9) };
  });
}
