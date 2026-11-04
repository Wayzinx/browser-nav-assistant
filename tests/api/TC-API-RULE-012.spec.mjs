import { test, expect } from '../fixtures/api.mjs';

// features: F-RULE-04
// codePoints: C-BE-RULE-01

const A = "7 天没访问的 issue 归档";
const B = "github.com 永远不要归档";

test("TC-API-RULE-012 单子句到双子句的普通分隔符不会丢失或产生空规则", async ({ api }) => {
  await test.step('S1：通过真实 HTTP 重置本例状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });

  await test.step('S2：解析单个完整子句作为下边界', async () => {
    const r = await api.post('/api/rules/parse', { text: A });
    expect(r.status, '[E2] 单子句返回 200').toBe(200);
    expect(r.body.rules, '[E2] 单子句只有一条规则').toHaveLength(1);
    expect(r.body.rules[0].rawText, '[E2] 保留单子句原文').toBe(A);
  });
  await test.step('S3：逐次验证五种普通分隔符', async () => {
    for (const separator of ['；', '。', '\n', '并且', '，']) {
      const r = await api.post('/api/rules/parse', { text: A + separator + B });
      expect(r.status, '[E3] 每个分隔符均返回 200').toBe(200);
      expect(r.body.rules, '[E3] 每次恰好两条规则').toHaveLength(2);
      expect(r.body.rules.map(rule => rule.type), '[E3] 顺序与输入一致').toEqual(['archive_candidate', 'never_archive']);
      expect(r.body.rules.map(rule => rule.rawText), '[E4] 子句原文无空片段').toEqual([A, B]);
      expect(r.body.unparsed, '[E5] 两个完整子句均识别').toEqual([]);
    }
  });
});
