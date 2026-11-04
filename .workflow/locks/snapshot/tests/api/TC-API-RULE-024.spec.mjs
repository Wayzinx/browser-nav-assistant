import { test, expect } from '../fixtures/api.mjs';

// features: F-RULE-06
// codePoints: C-BE-RULE-05, C-BE-RULE-06, C-BE-RULE-08

const TEXT = "把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档";

test("TC-API-RULE-024 只确认双规则中的第一条时仅保存archive_candidate", async ({ api }) => {
  await test.step('S1：通过真实 HTTP 重置本例状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });

  const preview = await test.step('S2：解析题目双规则句', async () => {
    const r = await api.post('/api/rules/parse', { text: TEXT });
    expect(r.status, '[E2] 解析返回 200').toBe(200);
    expect(r.body.rules, '[E2] 预览恰好两条规则').toHaveLength(2);
    return r.body.rules;
  });
  const saved = await test.step('S3：仅提交第一条预览', async () => {
    const r = await api.post('/api/rules', { rules: [preview[0]] });
    expect(r.status, '[E3] 子集保存返回 201').toBe(201);
    expect(r.body.rules, '[E3] 只保存一条规则').toHaveLength(1);
    expect(r.body.ruleCount, '[E3] 总数为一').toBe(1);
    expect(r.body.rules[0].id, '[E3] 获得正式 id').toMatch(/\S/);
    return r.body.rules[0];
  });
  await test.step('S4：回读所选规则且未保存未选项', async () => {
    const list = await api.get('/api/rules');
    expect(list.status, '[E4] 列表成功').toBe(200);
    expect(list.body.total, '[E4] 总数为一').toBe(1);
    expect(list.body.rules, '[E4] 只有所选归档规则').toHaveLength(1);
    expect(list.body.rules[0], '[E4] 归档范围、天数与启用状态正确').toMatchObject({ type: 'archive_candidate', domain: 'github.com', urlPattern: '/issues/', inactiveDays: 7, enabled: true });
    expect(list.body.rules.filter(rule => rule.type === 'never_archive'), '[E5] 未选保护规则不入库').toHaveLength(0);
    expect(list.body.rules[0].id, '[E5] id 来自本例保存响应').toBe(saved.id);
    const health = await api.get('/api/health');
    expect(health.status, '[E6] 健康检查成功').toBe(200);
    expect(health.body, '[E6] 对应计数正确').toMatchObject({ ruleCount: 1, enabledRuleCount: 1, pageCount: 0 });
  });
});
