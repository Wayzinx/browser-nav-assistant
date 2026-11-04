import { test, expect } from '../fixtures/api.mjs';

// features: F-RULE-01, F-RULE-05
// codePoints: C-BE-RULE-04, C-BE-RULE-07

const TEXT = "帮我整理一下";

test("TC-API-RULE-013 合法但没有动作的文本返回200、空规则和原因例句", async ({ api }) => {
  await test.step('S1：通过真实 HTTP 重置本例状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });

  const r = await test.step('S2：解析合法但无法识别的文本', () => api.post('/api/rules/parse', { text: TEXT }));
  expect(r.status, '[E2] 语义未识别仍返回 200').toBe(200);
  expect(r.body.rules, '[E2] 不产生兜底规则').toEqual([]);
  expect(r.body.unparsed, '[E3] 单独告知未识别片段').toHaveLength(1);
  expect(r.body.unparsed[0].text, '[E3] 未识别原文保持不变').toBe(TEXT);
  expect(r.body.unparsed[0].reason, '[E3] 原因准确').toBe('没有识别到动作（归档 / 不要归档 / 推荐 / 不上传 / 优先）');
  expect(r.body.unparsed[0].examples, '[E4] 例句是非空数组').toEqual(expect.arrayContaining([expect.stringMatching(/\S/)]));
  for (const example of r.body.unparsed[0].examples) {
    expect(example, '[E4] 每条例句均为非空字符串').toMatch(/\S/);
  }
  await test.step('S3：回读规则与健康状态无副作用', async () => {
    const list = await api.get('/api/rules');
    const health = await api.get('/api/health');
    expect(list.status, '[E5] 列表成功').toBe(200);
    expect(list.body, '[E5] 规则库为空').toEqual({ rules: [], total: 0 });
    expect(health.status, '[E5] 健康检查成功').toBe(200);
    expect(health.body, '[E5] 页面和规则均未新增').toMatchObject({ ruleCount: 0, pageCount: 0 });
  });
});
