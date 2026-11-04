import { test, expect } from '../fixtures/api.mjs';

// features: F-RULE-03
// codePoints: C-BE-RULE-03

const TEXT = "别归档 github.com 的页面";

test("TC-API-RULE-008 别归档识别github.com并保持never_archive", async ({ api }) => {
  await test.step('S1：通过真实 HTTP 重置本例状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });

  const r = await test.step('S2：解析否定归档意图', () => api.post('/api/rules/parse', { text: TEXT }));
  expect(r.status, '[E2] 解析返回 200').toBe(200);
  expect(r.body.rules, '[E2] 否定句仅产生一条规则').toHaveLength(1);
  expect(r.body.rules[0], '[E3] 否定规则保留范围与原文').toMatchObject({ rawText: TEXT, type: 'never_archive', domain: 'github.com', action: 'keep' });
  expect(r.body.rules.filter(rule => rule.type === 'archive_candidate'), '[E4] 没有肯定归档规则').toHaveLength(0);
});
