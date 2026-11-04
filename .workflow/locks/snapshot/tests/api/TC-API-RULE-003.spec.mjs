import { test, expect } from '../fixtures/api.mjs';

// features: F-RULE-02
// codePoints: C-BE-RULE-02, C-BE-RULE-03

const TEXT = "七天没访问的 GitHub issue 建议归档";

test("TC-API-RULE-003 中文七天抽取为7且GitHub issue映射完整", async ({ api }) => {
  await test.step('S1：通过真实 HTTP 重置本例状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });

  const r = await test.step('S2：解析天数与页面类型', () => api.post('/api/rules/parse', { text: TEXT }));
  expect(r.status, '[E2] 解析返回 200').toBe(200);
  expect(r.body.rules, '[E2] 返回一条规则').toHaveLength(1);
  expect(r.body.rules[0], '[E3] 抽取字段完全符合用例').toMatchObject({"type": "archive_candidate", "domain": "github.com", "urlPattern": "/issues/", "inactiveDays": 7, "action": "suggest_archive"});
  expect(r.body.rules[0], '[E4] 保留原文与置信度').toMatchObject({ rawText: TEXT, ...{"confidence": "high", "enabled": true} });
  expect(r.body.unparsed, '[E5] 无未识别片段').toEqual([]);
  expect(r.body.warnings, '[E5] 无警告').toEqual([]);
});
