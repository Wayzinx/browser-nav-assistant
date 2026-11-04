import { test, expect } from '../fixtures/api.mjs';

// features: F-RULE-06
// codePoints: C-BE-RULE-05, C-BE-RULE-08

test("TC-API-RULE-029 各规则必填字段缺失时逐批返回400且已有规则不变", async ({ api }) => {
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

  await test.step('S3：每条缺字段规则单独提交并立即核对无副作用', async () => {
    const invalidRules = [
      { type: 'never_archive', domain: 'example.com' },
      { rawText: '缺type', domain: 'example.com' },
      { rawText: '缺保护范围', type: 'never_archive' },
      { rawText: '缺关键词', type: 'privacy_filter' },
      { rawText: '缺触发站点', type: 'recommend_related', target: { domain: 'developer.mozilla.org' } },
      { rawText: '缺目标站点', type: 'recommend_related', trigger: { domain: 'react.dev', minCount: 3 } },
      { rawText: '缺加权域名', type: 'boost_domain' },
    ];
    for (const invalid of invalidRules) {
      const r = await api.post('/api/rules', { rules: [invalid] });
      expect(r.status, '[E2] 每个缺字段批次返回 400').toBe(400);
      expect(r.body.error.code, '[E2] 必填字段校验失败').toBe('VALIDATION_FAILED');
      expect(r.body.error.message, '[E3] 每个错误说明非空').toMatch(/\S/);
      const list = await api.get('/api/rules');
      expect(list.status, '[E4] 每次回读成功').toBe(200);
      expect(list.body, '[E4] 每次完整快照均不变').toEqual(baseline);
      expect(list.body.total, '[E4] 每次总数仍为一').toBe(1);
      const health = await api.get('/api/health');
      expect(health.status, '[E5] 每次健康检查成功').toBe(200);
      expect(health.body, '[E5] 每次规则与页面计数不变').toMatchObject({ ruleCount: 1, enabledRuleCount: 1, pageCount: 0 });
    }
  });
});
