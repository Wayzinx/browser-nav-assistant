// 用例：TC-API-RANK-004；F-RANK-01 AC4；domain 过滤
import { test, expect, samplePayload } from '../fixtures/api.mjs';

test('TC-API-RANK-004 domain=react.dev 只返回 useState 与 learn 两个页面', async ({ api }) => {
  const T = Date.now();
  await test.step('S1：POST /api/sync 导入平移后的样例', () => api.seed(samplePayload({ now: T })));

  const r = await test.step('S2：GET /api/pages/ranked?domain=react.dev&now=T', () =>
    api.get('/api/pages/ranked', { params: { domain: 'react.dev', now: T } }));

  expect(r.status, '[E1] 返回 200').toBe(200);
  expect(r.body.total, '[E1] total=2').toBe(2);
  expect(r.body.pages, '[E1] pages 共 2 条').toHaveLength(2);
  expect(r.body.pages.map((p) => p.url), '[E2] url 依次为 useState、learn')
    .toEqual(['https://react.dev/reference/react/useState', 'https://react.dev/learn']);
  expect(r.body.pages.map((p) => p.domain), '[E2] 每项 domain=react.dev').toEqual(['react.dev', 'react.dev']);
  expect(r.body.pages.map((p) => p.score), '[E2] score 依次为 0.69/0.57').toEqual([0.69, 0.57]);
});
