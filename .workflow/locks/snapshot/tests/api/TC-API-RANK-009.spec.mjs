// 用例：TC-API-RANK-009；契约 v1.1.0 domains：按页面数降序、同数按字母序，不受过滤影响
import { test, expect, samplePayload } from '../fixtures/api.mjs';

const DOMAINS = ['github.com', 'react.dev', 'developer.mozilla.org', 'docs.internal.com', 'google.com'];

test('TC-API-RANK-009 domains 去重排序且不受 domain/openOnly/limit 过滤影响', async ({ api }) => {
  const T = Date.now();
  await test.step('S1：POST /api/sync 导入平移后的样例', () => api.seed(samplePayload({ now: T })));

  const all = await test.step('S2：GET /api/pages/ranked?now=T', () => api.get('/api/pages/ranked', { params: { now: T } }));
  expect(all.status, '[E1] 返回 200').toBe(200);
  expect(all.body.domains, '[E1] domains 按页面数降序、同数字母序').toEqual(DOMAINS);

  const f = await test.step('S3：GET /api/pages/ranked?domain=react.dev&openOnly=true&limit=1&now=T', () =>
    api.get('/api/pages/ranked', { params: { domain: 'react.dev', openOnly: 'true', limit: 1, now: T } }));
  expect(f.status, '[E2] 返回 200').toBe(200);
  expect(f.body.pages, '[E2] react.dev 两个页面都未打开，pages 为空').toEqual([]);
  expect(f.body.total, '[E2] total=0').toBe(0);
  expect(f.body.domains, '[E2] domains 不受过滤影响，仍为 5 个域名').toEqual(DOMAINS);

  expect(all.body.generatedAt, '[E3] S2 generatedAt 等于 T').toBe(T);
  expect(f.body.generatedAt, '[E3] S3 generatedAt 等于 T').toBe(T);
});
