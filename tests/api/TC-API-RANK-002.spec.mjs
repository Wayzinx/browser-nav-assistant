// 用例：TC-API-RANK-002；F-RANK-01 AC2；limit 截断，total 为截断前数量
import { test, expect, samplePayload } from '../fixtures/api.mjs';

const TOP3 = [
  'https://github.com/org/repo/issues/123',
  'https://github.com/org/repo/pull/456',
  'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API',
];

test('TC-API-RANK-002 limit=3 只返回前 3 名且 total 仍为 10', async ({ api }) => {
  const T = Date.now();
  await test.step('S1：POST /api/sync 导入平移后的样例', () => api.seed(samplePayload({ now: T })));

  const r = await test.step('S2：GET /api/pages/ranked?limit=3&now=T', () =>
    api.get('/api/pages/ranked', { params: { limit: 3, now: T } }));

  expect(r.status, '[E1] 返回 200').toBe(200);
  expect(r.body.pages, '[E1] pages 只有 3 条').toHaveLength(3);
  expect(r.body.total, '[E1] total 为 limit 截断前的 10').toBe(10);
  expect(r.body.pages.map((p) => p.url), '[E2] 前 3 名 url 依次为 issues/123、pull/456、Fetch_API').toEqual(TOP3);
  expect(r.body.pages.map((p) => p.score), '[E2] score 依次为 1.00/0.94/0.83').toEqual([1, 0.94, 0.83]);
});
