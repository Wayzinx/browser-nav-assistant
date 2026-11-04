// 来源：docs/trace/cases-api.json TC-API-DIAG-006（F-DIAG-09#AC1；C-BE-DIAG-01, C-BE-CORE-03）
import { test, expect } from '../fixtures/api.mjs';

test('TC-API-DIAG-006 POST / DELETE /api/health 返回 405 METHOD_NOT_ALLOWED，Allow 头含 GET，且不影响数据', async ({ api }) => {
  await test.step('S1：POST /api/health，请求体 {}', async () => {
    const r = await api.post('/api/health', {});
    expect(r.status, '[E1] POST 返回 405').toBe(405);
    expect(r.body.error.code, '[E1] error.code=METHOD_NOT_ALLOWED').toBe('METHOD_NOT_ALLOWED');
    expect(r.body.error.message, '[E1] error.message 非空').toMatch(/\S/);
    expect(r.headers.allow, '[E2] Allow 头包含 GET').toMatch(/\bGET\b/);
  });

  await test.step('S2：DELETE /api/health', async () => {
    const r = await api.del('/api/health');
    expect(r.status, '[E3] DELETE 返回 405').toBe(405);
    expect(r.body.error.code, '[E3] error.code=METHOD_NOT_ALLOWED').toBe('METHOD_NOT_ALLOWED');
  });

  await test.step('S3：GET /api/health', async () => {
    const r = await api.get('/api/health');
    expect(r.status, '[E4] GET 返回 200').toBe(200);
    expect(r.body, '[E4] 错误请求没有副作用').toMatchObject({ status: 'ok', pageCount: 0, ruleCount: 0 });
  });
});
