// 来源：docs/trace/cases/API-REC.json；REC API，独立真实 HTTP 用例。
import { test, expect, DAY } from '../fixtures/api.mjs';

// S1 显式发送 JSON 重置请求，替代夹具在步骤外的自动重置。
test.use({ autoReset: false });

test("TC-API-REC-010 同一语义 id 的 tab 变体只保留高分 URL", async ({ api, evidence }) => {
  await test.step('S1：POST /api/__test__/reset，以 JSON 空对象重置数据与缓存', async () => {
    const r = await api.post('/api/__test__/reset', {}, { setup: true });
    expect(r.status, 'S1 重置返回 200').toBe(200);
    expect(r.body, 'S1 重置成功').toMatchObject({ ok: true });
  });

  const T = await test.step('S2：同步相同 id、不同 tab 的两条独立 URL', async () => {
    const T = Date.now();
    const r = await api.seed({ activeTab: null, openTabs: [], history: [
      { url: 'https://example.com/p?id=1&tab=x', title: 'Higher', lastVisitTime: T - DAY, visitCount: 5 },
      { url: 'https://example.com/p?id=1&tab=y', title: 'Lower', lastVisitTime: T - DAY, visitCount: 2 },
    ] });
    expect(r.status, '[E1] 同步返回 200').toBe(200);
    expect(r.body, '[E1] 存储保留两条业务 query URL').toMatchObject({ created: 2, pageCount: 2 });
    evidence.note(JSON.stringify({ T, N: r.body.syncedAt }));
    return T;
  });
  const r = await test.step('S3：请求同域推荐，按 dupKey 只保留高分 URL', () =>
    api.post('/api/recommendations/next', {
      currentPage: { url: 'https://example.com/q' }, openTabs: [], recentHistory: [],
    }, { params: { now: T } }));
  expect(r.status, '[E2] 推荐返回 200').toBe(200);
  expect(r.body.recommendations, '[E2] 只保留一条推荐').toHaveLength(1);
  expect(r.body.recommendations[0], '[E2] 保留高分 tab=x，策略和分数精确').toMatchObject({
    url: 'https://example.com/p?id=1&tab=x', strategy: 'same_domain', score: 0.66,
  });
  expect(r.body.recommendations.map(p => p.url), '[E3] tab=y 低分变体被排除').not.toContain('https://example.com/p?id=1&tab=y');
});
