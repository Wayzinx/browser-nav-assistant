// 用例：TC-API-PERF-001；F-PERF-01 AC1 / PRD 10.1：10 万页面下推荐接口 p95 < 100ms
// 数据构造与 scripts/bench-perf.mjs（C-BE-PERF-03）一致：bulkHistory(100000) 切 200 批 × 500 条导入。
import { test, expect, bulkHistory } from '../fixtures/api.mjs';

const TOTAL = 100_000;
const BATCH = 500;
const RUNS = 20;
const STRATEGIES = ['rule', 'same_repo', 'same_doc_site', 'same_domain', 'global_top'];
const BODY = { currentPage: { url: 'https://github.com/org/repo0/pull/777', title: 'PR 777' }, openTabs: [], recentHistory: [] };
const pct = (sorted, p) => sorted[Math.ceil(sorted.length * p) - 1];

test('TC-API-PERF-001 10 万页面下连续推荐 20 次 p95 < 100ms', async ({ api, evidence }) => {
  test.setTimeout(600_000);
  const T = Date.now();

  await test.step('S1：分 200 批 POST /api/sync 导入 bulkHistory(100000)，每批 500 条', async () => {
    const all = bulkHistory(TOTAL, { now: T });
    let created = 0;
    for (let i = 0; i < all.length; i += BATCH) {
      const r = await api.post('/api/sync', { activeTab: null, openTabs: [], history: all.slice(i, i + BATCH) });
      expect(r.status, `[E1] 第 ${i / BATCH + 1} 批同步返回 200`).toBe(200);
      expect(r.body.ok, `[E1] 第 ${i / BATCH + 1} 批 ok=true`).toBe(true);
      created += r.body.created;
    }
    expect(created, '[E1] created 累计为 100000').toBe(TOTAL);
  });

  await test.step('S2：GET /api/health 确认 pageCount=100000', async () => {
    const h = await api.get('/api/health');
    expect(h.status, '[E2] health 返回 200').toBe(200);
    expect(h.body.pageCount, '[E2] pageCount=100000').toBe(TOTAL);
  });

  const ms = await test.step('S3：相同请求体连续调用 POST /api/recommendations/next 共 20 次', async () => {
    const out = [];
    for (let i = 0; i < RUNS; i++) {
      const r = await api.post('/api/recommendations/next', BODY);
      out.push(r.ms);
      expect(r.status, `[E3] 第 ${i + 1} 次推荐返回 200`).toBe(200);
      const recs = r.body.recommendations;
      expect(recs.length, `[E3] 第 ${i + 1} 次推荐条数 ≤ 5`).toBeLessThanOrEqual(5);
      const scores = recs.map((x) => x.score);
      expect(scores, `[E3] 第 ${i + 1} 次推荐按 score 非严格降序`).toEqual([...scores].sort((a, b) => b - a));
      expect(Number.isInteger(r.body.generatedAt) && r.body.generatedAt > 0, `[E5] 第 ${i + 1} 次 generatedAt 为正整数毫秒`).toBe(true);
      for (const x of recs) {
        expect(x.id, `[E5] ${x.url} id 以 rec_ 开头`).toMatch(/^rec_/);
        expect(STRATEGIES, `[E5] ${x.url} strategy 合法`).toContain(x.strategy);
        expect(Math.abs(x.score * 100 - Math.round(x.score * 100)), `[E5] ${x.url} score 为 2 位小数`).toBeLessThan(1e-9);
      }
    }
    return out;
  });

  const sorted = [...ms].sort((a, b) => a - b);
  const p50 = pct(sorted, 0.5);
  const p95 = pct(sorted, 0.95);
  const max = sorted[sorted.length - 1];
  evidence.metric('recommendations.p50', p50, 'ms');
  evidence.metric('recommendations.p95', p95, 'ms');
  evidence.metric('recommendations.max', max, 'ms');
  expect(sorted, '[E6] 20 次耗时全部记录并写入 metric').toHaveLength(RUNS);
  expect(p95, '[E4] 10 万页面下推荐接口 p95 < 100ms').toBeLessThan(100);
});
