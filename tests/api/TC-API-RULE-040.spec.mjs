import { test, expect } from '../fixtures/api.mjs';

// features: F-RULE-08
// codePoints: C-BE-CORE-04, C-BE-RULE-08

test("TC-API-RULE-040 规则id路径使用不支持的POST方法返回405且不删除规则", async ({ api }) => {
  await test.step('S1：通过真实 HTTP 重置本例状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });

  const baseline = await test.step('S2：保存基线规则并读取完整快照', async () => {
    const saved = await api.post('/api/rules', { rules: [{ rawText: '保护docs', type: 'never_archive', domain: 'docs.internal.com' }] });
    expect(saved.status, '[E4] 基线保存成功').toBe(201);
    expect(saved.body.ruleCount, '[E4] 基线总数为一').toBe(1);
    const list = await api.get('/api/rules');
    expect(list.status, '[E4] 读取基线成功').toBe(200);
    expect(list.body.total, '[E4] 基线包含一条规则').toBe(1);
    return list.body;
  });

  await test.step('S3：提交不存在资源或不支持的方法', async () => {
    const r = await api.post(`/api/rules/${baseline.rules[0].id}`, {});
    expect(r.status, '[E2] 路由或资源错误状态准确').toBe(405);
    expect(r.body.error.code, '[E2] 错误码准确').toBe('METHOD_NOT_ALLOWED');
    expect(r.body.error.message, '[E3] 错误说明非空').toMatch(/\S/);
  });
  await test.step('S4：回读完整快照与健康计数没有变化', async () => {
    const list = await api.get('/api/rules');
    expect(list.status, '[E4] 规则列表成功').toBe(200);
    expect(list.body, '[E4] 规则及时间字段均不变').toEqual(baseline);
    expect(list.body.total, '[E4] 总数仍为一').toBe(1);
    const health = await api.get('/api/health');
    expect(health.status, '[E5] 健康检查成功').toBe(200);
    expect(health.body, '[E5] 页面与规则计数不变').toMatchObject({ ruleCount: 1, enabledRuleCount: 1, pageCount: 0 });
  });
});
