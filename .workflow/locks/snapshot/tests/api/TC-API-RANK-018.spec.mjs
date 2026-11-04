// 用例：TC-API-RANK-018；F-RANK-03 AC3；D-23：最多 3 句，用「，」连接
import { test, expect, samplePayload } from '../fixtures/api.mjs';

const SEP = '，';

test('TC-API-RANK-018 全部理由非空且不超过 3 句', async ({ api }) => {
  const T = Date.now();
  await test.step('S1：POST /api/sync 导入平移后的样例', () => api.seed(samplePayload({ now: T })));

  const r = await test.step('S2：GET /api/pages/ranked?limit=500&now=T', () =>
    api.get('/api/pages/ranked', { params: { limit: 500, now: T } }));
  expect(r.body.pages, '[E1] 共 10 个页面').toHaveLength(10);

  for (const p of r.body.pages) {
    expect(typeof p.reason, `[E1] ${p.url} reason 为字符串`).toBe('string');
    expect(p.reason.trim().length, `[E1] ${p.url} reason trim 后长度 ≥ 4`).toBeGreaterThanOrEqual(4);
    const n = p.reason.split(SEP).length;
    expect(n, `[E2] ${p.url} 至少 1 句`).toBeGreaterThanOrEqual(1);
    expect(n, `[E2] ${p.url} 不超过 3 句`).toBeLessThanOrEqual(3);
  }

  const count = Object.fromEntries(r.body.pages.map((p) => [p.url, p.reason.split(SEP).length]));
  expect(count['https://github.com/org/repo/issues/123'], '[E3] issues/123 恰好 3 句').toBe(3);
  expect(count['https://github.com/org/repo/pull/456'], '[E3] pull/456 恰好 3 句').toBe(3);
  expect(count['https://www.google.com/search?q=chrome+extension+manifest+v3'], '[E3] Google 搜索页恰好 1 句').toBe(1);
});
