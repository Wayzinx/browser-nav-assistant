import { test, expect } from '../fixtures/api.mjs';

// features: F-RULE-10
// codePoints: C-BE-RULE-02, C-BE-RULE-03

test("TC-API-RULE-044 关联推荐次数1与3及隐私关键词1与2均保持精确计数", async ({ api }) => {
  await test.step('S1：通过真实 HTTP 重置本例状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });

  await test.step('S2：分别解析连续计数一与三', async () => {
    const counts = [];
    for (const count of [1, 3]) {
      const r = await api.post('/api/rules/parse', { text: `如果我连续看了 ${count} 个 React 文档，推荐相关 MDN 页面` });
      expect(r.status, '[E2] 每次返回 200').toBe(200);
      expect(r.body.rules, '[E2] 每次一条关联推荐规则').toHaveLength(1);
      expect(r.body.rules[0], '[E2] 触发与目标站点准确').toMatchObject({ type: 'recommend_related', trigger: { domain: 'react.dev' }, target: { domain: 'developer.mozilla.org' } });
      expect(r.body.rules[0].trigger.minCount, '[E3] 显式计数不被默认值覆盖').toBe(count);
      counts.push(r.body.rules[0].trigger.minCount);
    }
    expect(counts, '[E3] 次数按输入顺序为一与三').toEqual([1, 3]);
  });
  await test.step('S3：分别解析一个与两个隐私关键词', async () => {
    for (const keywords of [['password'], ['password', 'token']]) {
      const r = await api.post('/api/rules/parse', { text: `不要上传包含 ${keywords.join('、')} 的 URL` });
      expect(r.status, '[E4] 每次返回 200').toBe(200);
      expect(r.body.rules, '[E4] 每次一条隐私规则').toHaveLength(1);
      expect(r.body.rules[0], '[E4] 隐私类型与动作准确').toMatchObject({ type: 'privacy_filter', action: 'exclude_upload' });
      expect(r.body.rules[0].keywords, '[E5] 关键词顺序和数量精确匹配').toEqual(keywords);
    }
  });
  await test.step('S4：确认所有边界解析都未入库', async () => {
    const list = await api.get('/api/rules');
    const health = await api.get('/api/health');
    expect(list.status, '[E6] 列表可读取').toBe(200);
    expect(list.body.total, '[E6] 规则数仍为零').toBe(0);
    expect(health.status, '[E6] 健康检查成功').toBe(200);
    expect(health.body, '[E6] 页面与规则数未变').toMatchObject({ ruleCount: 0, pageCount: 0 });
  });
});
