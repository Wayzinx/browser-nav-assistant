import { test, expect } from '../fixtures/api.mjs';

// features: F-RULE-03
// codePoints: C-BE-RULE-03

const TEXT = "docs.internal.com 的页面永远不要归档";

test("TC-API-RULE-007 永远不要归档解析为keep，不能误产生archive_candidate", async ({ api }) => {
  await test.step('S1：通过真实 HTTP 重置本例状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });

  const r = await test.step('S2：解析否定归档意图', () => api.post('/api/rules/parse', { text: TEXT }));
  expect(r.status, '[E2] 解析返回 200').toBe(200);
  expect(r.body.rules, '[E2] 否定句仅产生一条规则').toHaveLength(1);
  expect(r.body.rules[0], '[E3] 否定规则保留范围与原文').toMatchObject({ rawText: TEXT, type: 'never_archive', domain: 'docs.internal.com', action: 'keep' });
  expect(r.body.rules.filter(rule => rule.type === 'archive_candidate'), '[E4] 没有肯定归档规则').toHaveLength(0);
  expect(r.body.unparsed, '[E5] 否定句已识别').toEqual([]);
});
