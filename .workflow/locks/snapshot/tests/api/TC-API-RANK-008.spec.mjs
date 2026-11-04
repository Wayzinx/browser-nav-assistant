// 用例：TC-API-RANK-008；契约 common.errorCodes：路径存在但方法不支持 → 405 METHOD_NOT_ALLOWED（带 Allow 头）
import { test, expect, samplePayload } from '../fixtures/api.mjs';

test('TC-API-RANK-008 POST ranked 返回 405 且带 Allow 头，随后 GET 仍正常', async ({ api }) => {
  const T = Date.now();
  await test.step('S1：POST /api/sync 导入平移后的样例', () => api.seed(samplePayload({ now: T })));

  const r = await test.step('S2：POST /api/pages/ranked，请求体 {}', () => api.post('/api/pages/ranked', {}));
  expect(r.status, '[E1] 返回 405').toBe(405);
  expect(r.body.error.code, '[E1] 错误码为 METHOD_NOT_ALLOWED').toBe('METHOD_NOT_ALLOWED');
  expect(r.body.error.message, '[E1] message 非空').toMatch(/\S/);
  expect(r.headers.allow, '[E2] Allow 头包含 GET').toContain('GET');

  const g = await test.step('S3：GET /api/pages/ranked?now=T', () => api.get('/api/pages/ranked', { params: { now: T } }));
  expect(g.status, '[E3] GET 返回 200').toBe(200);
  expect(g.body.total, '[E3] total=10').toBe(10);
  expect(g.body.pages, '[E3] pages 共 10 条').toHaveLength(10);
});
