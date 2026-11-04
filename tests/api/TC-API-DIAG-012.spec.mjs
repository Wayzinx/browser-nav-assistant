// 来源：docs/trace/cases-api.json TC-API-DIAG-012（F-DIAG-10#AC1；C-BE-DIAG-02, C-BE-CORE-02）
import { test, expect } from '../fixtures/api.mjs';

test('TC-API-DIAG-012 POST / DELETE /api/config 返回 405，Allow 头含 GET 和 PUT，配置保持默认值', async ({ api }) => {
  await test.step('S1：POST /api/config { cleanupThresholdDays: 3 }', async () => {
    const r = await api.post('/api/config', { cleanupThresholdDays: 3 });
    expect(r.status, '[E1] POST 返回 405').toBe(405);
    expect(r.body.error.code, '[E1] error.code=METHOD_NOT_ALLOWED').toBe('METHOD_NOT_ALLOWED');
    expect(r.body.error.message, '[E1] error.message 非空').toMatch(/\S/);
    expect(r.headers.allow, '[E2] Allow 头包含 GET').toMatch(/\bGET\b/);
    expect(r.headers.allow, '[E2] Allow 头包含 PUT').toMatch(/\bPUT\b/);
  });

  await test.step('S2：DELETE /api/config', async () => {
    const r = await api.del('/api/config');
    expect(r.status, '[E3] DELETE 返回 405').toBe(405);
    expect(r.body.error.code, '[E3] error.code=METHOD_NOT_ALLOWED').toBe('METHOD_NOT_ALLOWED');
  });

  await test.step('S3：GET /api/config', async () => {
    const r = await api.get('/api/config');
    expect(r.status, '[E4] GET 返回 200').toBe(200);
    expect(r.body.cleanupThresholdDays, '[E4] 仍为默认 14（S1 未写入 3）').toBe(14);
  });
});
