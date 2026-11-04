// 来源：docs/trace/cases/API-REC.json；REC API，独立真实 HTTP 用例。
import { test, expect, DAY } from '../fixtures/api.mjs';

// S1 显式发送 JSON 重置请求，替代夹具在步骤外的自动重置。
test.use({ autoReset: false });

const RELATED_RULE = {
  rawText: '如果我连续看了 3 个 React 文档，推荐相关 MDN 页面',
  type: 'recommend_related',
  trigger: { domain: 'react.dev', minCount: 3, label: 'React' },
  target: { domain: 'developer.mozilla.org', label: 'MDN' },
  action: 'recommend',
  enabled: true,
  confidence: 'high',
};

test("TC-API-REC-025 触发规则但库中没有 MDN 页面时给出站内搜索兜底", async ({ api, evidence }) => {
  await test.step('S1：POST /api/__test__/reset，以 JSON 空对象重置数据与缓存', async () => {
    const r = await api.post('/api/__test__/reset', {}, { setup: true });
    expect(r.status, 'S1 重置返回 200').toBe(200);
    expect(r.body, 'S1 重置成功').toMatchObject({ ok: true });
  });

  const N = await test.step('S2：只同步一个 React 页面，确保库中没有 MDN 目标', async () => {
    const T = Date.now();
    const r = await api.seed({ activeTab: null, openTabs: [], history: [
      { url: 'https://react.dev/learn', title: 'React Learn', lastVisitTime: T - DAY, visitCount: 1 },
    ] });
    expect(r.status, '[E1] 同步返回 200').toBe(200);
    expect(r.body, '[E1] 只新建一个 React 页面').toMatchObject({ created: 1, pageCount: 1 });
    expect(r.body.syncedAt, 'S2 后端生成时间基准').toEqual(expect.any(Number));
    evidence.note(JSON.stringify({ T, N: r.body.syncedAt }));
    return r.body.syncedAt;
  });

  const ruleId = await test.step('S3：保存 React → MDN 关联规则并取响应中的规则 ID', async () => {
    const r = await api.post('/api/rules', { rules: [RELATED_RULE] }, { setup: true });
    expect(r.status, '[E1] 保存返回 201').toBe(201);
    expect(r.body.ruleCount, '[E1] 保存后规则总数为 1').toBe(1);
    expect(r.body.rules, '[E1] 本次保存一条规则').toHaveLength(1);
    expect(r.body.rules[0].id, '[E1] 后端生成非空规则 ID').toMatch(/\S/);
    expect(r.body.rules[0].enabled, '[E1] 规则已启用').toBe(true);
    const id = r.body.rules[0].id;
    evidence.note(JSON.stringify({ ruleId: id }));
    return id;
  });

  const r = await test.step('S4：满足 React 触发上下文但库中无 MDN 页，查询站内搜索兜底', () =>
    api.post('/api/recommendations/next', {
      currentPage: { url: 'https://unknown.example.net/x', title: 'React forms' },
      openTabs: [], recentHistory: [
        { url: 'https://react.dev/reference/react/useEffect', lastVisitTime: N - 3000 },
        { url: 'https://react.dev/learn', lastVisitTime: N - 1000 },
        { url: 'https://react.dev/reference/react/useState', lastVisitTime: N - 2000 },
      ],
    }, { params: { now: N } }));
  expect(r.status, '[E2] 推荐返回 200').toBe(200);
  const ruleRecommendations = r.body.recommendations.filter(p => p.strategy === 'rule');
  expect(ruleRecommendations, '[E2] 恰有一条规则推荐').toHaveLength(1);
  const recommendation = ruleRecommendations[0];
  expect(recommendation, '[E2] 搜索兜底分数为 0.8，推荐 ID 来自真实规则 ID').toMatchObject({
    strategy: 'rule', score: 0.8, id: 'rec_rule_' + ruleId,
  });
  const target = new URL(recommendation.url);
  expect(target.protocol, '[E3] 兜底 URL 可解析且使用 HTTPS').toBe('https:');
  expect(target.hostname, '[E3] 兜底目标域为 MDN').toBe('developer.mozilla.org');
  expect(recommendation.title, '[E3] 兜底标题为非空字符串').toMatch(/\S/);
  expect(recommendation.reason, '[E3] 兜底理由为非空字符串').toMatch(/\S/);
});
