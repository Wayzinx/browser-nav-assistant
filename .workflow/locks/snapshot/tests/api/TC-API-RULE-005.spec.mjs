import { test, expect } from '../fixtures/api.mjs';

// features: F-RULE-02
// codePoints: C-BE-RULE-02, C-BE-RULE-03

test("TC-API-RULE-005 数字一个月与中文一个月均换算为30天", async ({ api }) => {
  await test.step('S1：通过真实 HTTP 重置本例状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });

  await test.step('S2：分别解析阿拉伯数字与中文一个月', async () => {
    for (const text of ['1 个月没访问的 GitHub issue 建议归档', '一个月没访问的 GitHub issue 建议归档']) {
      const r = await api.post('/api/rules/parse', { text });
      expect(r.status, '[E2] 每次解析返回 200').toBe(200);
      expect(r.body.rules, '[E2] 每次只有一条规则').toHaveLength(1);
      expect(r.body.rules[0], '[E3] 两种月单位均换算为 30 天').toMatchObject({ type: 'archive_candidate', domain: 'github.com', urlPattern: '/issues/', inactiveDays: 30, action: 'suggest_archive', confidence: 'high' });
      expect(r.body.rules[0].rawText, '[E4] 每次分别保留该次原句').toBe(text);
      expect(r.body.unparsed, '[E5] 两种表达均被识别').toEqual([]);
    }
  });
});
