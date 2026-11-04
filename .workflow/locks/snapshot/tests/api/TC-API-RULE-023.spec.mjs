import { test, expect } from '../fixtures/api.mjs';

// features: F-RULE-06, F-RULE-07
// codePoints: C-BE-RULE-05, C-BE-RULE-06, C-BE-RULE-08, C-BE-CORE-11

const TEXT = "把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档";

test("TC-API-RULE-023 解析双规则后完整确认保存返回201及可渲染列表字段", async ({ api }) => {
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
  const saved = await test.step('S3：原样确认保存两条预览', async () => {
    const r = await api.post('/api/rules', { rules: preview });
    expect(r.status, '[E3] 保存返回 201').toBe(201);
    expect(r.body.rules, '[E3] 保存了两条规则').toHaveLength(2);
    expect(r.body.ruleCount, '[E3] 总数为二').toBe(2);
    const ids = r.body.rules.map(rule => rule.id);
    expect(ids, '[E4] 正式 id 均为非空字符串').toEqual([expect.stringMatching(/\S/), expect.stringMatching(/\S/)]);
    expect(new Set(ids).size, '[E4] 正式 id 互不重复').toBe(2);
    expect(r.body.rules.map(rule => [rule.type, rule.action, rule.enabled]), '[E5] 顺序、动作与启用状态正确').toEqual([['archive_candidate', 'suggest_archive', true], ['never_archive', 'keep', true]]);
    expect(r.body.rules.map(rule => rule.rawText), '[E6] 子句原文保留').toEqual(['把 7 天没访问过的 GitHub issue 建议归档', 'docs.internal.com 的页面永远不要归档']);
    for (const rule of r.body.rules) {
      expect(rule, '[E6] 置信度与保存时间字段正确').toMatchObject({ confidence: 'high', createdAt: expect.any(Number), updatedAt: expect.any(Number) });
    }
    return r.body.rules;
  });
  await test.step('S4：按创建顺序读取正式规则与健康计数', async () => {
    const list = await api.get('/api/rules');
    expect(list.status, '[E7] 列表返回 200').toBe(200);
    expect(list.body.total, '[E7] 列表总数为二').toBe(2);
    expect(list.body.rules, '[E7] 列表完整内容与保存响应相同').toEqual(saved);
    for (const rule of list.body.rules) {
      expect(rule, '[E7] 可渲染字段与结构字段齐全').toMatchObject({ id: expect.stringMatching(/\S/), rawText: expect.stringMatching(/\S/), type: expect.any(String), action: expect.any(String), enabled: true, domain: expect.any(String), urlPattern: rule.type === 'archive_candidate' ? '/issues/' : null, inactiveDays: rule.type === 'archive_candidate' ? 7 : null, confidence: 'high', createdAt: expect.any(Number), updatedAt: expect.any(Number) });
    }
    const health = await api.get('/api/health');
    expect(health.status, '[E8] 健康检查成功').toBe(200);
    expect(health.body, '[E8] 规则和页面计数准确').toMatchObject({ ruleCount: 2, enabledRuleCount: 2, pageCount: 0 });
  });
});
