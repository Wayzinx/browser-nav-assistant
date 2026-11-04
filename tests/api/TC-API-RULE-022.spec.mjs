import { test, expect } from '../fixtures/api.mjs';

// features: F-RULE-01, F-RULE-05
// codePoints: C-BE-RULE-07

test("TC-API-RULE-022 解析入口遇到坏JSON及错误媒体类型返回统一协议错误且不落库", async ({ api }) => {
  await test.step('S1：通过真实 HTTP 重置本例状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });

  const baseline = await test.step('S2：保存已有保护规则并读取完整基线', async () => {
    const saved = await api.post('/api/rules', { rules: [{ rawText: '保护已有规则', type: 'never_archive', domain: 'docs.internal.com' }] });
    expect(saved.status, '[E6] 基线保存返回 201').toBe(201);
    expect(saved.body.ruleCount, '[E6] 基线规则数为一').toBe(1);
    const list = await api.get('/api/rules');
    expect(list.status, '[E6] 基线可读取').toBe(200);
    expect(list.body.total, '[E6] 基线恰好一条规则').toBe(1);
    return list.body;
  });
  await test.step('S3：原样发送非法 JSON 字节', async () => {
    const r = await api.raw('POST', '/api/rules/parse', '{bad');
    expect(r.status, '[E2] 非法 JSON 返回 400').toBe(400);
    expect(r.body.error.code, '[E2] 错误码为 INVALID_JSON').toBe('INVALID_JSON');
    expect(r.body.error.message, '[E3] 解析错误说明非空').toMatch(/\S/);
  });
  await test.step('S4：以 text/plain 发送合法 JSON', async () => {
    const r = await api.raw('POST', '/api/rules/parse', JSON.stringify({ text: '飞书文档优先显示' }), 'text/plain');
    expect(r.status, '[E4] 错误媒体类型返回 415').toBe(415);
    expect(r.body.error.code, '[E4] 错误码准确').toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(r.body.error.message, '[E5] 媒体类型说明非空').toMatch(/\S/);
  });
  await test.step('S5：核对协议错误没有副作用', async () => {
    const list = await api.get('/api/rules');
    const health = await api.get('/api/health');
    expect(list.status, '[E6] 列表可读取').toBe(200);
    expect(list.body, '[E6] 完整规则快照不变').toEqual(baseline);
    expect(list.body.total, '[E6] 总数仍为一').toBe(1);
    expect(health.status, '[E6] 健康检查成功').toBe(200);
    expect(health.body, '[E6] 原有计数不变').toMatchObject({ ruleCount: 1, pageCount: 0 });
  });
});
