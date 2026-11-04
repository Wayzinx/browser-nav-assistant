import { test, expect } from '../fixtures/api.mjs';

// features: F-RULE-01, F-RULE-02
// codePoints: C-BE-RULE-02, C-BE-RULE-03, C-BE-RULE-07

const TEXT = "把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档";

test("TC-API-RULE-001 题目双规则解析返回有序完整预览，确认前规则库仍为空", async ({ api }) => {
  await test.step('S1：通过真实 HTTP 重置本例状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });

  const r = await test.step('S2：解析题目双规则句', () => api.post('/api/rules/parse', { text: TEXT }));
  expect(r.status, '[E2] 解析返回 200').toBe(200);
  expect(r.body.rules, '[E2] 共两条预览').toHaveLength(2);
  expect(r.body.rules.map(rule => rule.type), '[E2] 保持子句顺序').toEqual(['archive_candidate', 'never_archive']);
  const previews = [
    { rawText: '把 7 天没访问过的 GitHub issue 建议归档', type: 'archive_candidate', domain: 'github.com', urlPattern: '/issues/', inactiveDays: 7, action: 'suggest_archive', enabled: true, confidence: 'high', notes: [] },
    { rawText: 'docs.internal.com 的页面永远不要归档', type: 'never_archive', domain: 'docs.internal.com', urlPattern: null, inactiveDays: null, action: 'keep', enabled: true, confidence: 'high', notes: [] },
  ].map((rule, index) => ({ id: `rule_${index + 1}`, ...rule }));
  expect(r.body.rules[0], '[E3] 第一条完整预览字段').toEqual(previews[0]);
  expect(r.body.rules[1], '[E4] 第二条完整预览字段').toEqual(previews[1]);
  expect(r.body.unparsed, '[E5] 无未识别片段').toEqual([]);
  expect(r.body.warnings, '[E5] 无冲突提示').toEqual([]);
  await test.step('S3：确认预览未写入规则库或页面库', async () => {
    const list = await api.get('/api/rules');
    expect(list.status, '[E6] 列表可读取').toBe(200);
    expect(list.body, '[E6] 规则库仍为空').toEqual({ rules: [], total: 0 });
    const health = await api.get('/api/health');
    expect(health.status, '[E7] 健康检查可读取').toBe(200);
    expect(health.body, '[E7] 页面与规则计数均为零').toMatchObject({ ruleCount: 0, pageCount: 0 });
  });
});
