import { test, expect } from '../fixtures/api.mjs';

test('TC-API-PRIV-013 非法字段及无可识别字段返回校验错误，配置保持不变', async ({ api }) => {
  const initialConfig = await test.step('S1：POST /api/__test__/reset 并记录初始配置', async () => {
    await api.reset();
    const r = await api.get('/api/config');
    expect(r.status, '[E5] 初始配置查询返回 200').toBe(200);
    return r.body;
  });

  await test.step('S2：PUT /api/config 提交空对象', async () => {
    const r = await api.put('/api/config', {});
    expect(r.status, '[E1] 无可识别字段返回 400').toBe(400);
    expect(r.body.error.code, '[E1] 错误码为 VALIDATION_FAILED').toBe('VALIDATION_FAILED');
    expect(r.body.error.message, '[E1] 错误信息非空').toMatch(/\S/);
  });

  await test.step('S3：PUT /api/config 将关键词列表传成字符串', async () => {
    const r = await api.put('/api/config', { privacySensitiveKeywords: 'cookie' });
    expect(r.status, '[E2] 关键词类型错误返回 400').toBe(400);
    expect(r.body.error.code, '[E2] 错误码为 VALIDATION_FAILED').toBe('VALIDATION_FAILED');
    expect(r.body.error.details.fields, '[E2] 标明错误的关键词字段').toContain('privacySensitiveKeywords');
  });

  await test.step('S4：PUT /api/config 提交空字符串关键词', async () => {
    const r = await api.put('/api/config', { privacySensitiveKeywords: [''] });
    expect(r.status, '[E3] 空关键词返回 400').toBe(400);
    expect(r.body.error.code, '[E3] 错误码为 VALIDATION_FAILED').toBe('VALIDATION_FAILED');
  });

  await test.step('S5：PUT /api/config 只提交只读 weights 字段', async () => {
    const r = await api.put('/api/config', { weights: { recency: 1 } });
    expect(r.status, '[E4] 只读字段不可修改，返回 400').toBe(400);
    expect(r.body.error.code, '[E4] 错误码为 VALIDATION_FAILED').toBe('VALIDATION_FAILED');
  });

  await test.step('S6：GET /api/config 验证非法请求均未修改配置', async () => {
    const r = await api.get('/api/config');
    expect(r.status, '[E5] 配置查询返回 200').toBe(200);
    expect(r.body.privacySensitiveKeywords, '[E5] 关键词仍严格为默认四项').toStrictEqual(['password', 'token', 'bank', 'secret']);
    expect(r.body.weights, '[E5] 排序权重仍严格为默认值').toStrictEqual({ recency: 0.4, frequency: 0.3, open: 0.2, domain: 0.1 });
    expect(r.body, '[E5] 完整配置与请求前一致').toStrictEqual(initialConfig);
  });
});
