import { test, expect } from '../fixtures/api.mjs';

// features: F-RULE-02
// codePoints: C-BE-RULE-02, C-BE-RULE-03

test("TC-API-RULE-006 未指定天数时采用14天并返回medium及默认值说明", async ({ api }) => {
  await test.step('S1：通过真实 HTTP 重置本例状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });

  const r = await test.step('S2：解析未指定天数的规则', () => api.post('/api/rules/parse', { text: 'GitHub 的页面建议归档' }));
  expect(r.status, '[E2] 合法输入返回 200').toBe(200);
  expect(r.body.rules, '[E2] 返回一条规则').toHaveLength(1);
  expect(r.body.rules[0], '[E3] 默认 14 天且置信度为 medium').toMatchObject({ inactiveDays: 14, confidence: 'medium' });
  expect(r.body.rules[0].notes, '[E4] 明确告知默认天数').toContain('未指定天数，使用默认 14 天');
  expect(r.body.rules[0], '[E5] 域名与类型动作正确').toMatchObject({ domain: 'github.com', urlPattern: null, type: 'archive_candidate', action: 'suggest_archive' });
  expect(r.body.unparsed, '[E6] 默认规则是合法解析结果').toEqual([]);
});
