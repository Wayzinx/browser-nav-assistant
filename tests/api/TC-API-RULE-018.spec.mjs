import { test, expect } from '../fixtures/api.mjs';

// features: F-RULE-10
// codePoints: C-BE-RULE-02, C-BE-RULE-03

test("TC-API-RULE-018 扩展规则缺关键词或推荐站点时只返回未识别片段", async ({ api }) => {
  await test.step('S1：通过真实 HTTP 重置本例状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });

  const responses = await test.step('S2：逐次解析缺少关键要素的扩展规则', async () => {
    const out = [];
    for (const text of ['不要上传敏感页面', '连续看 3 个文档就推荐']) {
      const r = await api.post('/api/rules/parse', { text });
      expect(r.status, '[E2] 语义未识别仍为 200').toBe(200);
      expect(r.body.rules, '[E2] 不生成不完整规则').toEqual([]);
      expect(r.body.unparsed, '[E5] 每次只有一条未识别片段').toHaveLength(1);
      expect(r.body.unparsed[0].examples, '[E5] 至少一条非空例句').toEqual(expect.arrayContaining([expect.stringMatching(/\S/)]));
      for (const example of r.body.unparsed[0].examples) {
        expect(example, '[E5] 所有例句均非空').toMatch(/\S/);
      }
      out.push(r.body);
    }
    return out;
  });
  expect(responses[0].unparsed, '[E3] 缺关键词产生一个未识别片段').toHaveLength(1);
  expect(responses[0].unparsed[0].reason, '[E3] 告知缺关键词').toContain('没找到要过滤的关键词');
  expect(responses[1].unparsed, '[E4] 缺站点产生一个未识别片段').toHaveLength(1);
  expect(responses[1].unparsed[0].reason, '[E4] 告知缺触发站点').toContain('触发站点');
  expect(responses[1].unparsed[0].reason, '[E4] 告知缺推荐站点').toContain('推荐站点');
  await test.step('S3：确认未识别预览没有写入', async () => {
    const list = await api.get('/api/rules');
    const health = await api.get('/api/health');
    expect(list.status, '[E6] 列表可读取').toBe(200);
    expect(list.body.total, '[E6] 没有已保存规则').toBe(0);
    expect(health.status, '[E6] 健康检查成功').toBe(200);
    expect(health.body, '[E6] 规则与页面均为零').toMatchObject({ ruleCount: 0, pageCount: 0 });
  });
});
