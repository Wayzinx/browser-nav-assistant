import { test, expect } from '../fixtures/api.mjs';

// features: F-RULE-04, F-RULE-05
// codePoints: C-BE-RULE-01, C-BE-RULE-04

test("TC-API-RULE-043 多子句中未识别片段单独告知且不丢失合法规则", async ({ api }) => {
  await test.step('S1：通过真实 HTTP 重置本例状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });

  const r = await test.step('S2：解析合法子句与未识别子句的混合输入', () => api.post('/api/rules/parse', { text: '7 天没访问的 issue 归档；帮我整理一下' }));
  expect(r.status, '[E2] 混合子句返回 200').toBe(200);
  expect(r.body.rules, '[E2] 唯一合法规则不丢失').toHaveLength(1);
  expect(r.body.rules[0], '[E2] 归档子句字段与原文准确').toMatchObject({ type: 'archive_candidate', urlPattern: '/issues/', inactiveDays: 7, rawText: '7 天没访问的 issue 归档' });
  expect(r.body.unparsed, '[E3] 未识别片段单独告知').toHaveLength(1);
  expect(r.body.unparsed[0], '[E3] 未识别原文与原因准确').toMatchObject({ text: '帮我整理一下', reason: '没有识别到动作（归档 / 不要归档 / 推荐 / 不上传 / 优先）' });
  expect(r.body.unparsed[0].examples, '[E4] 至少一条非空例句').toEqual(expect.arrayContaining([expect.stringMatching(/\S/)]));
  for (const example of r.body.unparsed[0].examples) {
    expect(example, '[E4] 每项均为非空字符串').toMatch(/\S/);
  }
  expect(r.body.rules.map(rule => rule.rawText), '[E4] 不把未识别片段生成额外规则').toEqual(['7 天没访问的 issue 归档']);
  await test.step('S3：核对预览不写入规则或页面', async () => {
    const list = await api.get('/api/rules');
    const health = await api.get('/api/health');
    expect(list.status, '[E5] 列表可读取').toBe(200);
    expect(list.body, '[E5] 规则库为空').toEqual({ rules: [], total: 0 });
    expect(health.status, '[E5] 健康检查成功').toBe(200);
    expect(health.body, '[E5] 页面与规则数为零').toMatchObject({ ruleCount: 0, pageCount: 0 });
  });
});
