import { test, expect } from '../fixtures/api.mjs';

// features: F-RULE-01, F-RULE-02, F-RULE-05
// codePoints: C-BE-RULE-02, C-BE-RULE-07, C-BE-CORE-08

test("TC-API-RULE-019 trim后1字符和500字符均接受，500字符规则仍抽取7天", async ({ api }) => {
  await test.step('S1：通过真实 HTTP 重置本例状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });

  const inputs = await test.step('S2：构造并检查 trim 后 1 与 500 字符', async () => {
    const base = '7 天没访问的 GitHub issue 建议归档';
    const a = '甲';
    const b = '甲'.repeat(500 - base.length) + base;
    expect(a.length, '[E2] 最小边界数据长度为一').toBe(1);
    expect(b.length, '[E2] 最大边界数据长度为五百').toBe(500);
    return { a, b };
  });
  await test.step('S3：提交带外围空格的两个长度边界', async () => {
    const short = await api.post('/api/rules/parse', { text: `  ${inputs.a}  ` });
    const long = await api.post('/api/rules/parse', { text: `  ${inputs.b}  ` });
    expect(short.status, '[E2] trim 后一字符返回 200').toBe(200);
    expect(long.status, '[E2] trim 后五百字符返回 200').toBe(200);
    expect(short.body.rules, '[E3] 单字语义未识别').toEqual([]);
    expect(short.body.unparsed, '[E3] 返回一个未识别片段').toHaveLength(1);
    expect(short.body.unparsed[0].text, '[E3] 未识别原文去掉外围空格').toBe(inputs.a);
    expect(short.body.unparsed[0].examples, '[E3] 至少一条例句').toEqual(expect.arrayContaining([expect.any(String)]));
    expect(long.body.rules, '[E4] 五百字符仍能解析一条规则').toHaveLength(1);
    expect(long.body.rules[0], '[E4] 五百字符的天数与范围准确').toMatchObject({ type: 'archive_candidate', domain: 'github.com', urlPattern: '/issues/', inactiveDays: 7 });
    expect(long.body.rules[0].rawText, '[E5] 最大长度原文只 trim 不截断').toBe(inputs.b);
  });
  await test.step('S4：确认边界解析没有持久化', async () => {
    const list = await api.get('/api/rules');
    const health = await api.get('/api/health');
    expect(list.status, '[E6] 列表成功').toBe(200);
    expect(list.body.total, '[E6] 列表总数为零').toBe(0);
    expect(health.status, '[E6] 健康检查成功').toBe(200);
    expect(health.body, '[E6] 规则与页面计数为零').toMatchObject({ ruleCount: 0, pageCount: 0 });
  });
});
