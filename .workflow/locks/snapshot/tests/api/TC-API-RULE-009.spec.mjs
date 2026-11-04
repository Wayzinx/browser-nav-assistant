import { test, expect } from '../fixtures/api.mjs';

// features: F-RULE-03
// codePoints: C-BE-RULE-03

test("TC-API-RULE-009 不要与禁止否定变体不落入肯定归档分支", async ({ api }) => {
  await test.step('S1：通过真实 HTTP 重置本例状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });

  const responses = await test.step('S2：分别解析不要与禁止变体', async () => {
    const out = [];
    for (const text of ['不要归档 github.com 的页面', '禁止清理 docs.internal.com 的页面']) {
      const r = await api.post('/api/rules/parse', { text });
      expect(r.status, '[E2] 合法否定句返回 200').toBe(200);
      expect(r.body.rules, '[E2] 每句仅一条规则').toHaveLength(1);
      expect(r.body.rules.filter(rule => rule.type === 'archive_candidate'), '[E5] 每个响应都无归档候选').toHaveLength(0);
      expect(r.body.unparsed, '[E5] 每句均被识别').toEqual([]);
      out.push(r.body);
    }
    return out;
  });
  expect(responses[0].rules[0], '[E3] 不要归档 github').toMatchObject({ type: 'never_archive', domain: 'github.com', action: 'keep' });
  expect(responses[1].rules[0], '[E4] 禁止清理 docs').toMatchObject({ type: 'never_archive', domain: 'docs.internal.com', action: 'keep' });
  await test.step('S3：确认所有预览都未入库', async () => {
    const list = await api.get('/api/rules');
    const health = await api.get('/api/health');
    expect(list.status, '[E6] 列表可读取').toBe(200);
    expect(list.body, '[E6] 规则库为空').toEqual({ rules: [], total: 0 });
    expect(health.status, '[E6] 健康检查可读取').toBe(200);
    expect(health.body, '[E6] 页面与规则数为零').toMatchObject({ ruleCount: 0, pageCount: 0 });
  });
});
