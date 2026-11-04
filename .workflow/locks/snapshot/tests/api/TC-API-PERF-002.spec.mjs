// 用例：TC-API-PERF-002；F-PERF-01 AC2 / PRD 10.1：10 万页面下 ranked?limit=20 p95 < 50ms
// 数据构造与 scripts/bench-perf.mjs（C-BE-PERF-03）一致：bulkHistory(100000) 切 200 批 × 500 条导入。
import { test, expect, bulkHistory } from '../fixtures/api.mjs';

const TOTAL = 100_000;
const BATCH = 500;
const RUNS = 20;
const pct = (sorted, p) => sorted[Math.ceil(sorted.length * p) - 1];

test('TC-API-PERF-002 10 万页面下连续请求 ranked 20 次 p95 < 50ms', async ({ api, evidence }) => {
  test.setTimeout(600_000);
  const T = Date.now();

  await test.step('S1：分 200 批 POST /api/sync 导入 bulkHistory(100000)，每批 500 条', async () => {
    const all = bulkHistory(TOTAL, { now: T });
    let created = 0;
    for (let i = 0; i < all.length; i += BATCH) {
      const r = await api.post('/api/sync', { activeTab: null, openTabs: [], history: all.slice(i, i + BATCH) });
      expect(r.status, `[E1] 第 ${i / BATCH + 1} 批同步返回 200`).toBe(200);
      created += r.body.created;
    }
    expect(created, '[E1] created 累计为 100000').toBe(TOTAL);
  });

  await test.step('S2：GET /api/health 确认 pageCount=100000', async () => {
    const h = await api.get('/api/health');
    expect(h.status, '[E2] health 返回 200').toBe(200);
    expect(h.body.pageCount, '[E2] pageCount=100000').toBe(TOTAL);
  });

  const ms = await test.step('S3：连续调用 GET /api/pages/ranked?limit=20 共 20 次', async () => {
    const out = [];
    for (let i = 0; i < RUNS; i++) {
      const r = await api.get('/api/pages/ranked', { params: { limit: 20 } });
      out.push(r.ms);
      expect(r.status, `[E3] 第 ${i + 1} 次返回 200`).toBe(200);
      expect(r.body.pages, `[E3] 第 ${i + 1} 次 pages 共 20 条`).toHaveLength(20);
      expect(r.body.total, `[E3] 第 ${i + 1} 次 total=100000`).toBe(TOTAL);
      const scores = r.body.pages.map((p) => p.score);
      expect(scores, `[E4] 第 ${i + 1} 次 score 非严格降序`).toEqual([...scores].sort((a, b) => b - a));
      for (const p of r.body.pages) {
        expect(p.score, `[E4] ${p.url} score ≥ 0`).toBeGreaterThanOrEqual(0);
        expect(p.score, `[E4] ${p.url} score ≤ 1`).toBeLessThanOrEqual(1);
        expect(Object.keys(p), `[E4] ${p.url} 含 url、scoreDetail、reason`).toEqual(expect.arrayContaining(['url', 'scoreDetail', 'reason']));
      }
    }
    return out;
  });

  const sorted = [...ms].sort((a, b) => a - b);
  const p50 = pct(sorted, 0.5);
  const p95 = pct(sorted, 0.95);
  const max = sorted[sorted.length - 1];
  evidence.metric('ranked.p50', p50, 'ms');
  evidence.metric('ranked.p95', p95, 'ms');
  evidence.metric('ranked.max', max, 'ms');
  expect(sorted, '[E6] 20 次耗时全部记录并写入 metric').toHaveLength(RUNS);
  expect(p95, '[E5] 10 万页面下 ranked p95 < 50ms').toBeLessThan(50);
});
