import { test, expect } from '../fixtures/api.mjs';

// features: F-RULE-02
// codePoints: C-BE-RULE-02, C-BE-RULE-03

const TEXT = "上周以后没访问的 GitHub issue 建议归档";

test("TC-API-RULE-045 不支持的相对日期不会被静默当成默认14天归档", async ({ api }) => {
  await test.step('S1：通过真实 HTTP 重置本例状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });

  const r = await test.step('S2：解析明确不支持的相对日期', () => api.post('/api/rules/parse', { text: TEXT }));
  expect(r.status, '[E2] 合法 text 返回 200').toBe(200);
  expect(r.body.rules, '[E2] 不把不支持日期默认为十四天').toEqual([]);
  expect(r.body.unparsed, '[E3] 返回一个未识别片段').toHaveLength(1);
  expect(r.body.unparsed[0].text, '[E3] 保留相对日期原文').toBe(TEXT);
  expect(r.body.unparsed[0].reason, '[E3] 给出非空说明').toMatch(/\S/);
  expect(r.body.unparsed[0].examples, '[E4] 至少一条非空例句').toEqual(expect.arrayContaining([expect.stringMatching(/\S/)]));
  for (const example of r.body.unparsed[0].examples) {
    expect(example, '[E4] 每个例句均为非空字符串').toMatch(/\S/);
  }
  await test.step('S3：核对相对日期预览不修改状态', async () => {
    const list = await api.get('/api/rules');
    const health = await api.get('/api/health');
    expect(list.status, '[E5] 列表可读取').toBe(200);
    expect(list.body, '[E5] 规则库为空').toEqual({ rules: [], total: 0 });
    expect(health.status, '[E5] 健康检查成功').toBe(200);
    expect(health.body, '[E5] 页面与规则计数为零').toMatchObject({ ruleCount: 0, pageCount: 0 });
  });
});
