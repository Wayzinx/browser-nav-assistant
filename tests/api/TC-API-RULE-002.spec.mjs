import { test, expect } from '../fixtures/api.mjs';

// features: F-RULE-01, F-RULE-07
// codePoints: C-BE-RULE-07, C-BE-RULE-06, C-BE-CORE-11

const TEXT = "把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档";

test("TC-API-RULE-002 库中已保存两条规则时再解析不会修改规则与计数", async ({ api }) => {
  await test.step('S1：通过真实 HTTP 重置本例状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });

  await test.step('S2：解析并保存双规则', async () => {
    const parsed = await api.post('/api/rules/parse', { text: TEXT });
    expect(parsed.status, '[E2] 前置解析成功').toBe(200);
    const saved = await api.post('/api/rules', { rules: parsed.body.rules });
    expect(saved.status, '[E2] 保存返回 201').toBe(201);
    expect(saved.body.rules, '[E2] 保存两条规则').toHaveLength(2);
    expect(saved.body.ruleCount, '[E2] 规则总数为二').toBe(2);
  });
  const baseline = await test.step('S3：读取完整规则与健康计数快照', async () => {
    const list = await api.get('/api/rules');
    const health = await api.get('/api/health');
    expect(list.status, '[E3] 列表返回 200').toBe(200);
    expect(health.status, '[E3] 健康检查成功').toBe(200);
    expect(list.body.total, '[E3] 基线规则总数为二').toBe(2);
    expect(list.body.rules.map(rule => rule.type), '[E3] 基线保持创建顺序').toEqual(['archive_candidate', 'never_archive']);
    for (const rule of list.body.rules) {
      expect(rule, '[E3] 每条基线包含列表必需字段').toMatchObject({ id: expect.stringMatching(/\S/), rawText: expect.stringMatching(/\S/), type: expect.any(String), action: expect.any(String), enabled: true, createdAt: expect.any(Number), updatedAt: expect.any(Number) });
    }
    return { rules: list.body, health: health.body };
  });
  await test.step('S4：只预览新的飞书加权规则', async () => {
    const r = await api.post('/api/rules/parse', { text: '飞书文档优先显示' });
    expect(r.status, '[E4] 预览返回 200').toBe(200);
    expect(r.body.rules, '[E4] 返回一条新预览').toHaveLength(1);
    expect(r.body.rules[0].type, '[E4] 新预览为 boost_domain').toBe('boost_domain');
  });
  await test.step('S5：完整回读规则与对应计数未变', async () => {
    const list = await api.get('/api/rules');
    expect(list.status, '[E5] 回读成功').toBe(200);
    expect(list.body, '[E5] 正式 id、时间和内容全部不变').toEqual(baseline.rules);
    const health = await api.get('/api/health');
    expect(health.status, '[E6] 健康检查成功').toBe(200);
    expect(health.body, '[E6] 计数保持预期').toMatchObject({ ruleCount: 2, enabledRuleCount: 2, pageCount: 0 });
    for (const key of ['ruleCount', 'enabledRuleCount', 'pageCount']) {
      expect(health.body[key], '[E6] 对应计数与 H0 相等').toBe(baseline.health[key]);
    }
  });
});
