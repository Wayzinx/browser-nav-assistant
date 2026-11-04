import { test, expect } from '../fixtures/api.mjs';

// features: F-RULE-05
// codePoints: C-BE-RULE-04

test("TC-API-RULE-015 同域归档与永不归档都返回并给出一条优先级冲突告知", async ({ api }) => {
  await test.step('S1：通过真实 HTTP 重置本例状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });

  const r = await test.step('S2：解析同域归档与保护冲突', () => api.post('/api/rules/parse', { text: '7 天没访问的 GitHub issue 建议归档；github.com 永远不要归档' }));
  expect(r.status, '[E2] 冲突仍返回 200').toBe(200);
  expect(r.body.rules, '[E2] 不丢弃任何一条规则').toHaveLength(2);
  expect(r.body.rules.map(rule => rule.type), '[E2] 类型顺序不变').toEqual(['archive_candidate', 'never_archive']);
  expect(r.body.warnings, '[E3] 只有一条冲突提示').toHaveLength(1);
  expect(r.body.warnings[0], '[E3] 提示冲突').toContain('冲突');
  expect(r.body.warnings[0], '[E3] 提示永不归档优先级').toContain('永不归档');
  expect(r.body.rules.map(rule => rule.rawText), '[E4] 保留两个子句原文').toEqual(['7 天没访问的 GitHub issue 建议归档', 'github.com 永远不要归档']);
  await test.step('S3：确认冲突预览未持久保存', async () => {
    const list = await api.get('/api/rules');
    expect(list.status, '[E5] 列表成功').toBe(200);
    expect(list.body, '[E5] 规则列表仍为空').toEqual({ rules: [], total: 0 });
  });
});
