// 来源：docs/trace/cases/API-REC.json；REC API，独立真实 HTTP 用例。
import { test, expect, DAY } from '../fixtures/api.mjs';

// S1 显式发送 JSON 重置请求，替代夹具在步骤外的自动重置。
test.use({ autoReset: false });

test("TC-API-REC-013 先舍入再过滤时最终 0.30 保留而 0.29 被排除", async ({ api, evidence }) => {
  await test.step('S1：POST /api/__test__/reset，以 JSON 空对象重置数据与缓存', async () => {
    const r = await api.post('/api/__test__/reset', {}, { setup: true });
    expect(r.status, 'S1 重置返回 200').toBe(200);
    expect(r.body, 'S1 重置成功').toMatchObject({ ok: true });
  });

  const T = await test.step('S2：同步 1023 次 anchor 和 9/10 天前的阈值候选', async () => {
    const T = Date.now();
    const r = await api.seed({ activeTab: null, openTabs: [], history: [
      { url: 'https://boundary.example.org/anchor', title: 'Anchor', lastVisitTime: T - 300000, visitCount: 1023 },
      { url: 'https://boundary.example.org/keep', title: 'Keep', lastVisitTime: T - 9 * DAY, visitCount: 1 },
      { url: 'https://boundary.example.org/drop', title: 'Drop', lastVisitTime: T - 10 * DAY, visitCount: 1 },
    ] });
    expect(r.status, '[E1] 同步返回 200').toBe(200);
    expect(r.body, '[E1] 新建三条页面').toMatchObject({ created: 3, pageCount: 3 });
    evidence.note(JSON.stringify({ T, N: r.body.syncedAt }));
    return T;
  });
  await test.step('S3：GET /api/pages/ranked?now=T，核对 keep/drop 原始评分', async () => {
    const r = await api.get('/api/pages/ranked', { params: { now: T } });
    expect(r.status, '[E2] 排序返回 200').toBe(200);
    expect(r.body.pages.find(p => p.url === 'https://boundary.example.org/keep'), '[E2] keep 页面原始分数为 0.29').toMatchObject({
      url: 'https://boundary.example.org/keep', score: 0.29,
    });
    expect(r.body.pages.find(p => p.url === 'https://boundary.example.org/drop'), '[E2] drop 页面原始分数为 0.28').toMatchObject({
      url: 'https://boundary.example.org/drop', score: 0.28,
    });
  });
  const r = await test.step('S4：未知域上下文且打开 anchor，检验先舍入再过滤', () =>
    api.post('/api/recommendations/next', {
      currentPage: { url: 'https://unknown.example.net/x' },
      openTabs: [{ url: 'https://boundary.example.org/anchor' }], recentHistory: [],
    }, { params: { now: T } }));
  expect(r.status, '[E3] 推荐返回 200').toBe(200);
  expect(r.body.recommendations, '[E3] 恰好保留一条边界推荐').toHaveLength(1);
  expect(r.body.recommendations[0], '[E3] 舍入为 0.30 的 keep 被保留').toMatchObject({
    url: 'https://boundary.example.org/keep', strategy: 'global_top', score: 0.30,
  });
  const urls = r.body.recommendations.map(p => p.url);
  expect(urls, '[E4] 最终 0.29 的 drop 被排除').not.toContain('https://boundary.example.org/drop');
  expect(urls, '[E4] 打开的 anchor 被排除').not.toContain('https://boundary.example.org/anchor');
});
