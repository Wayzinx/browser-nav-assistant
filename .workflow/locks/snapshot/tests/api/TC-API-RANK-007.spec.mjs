// 用例：TC-API-RANK-007；非法查询参数统一 400 VALIDATION_FAILED，且没有副作用
import { test, expect, samplePayload } from '../fixtures/api.mjs';

const BAD_LIMITS = ['0', '501', '-1', '1.5', 'abc'];

test('TC-API-RANK-007 非法查询参数返回 400 VALIDATION_FAILED 且无副作用', async ({ api }) => {
  const T = Date.now();
  await test.step('S1：POST /api/sync 导入平移后的样例', () => api.seed(samplePayload({ now: T })));

  await test.step('S2：依次请求 limit=0/501/-1/1.5/abc（都带 now=T）', async () => {
    for (const limit of BAD_LIMITS) {
      const r = await api.get('/api/pages/ranked', { params: { limit, now: T } });
      expect(r.status, `[E1] limit=${limit} 返回 400`).toBe(400);
      expect(r.body.error.code, `[E1] limit=${limit} 错误码为 VALIDATION_FAILED`).toBe('VALIDATION_FAILED');
      expect(r.body.error.message, `[E1] limit=${limit} message 非空`).toMatch(/\S/);
      expect(r.body.error.details.fields, `[E1] limit=${limit} details.fields 包含 limit`).toContain('limit');
    }
  });

  await test.step('S3：GET /api/pages/ranked?openOnly=yes&now=T', async () => {
    const r = await api.get('/api/pages/ranked', { params: { openOnly: 'yes', now: T } });
    expect(r.status, '[E2] openOnly=yes 返回 400').toBe(400);
    expect(r.body.error.code, '[E2] 错误码为 VALIDATION_FAILED').toBe('VALIDATION_FAILED');
    expect(r.body.error.details.fields, '[E2] details.fields 包含 openOnly').toContain('openOnly');
  });

  await test.step('S4：GET /api/pages/ranked?limit=10&now=abc', async () => {
    const r = await api.get('/api/pages/ranked', { params: { limit: 10, now: 'abc' } });
    expect(r.status, '[E3] now=abc 返回 400').toBe(400);
    expect(r.body.error.code, '[E3] 错误码为 VALIDATION_FAILED').toBe('VALIDATION_FAILED');
    expect(r.body.error.details.fields, '[E3] details.fields 包含 now').toContain('now');
  });

  await test.step('S5：GET /api/pages/ranked?now=T；GET /api/health', async () => {
    const r = await api.get('/api/pages/ranked', { params: { now: T } });
    expect(r.status, '[E4] 合法请求仍返回 200').toBe(200);
    expect(r.body.total, '[E4] total 仍为 10').toBe(10);
    const h = await api.get('/api/health');
    expect(h.body.pageCount, '[E4] health.pageCount 仍为 10（非法请求无副作用）').toBe(10);
  });
});
