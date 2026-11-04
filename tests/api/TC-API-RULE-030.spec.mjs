import { test, expect } from '../fixtures/api.mjs';

// features: F-RULE-06
// codePoints: C-BE-RULE-05, C-BE-RULE-08

test("TC-API-RULE-030 action与type不匹配及负inactiveDays均拒绝且不改原规则", async ({ api }) => {
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

  await test.step('S3：分别提交不匹配动作和负天数', async () => {
    for (const invalid of [
      { rawText: '错误动作', type: 'never_archive', domain: 'docs.internal.com', action: 'suggest_archive' },
      { rawText: '负天数', type: 'archive_candidate', domain: 'github.com', urlPattern: '/issues/', inactiveDays: -1, action: 'suggest_archive' },
    ]) {
      const r = await api.post('/api/rules', { rules: [invalid] });
      expect(r.status, '[E2] 非法规则返回 400').toBe(400);
      expect(r.body.error.code, '[E2] 类型或值校验失败').toBe('VALIDATION_FAILED');
      expect(r.body.error.message, '[E3] 每个错误说明非空').toMatch(/\S/);
    }
  });
  await test.step('S4：回读完整快照与健康计数没有变化', async () => {
    const list = await api.get('/api/rules');
    expect(list.status, '[E4] 规则列表成功').toBe(200);
    expect(list.body, '[E4] 规则及时间字段均不变').toEqual(baseline);
    expect(list.body.total, '[E4] 总数仍为一').toBe(1);
    const health = await api.get('/api/health');
    expect(health.status, '[E5] 健康检查成功').toBe(200);
    expect(health.body, '[E5] 页面与规则计数不变').toMatchObject({ ruleCount: 1, pageCount: 0 });
  });
});
