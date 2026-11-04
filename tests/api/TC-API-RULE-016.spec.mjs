import { test, expect } from '../fixtures/api.mjs';

// features: F-RULE-10
// codePoints: C-BE-RULE-02, C-BE-RULE-03

const TEXT = "不要上传包含 password、token 的 URL";

test("TC-API-RULE-016 不上传关键词解析为privacy_filter并保持关键词顺序", async ({ api }) => {
  await test.step('S1：通过真实 HTTP 重置本例状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });

  const r = await test.step('S2：解析扩展规则类型', () => api.post('/api/rules/parse', { text: TEXT }));
  expect(r.status, '[E2] 返回 200').toBe(200);
  expect(r.body.rules, '[E2] 返回一条扩展规则').toHaveLength(1);
  expect(r.body.rules[0], '[E3] 类型动作与扩展字段准确').toMatchObject({"type": "privacy_filter", "action": "exclude_upload", "keywords": ["password", "token"]});
  expect(r.body.rules[0].keywords, '[E3] 关键词顺序与数量准确').toEqual(['password', 'token']);

  expect(r.body.rules[0], '[E4] 原文、启用与置信度正确').toMatchObject({ rawText: TEXT, enabled: true, confidence: 'high' });
  expect(r.body.unparsed, '[E5] 无未识别片段').toEqual([]);
  expect(r.body.warnings, '[E5] 无警告').toEqual([]);
});
