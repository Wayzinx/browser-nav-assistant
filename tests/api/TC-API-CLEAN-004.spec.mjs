import { test, expect, samplePayload } from '../fixtures/api.mjs';

test('TC-API-CLEAN-004 不支持的 POST 返回 405 和 Allow 头', async ({ api }) => {
  const now = Date.now();
  await test.step('S1：POST /api/sync 导入平移后的样例', () => api.seed(samplePayload({ now })));
  await test.step('S2：POST /api/pages/cleanup-suggestions 提交空对象', async () => {
    const r = await api.post('/api/pages/cleanup-suggestions', {});
    expect(r.status, '[E1] 不支持的方法返回 405').toBe(405);
    expect(r.body.error.code, '[E1] 错误码为 METHOD_NOT_ALLOWED').toBe('METHOD_NOT_ALLOWED');
    expect(r.body.error.message, '[E1] 错误说明非空').toMatch(/\S/);
    expect(r.headers.allow, '[E2] Allow 列出 GET').toMatch(/(?:^|,\s*)GET(?:\s*,|$)/);
  });
  await test.step('S3：GET /api/pages/cleanup-suggestions 仍正常', async () => {
    const r = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
    expect(r.status, '[E3] GET 返回 200').toBe(200);
    expect(r.body.summary, '[E3] 建议未被非法方法改变').toEqual({ archive: 2, merge: 1, keep: 0 });
  });
});
