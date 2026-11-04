import { test, expect } from '../fixtures/api.mjs';

// features: F-RULE-04, F-RULE-10
// codePoints: C-BE-RULE-01, C-BE-RULE-02, C-BE-RULE-03

const TEXT = "如果我连续看了 3 个 React 文档，推荐相关 MDN 页面";

test("TC-API-RULE-011 条件句中的逗号保持一个关联推荐规则及完整原文", async ({ api }) => {
  await test.step('S1：通过真实 HTTP 重置本例状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });

  const r = await test.step('S2：解析含条件逗号的关联推荐', () => api.post('/api/rules/parse', { text: TEXT }));
  expect(r.status, '[E2] 返回 200').toBe(200);
  expect(r.body.rules, '[E2] 条件逗号不拆分').toHaveLength(1);
  expect(r.body.rules[0].rawText, '[E3] 保留完整条件句').toBe(TEXT);
  expect(r.body.rules[0], '[E4] 关联触发与目标站点正确').toMatchObject({ type: 'recommend_related', action: 'recommend', trigger: { domain: 'react.dev', minCount: 3 }, target: { domain: 'developer.mozilla.org' } });
  expect(r.body.rules[0], '[E5] 默认启用且置信度高').toMatchObject({ enabled: true, confidence: 'high' });
  expect(r.body.unparsed, '[E5] 条件句完全识别').toEqual([]);
});
