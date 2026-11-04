// 用例：TC-API-RANK-005；F-RANK-01 AC5；空库
import { test, expect } from '../fixtures/api.mjs';

test('TC-API-RANK-005 后端数据为空时 ranked 返回空列表', async ({ api }) => {
  const h = await test.step('S1：GET /api/health', () => api.get('/api/health'));
  expect(h.status, '[E1] health 返回 200').toBe(200);
  expect(h.body.pageCount, '[E1] pageCount=0').toBe(0);

  const r = await test.step('S2：GET /api/pages/ranked', () => api.get('/api/pages/ranked'));
  expect(r.status, '[E2] ranked 返回 200').toBe(200);
  expect(r.body.pages, '[E2] pages 深等于 []').toEqual([]);
  expect(r.body.total, '[E2] total=0').toBe(0);
  expect(r.body.domains, '[E2] domains 深等于 []').toEqual([]);
  expect(Number.isInteger(r.body.generatedAt), '[E3] generatedAt 为整数毫秒').toBe(true);
  expect(r.body.generatedAt, '[E3] generatedAt 为正数').toBeGreaterThan(0);
});
