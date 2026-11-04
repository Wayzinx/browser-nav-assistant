import { test, expect } from '../fixtures/api.mjs';

// features: F-RULE-06, F-RULE-07, F-RULE-10
// codePoints: C-BE-RULE-02, C-BE-RULE-03, C-BE-RULE-05, C-BE-RULE-06, C-BE-CORE-11

const TEXT = "把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档";
const TYPES = ['archive_candidate', 'never_archive', 'privacy_filter', 'recommend_related', 'boost_domain'];
const ACTIONS = ['suggest_archive', 'keep', 'exclude_upload', 'recommend', 'boost'];

test("TC-API-RULE-041 五种解析结果都能保存并按创建顺序列出准确type/action字段", async ({ api }) => {
  await test.step('S1：通过真实 HTTP 重置本例状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });

  const preview = await test.step('S2：依次解析五种类型并按请求顺序拼接', async () => {
    const rules = [];
    const texts = [TEXT, '不要上传包含 password、token 的 URL', '如果我连续看了 3 个 React 文档，推荐相关 MDN 页面', '飞书文档优先显示'];
    const sizes = [2, 1, 1, 1];
    for (const [index, text] of texts.entries()) {
      const r = await api.post('/api/rules/parse', { text });
      expect(r.status, '[E2] 每次解析返回 200').toBe(200);
      expect(r.body.rules, '[E2] 每次返回数量准确').toHaveLength(sizes[index]);
      rules.push(...r.body.rules);
    }
    expect(rules.map(rule => rule.type), '[E3] 五种类型按请求顺序拼接').toEqual(TYPES);
    expect(rules.map(rule => rule.action), '[E3] 五种动作与类型对应').toEqual(ACTIONS);
    return rules;
  });
  const saved = await test.step('S3：保存全部五种类型并核对结构', async () => {
    const r = await api.post('/api/rules', { rules: preview });
    expect(r.status, '[E4] 保存返回 201').toBe(201);
    expect(r.body.rules, '[E4] 保存五条规则').toHaveLength(5);
    expect(r.body.ruleCount, '[E4] 总数为五').toBe(5);
    for (const rule of r.body.rules) {
      expect(rule.id, '[E5] 每个正式 id 非空').toMatch(/\S/);
      expect(rule.enabled, '[E5] 每条规则默认启用').toBe(true);
    }
    expect(new Set(r.body.rules.map(rule => rule.id)).size, '[E5] 五个正式 id 互不重复').toBe(5);
    expect(r.body.rules.map(rule => rule.type), '[E5] 类型顺序不变').toEqual(TYPES);
    expect(r.body.rules.map(rule => rule.action), '[E5] 动作顺序不变').toEqual(ACTIONS);
    expect(r.body.rules[2].keywords, '[E6] 关键词顺序准确').toEqual(['password', 'token']);
    expect(r.body.rules[3], '[E6] 推荐触发与目标站点准确').toMatchObject({ trigger: { domain: 'react.dev', minCount: 3 }, target: { domain: 'developer.mozilla.org' } });
    expect(r.body.rules[4].domain, '[E6] 飞书域名准确').toBe('feishu.cn');
    expect(r.body.rules.map(rule => rule.rawText), '[E7] 保存未改变原文顺序').toEqual(preview.map(rule => rule.rawText));
    return r.body.rules;
  });
  await test.step('S4：读取五种已保存规则与健康计数', async () => {
    const list = await api.get('/api/rules');
    expect(list.status, '[E7] 列表返回 200').toBe(200);
    expect(list.body.total, '[E7] 列表总数为五').toBe(5);
    expect(list.body.rules, '[E7] 原文、动作、启用和扩展字段均与保存响应相等').toEqual(saved);
    const health = await api.get('/api/health');
    expect(health.status, '[E8] 健康检查成功').toBe(200);
    expect(health.body, '[E8] 五条均启用且没有页面').toMatchObject({ ruleCount: 5, enabledRuleCount: 5, pageCount: 0 });
  });
});
