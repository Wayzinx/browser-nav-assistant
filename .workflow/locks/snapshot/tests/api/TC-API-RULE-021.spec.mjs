import { test, expect } from '../fixtures/api.mjs';

// features: F-RULE-01, F-RULE-05
// codePoints: C-BE-RULE-07, C-BE-CORE-08

test("TC-API-RULE-021 缺少text或text类型错误返回400并保留原规则", async ({ api }) => {
  await test.step('S1：通过真实 HTTP 重置本例状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });

  const baseline = await test.step('S2：保存已有保护规则并读取完整基线', async () => {
    const saved = await api.post('/api/rules', { rules: [{ rawText: '保护已有规则', type: 'never_archive', domain: 'docs.internal.com' }] });
    expect(saved.status, '[E2] 基线保存返回 201').toBe(201);
    expect(saved.body.ruleCount, '[E2] 基线规则数为一').toBe(1);
    const list = await api.get('/api/rules');
    expect(list.status, '[E2] 基线可读取').toBe(200);
    expect(list.body.total, '[E2] 基线恰好一条规则').toBe(1);
    return list.body;
  });
  await test.step('S3：逐一提交不合法 text', async () => {
    for (const input of [{}, { text: null }, { text: 7 }, { text: [] }, { text: {} }]) {
      const r = await api.post('/api/rules/parse', input);
      expect(r.status, '[E3] 无效输入返回 400').toBe(400);
      expect(r.body.error.code, '[E3] 字段校验错误码准确').toBe('VALIDATION_FAILED');
      expect(r.body.error.message, '[E4] 错误说明为非空字符串').toMatch(/\S/);
    }
  });
  await test.step('S4：完整回读原规则与健康计数', async () => {
    const list = await api.get('/api/rules');
    expect(list.status, '[E5] 回读成功').toBe(200);
    expect(list.body, '[E5] 内容与时间字段全部不变').toEqual(baseline);
    expect(list.body.total, '[E5] 仍只有一条规则').toBe(1);
    const health = await api.get('/api/health');
    expect(health.status, '[E5] 健康检查成功').toBe(200);
    expect(health.body, '[E5] 无新增规则与页面').toMatchObject({ ruleCount: 1, enabledRuleCount: 1, pageCount: 0 });
  });
});
