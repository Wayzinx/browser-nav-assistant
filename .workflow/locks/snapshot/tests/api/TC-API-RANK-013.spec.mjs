// 用例：TC-API-RANK-013；F-RANK-02 AC3；公式 D-05：score=0.4r+0.3f+0.2o+0.1d
import { test, expect, samplePayload } from '../fixtures/api.mjs';

test('TC-API-RANK-013 全部页面 score 与分量都在 [0,1] 且符合加权公式', async ({ api }) => {
  const T = Date.now();
  await test.step('S1：POST /api/sync 导入平移后的样例', () => api.seed(samplePayload({ now: T })));

  const r = await test.step('S2：GET /api/pages/ranked?limit=500&now=T，逐项校验', () =>
    api.get('/api/pages/ranked', { params: { limit: 500, now: T } }));
  expect(r.status, '[E1] 返回 200').toBe(200);
  expect(r.body.pages, '[E1] 共 10 个页面').toHaveLength(10);

  for (const p of r.body.pages) {
    const { recency, frequency, open, domain } = p.scoreDetail;
    for (const [k, v] of Object.entries({ score: p.score, recency, frequency, open, domain })) {
      expect(v, `[E2] ${p.url} ${k} ≥ 0`).toBeGreaterThanOrEqual(0);
      expect(v, `[E2] ${p.url} ${k} ≤ 1`).toBeLessThanOrEqual(1);
    }
    const expected = 0.4 * recency + 0.3 * frequency + 0.2 * open + 0.1 * domain;
    expect(Math.abs(p.score - expected), `[E3] ${p.url} score 与加权公式之差 ≤ 0.01`).toBeLessThanOrEqual(0.01 + 1e-9);
  }
});
