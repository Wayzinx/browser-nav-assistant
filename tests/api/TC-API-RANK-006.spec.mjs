// 用例：TC-API-RANK-006；limit 边界 1 与 500（契约：1–500 的整数）
import { test, expect, samplePayload } from '../fixtures/api.mjs';

test('TC-API-RANK-006 limit 边界 1 与 500', async ({ api }) => {
  const T = Date.now();
  await test.step('S1：POST /api/sync 导入平移后的样例', () => api.seed(samplePayload({ now: T })));

  await test.step('S2：GET /api/pages/ranked?limit=1&now=T', async () => {
    const r = await api.get('/api/pages/ranked', { params: { limit: 1, now: T } });
    expect(r.status, '[E1] limit=1 返回 200').toBe(200);
    expect(r.body.pages, '[E1] 只返回 1 条').toHaveLength(1);
    expect(r.body.pages[0].url, '[E1] 第 1 名为 issues/123').toBe('https://github.com/org/repo/issues/123');
    expect(r.body.total, '[E1] total=10').toBe(10);
  });

  await test.step('S3：GET /api/pages/ranked?limit=500&now=T', async () => {
    const r = await api.get('/api/pages/ranked', { params: { limit: 500, now: T } });
    expect(r.status, '[E2] limit=500 返回 200').toBe(200);
    expect(r.body.pages, '[E2] 返回全部 10 条').toHaveLength(10);
    expect(r.body.total, '[E2] total=10').toBe(10);
  });
});
