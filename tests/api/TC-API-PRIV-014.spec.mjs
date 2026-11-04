import { test, expect } from '../fixtures/api.mjs';

test('TC-API-PRIV-014 配置请求的非法 JSON 和错误 Content-Type 不修改配置', async ({ api }) => {
  await test.step('S1：POST /api/__test__/reset', () => api.reset());

  await test.step('S2：PUT /api/config 发送原始非法 JSON', async () => {
    const r = await api.raw('PUT', '/api/config', '{bad json', 'application/json');
    expect(r.status, '[E1] 非法 JSON 返回 400').toBe(400);
    expect(r.body.error.code, '[E1] 错误码为 INVALID_JSON').toBe('INVALID_JSON');
    expect(r.body.error.message, '[E1] 错误信息非空').toMatch(/\S/);
  });

  await test.step('S3：PUT /api/config 使用 text/plain 发送合法 JSON 文本', async () => {
    const r = await api.raw('PUT', '/api/config', '{"cleanupThresholdDays":7}', 'text/plain');
    expect(r.status, '[E2] 错误 Content-Type 返回 415').toBe(415);
    expect(r.body.error.code, '[E2] 错误码为 UNSUPPORTED_MEDIA_TYPE').toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(r.body.error.message, '[E2] 错误信息非空').toMatch(/\S/);
  });

  await test.step('S4：GET /api/config 验证失败请求无副作用', async () => {
    const r = await api.get('/api/config');
    expect(r.status, '[E3] 配置查询返回 200').toBe(200);
    expect(r.body.cleanupThresholdDays, '[E3] 清理阈值仍为默认 14').toBe(14);
  });
});
