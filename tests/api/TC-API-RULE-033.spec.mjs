import { test, expect } from '../fixtures/api.mjs';

// features: F-RULE-08, F-RULE-07
// codePoints: C-BE-RULE-06, C-BE-RULE-08, C-BE-CORE-11

const TEXT = "把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档";

test("TC-API-RULE-033 用保存返回id删除never_archive后列表仅剩原归档规则", async ({ api }) => {
  await test.step('S1：通过真实 HTTP 重置本例状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });

  const saved = await test.step('S2：解析保存双规则并传递正式 id', async () => {
    const parsed = await api.post('/api/rules/parse', { text: TEXT });
    expect(parsed.status, '[E2] 前置解析成功').toBe(200);
    const r = await api.post('/api/rules', { rules: parsed.body.rules });
    expect(r.status, '[E2] 保存返回 201').toBe(201);
    expect(r.body.ruleCount, '[E2] 总数为二').toBe(2);
    expect(r.body.rules, '[E2] 两条规则已保存').toHaveLength(2);
    expect(r.body.rules.map(rule => rule.type), '[E2] 返回归档与保护规则').toEqual(['archive_candidate', 'never_archive']);
    return { archive: r.body.rules[0], keep: r.body.rules[1] };
  });
  await test.step('S3：使用正式 keep id 删除保护规则', async () => {
    const r = await api.del(`/api/rules/${saved.keep.id}`);
    expect(r.status, '[E3] 删除返回 200').toBe(200);
    expect(r.body, '[E3] 回传被删除 id 且剩一条规则').toEqual({ deleted: saved.keep.id, ruleCount: 1 });
  });
  await test.step('S4：仅剩原归档规则且健康计数同步', async () => {
    const list = await api.get('/api/rules');
    expect(list.status, '[E4] 列表返回 200').toBe(200);
    expect(list.body.total, '[E4] 只剩一条规则').toBe(1);
    expect(list.body.rules, '[E4] 原归档规则完整保留').toEqual([saved.archive]);
    expect(list.body.rules[0], '[E4] 正式 id、类型与启用状态准确').toMatchObject({ id: saved.archive.id, type: 'archive_candidate', enabled: true });
    const health = await api.get('/api/health');
    expect(health.status, '[E5] 健康检查成功').toBe(200);
    expect(health.body, '[E5] 计数反映删除结果').toMatchObject({ ruleCount: 1, enabledRuleCount: 1, pageCount: 0 });
  });
});
