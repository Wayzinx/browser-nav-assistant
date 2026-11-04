import { test, expect } from '../fixtures/api.mjs';

// features: F-RULE-06
// codePoints: C-BE-RULE-05, C-BE-RULE-06, C-BE-RULE-08, C-BE-CORE-11

test("TC-API-RULE-025 混合合法规则与unknown_type时整批拒绝且已有规则不变", async ({ api }) => {
  await test.step('S1：通过真实 HTTP 重置本例状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });

  const baseline = await test.step('S2：保存基线规则并读取完整快照', async () => {
    const saved = await api.post('/api/rules', { rules: [{ rawText: '已有保护', type: 'never_archive', domain: 'docs.internal.com' }] });
    expect(saved.status, '[E2] 基线保存成功').toBe(201);
    expect(saved.body.ruleCount, '[E2] 基线总数为一').toBe(1);
    const list = await api.get('/api/rules');
    expect(list.status, '[E2] 读取基线成功').toBe(200);
    expect(list.body.total, '[E2] 基线包含一条规则').toBe(1);
    return list.body;
  });

  await test.step('S3：提交先合法后非法的混合批次', async () => {
    const r = await api.post('/api/rules', { rules: [
      { rawText: '本批合法项', type: 'boost_domain', domain: 'feishu.cn' },
      { rawText: '本批非法项', type: 'unknown_type', domain: 'example.com' },
    ] });
    expect(r.status, '[E3] 混合批次全部拒绝').toBe(400);
    expect(r.body.error.code, '[E3] 类型校验错误码准确').toBe('VALIDATION_FAILED');
    expect(r.body.error.message, '[E4] 错误说明非空').toMatch(/\S/);
  });
  await test.step('S4：回读完整快照与健康计数没有变化', async () => {
    const list = await api.get('/api/rules');
    expect(list.status, '[E5] 规则列表成功').toBe(200);
    expect(list.body, '[E5] 规则及时间字段均不变').toEqual(baseline);
    expect(list.body.total, '[E5] 总数仍为一').toBe(1);
    const health = await api.get('/api/health');
    expect(health.status, '[E6] 健康检查成功').toBe(200);
    expect(health.body, '[E6] 页面与规则计数不变').toMatchObject({ ruleCount: 1, enabledRuleCount: 1, pageCount: 0 });
  });
});
