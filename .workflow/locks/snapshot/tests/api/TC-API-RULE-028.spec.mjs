import { test, expect } from '../fixtures/api.mjs';

// features: F-RULE-06
// codePoints: C-BE-RULE-05, C-BE-RULE-08

test("TC-API-RULE-028 rules缺失或不是数组返回400且保留已有规则", async ({ api }) => {
  await test.step('S1：通过真实 HTTP 重置本例状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });

  const baseline = await test.step('S2：保存基线规则并读取完整快照', async () => {
    const saved = await api.post('/api/rules', { rules: [{ rawText: '基线保护', type: 'never_archive', domain: 'baseline.example.com' }] });
    expect(saved.status, '[E4] 基线保存成功').toBe(201);
    expect(saved.body.ruleCount, '[E4] 基线总数为一').toBe(1);
    const list = await api.get('/api/rules');
    expect(list.status, '[E4] 读取基线成功').toBe(200);
    expect(list.body.total, '[E4] 基线包含一条规则').toBe(1);
    return list.body;
  });

  await test.step('S3：逐一提交缺失与非数组的 rules', async () => {
    for (const input of [{}, { rules: null }, { rules: {} }, { rules: 'x' }]) {
      const r = await api.post('/api/rules', input);
      expect(r.status, '[E2] rules 类型错误返回 400').toBe(400);
      expect(r.body.error.code, '[E2] 字段校验错误码准确').toBe('VALIDATION_FAILED');
      expect(r.body.error.message, '[E3] 每个错误说明非空').toMatch(/\S/);
    }
  });
  await test.step('S4：回读完整快照与健康计数没有变化', async () => {
    const list = await api.get('/api/rules');
    expect(list.status, '[E4] 规则列表成功').toBe(200);
    expect(list.body, '[E4] 规则及时间字段均不变').toEqual(baseline);
    expect(list.body.total, '[E4] 总数仍为一').toBe(1);
    const health = await api.get('/api/health');
    expect(health.status, '[E4] 健康检查成功').toBe(200);
    expect(health.body, '[E4] 页面与规则计数不变').toMatchObject({ ruleCount: 1, pageCount: 0 });
  });
});
