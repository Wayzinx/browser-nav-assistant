// 来源：docs/trace/cases/API-REC.json；REC API，独立真实 HTTP 用例。
import { test, expect, samplePayload } from '../fixtures/api.mjs';

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

test("TC-API-REC-021 三个 React 记录只有两个不同 dupKey 时不满足三页阈值", async ({ api, evidence }) => {
  await test.step('S1：POST /api/__test__/reset，以 JSON 空对象重置数据与缓存', async () => {
    const r = await api.post('/api/__test__/reset', {}, { setup: true });
    expect(r.status, 'S1 重置返回 200').toBe(200);
    expect(r.body, 'S1 重置成功').toMatchObject({ ok: true });
  });

  const { N } = await test.step('S2：按 D-01 平移样例并真实同步，记录 syncedAt 为 N', async () => {
    const T = Date.now();
    const payload = samplePayload({ now: T });
    const r = await api.seed(payload);
    expect(r.status, 'S2 同步返回 200').toBe(200);
    expect(r.body, 'S2 同步样例的完整计数').toMatchObject({
      received: 14, created: 10, updated: 4, rejected: 0, pageCount: 10,
    });
    expect(r.body.syncedAt, 'S2 后端生成毫秒时间基准').toEqual(expect.any(Number));
    evidence.note(JSON.stringify({ T, N: r.body.syncedAt }));
    return { payload, N: r.body.syncedAt };
  });

  const ruleId = await test.step('S3：保存 React → MDN 关联规则并取响应中的规则 ID', async () => {
    const r = await api.post('/api/rules', { rules: [RELATED_RULE] }, { setup: true });
    expect(r.status, 'S3 保存返回 201').toBe(201);
    expect(r.body.ruleCount, 'S3 保存后规则总数为 1').toBe(1);
    expect(r.body.rules, 'S3 本次保存一条规则').toHaveLength(1);
    expect(r.body.rules[0].id, 'S3 后端生成非空规则 ID').toMatch(/\S/);
    expect(r.body.rules[0].enabled, 'S3 规则已启用').toBe(true);
    const id = r.body.rules[0].id;
    evidence.note(JSON.stringify({ ruleId: id }));
    return id;
  });

  const r = await test.step('S4：三个 React 记录只有两个 dupKey 时请求推荐', () =>
    api.post('/api/recommendations/next', {
      currentPage: { url: 'https://react.dev/learn' }, openTabs: [], recentHistory: [
        { url: 'https://react.dev/learn', lastVisitTime: N - 1000 },
        { url: 'https://react.dev/learn?tab=overview#section', lastVisitTime: N - 2000 },
        { url: 'https://react.dev/reference/react/useState', lastVisitTime: N - 3000 },
      ],
    }, { params: { now: N } }));
  expect(r.status, '[E1] 推荐返回 200').toBe(200);
  expect(r.body.recommendations.filter(p => p.strategy === 'rule'), '[E1] tab/hash 变体不增加不同页面计数，规则不触发').toEqual([]);
  expect(r.body.recommendations[0], '[E2] 首推同文档站 useState，评分为 0.76').toMatchObject({
    url: 'https://react.dev/reference/react/useState', strategy: 'same_doc_site', score: 0.76,
  });
});
