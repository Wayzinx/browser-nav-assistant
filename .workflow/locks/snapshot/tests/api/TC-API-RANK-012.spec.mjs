// 用例：TC-API-RANK-012；F-RANK-02 AC2；issues/100 的评分明细
import { test, expect, samplePayload } from '../fixtures/api.mjs';

const OLD = 'https://github.com/org/repo/issues/100';

test('TC-API-RANK-012 issues/100 的 scoreDetail 各分量', async ({ api }) => {
  const T = Date.now();
  await test.step('S1：POST /api/sync 导入平移后的样例', () => api.seed(samplePayload({ now: T })));

  const r = await test.step('S2：GET /api/pages/ranked?limit=500&now=T，取 issues/100', () =>
    api.get('/api/pages/ranked', { params: { limit: 500, now: T } }));
  expect(r.status, '[E1] 返回 200').toBe(200);
  const d = r.body.pages.find((p) => p.url === OLD).scoreDetail;
  expect(d.recency, '[E1] recency=0.09').toBe(0.09);
  expect(d.frequency, '[E2] frequency=0.32').toBe(0.32);
  expect(d.open, '[E2] open=0').toBe(0);
  expect(d.domain, '[E2] domain=1.00').toBe(1);
  expect(d.domainSource, '[E3] domainSource=affinity').toBe('affinity');
});
