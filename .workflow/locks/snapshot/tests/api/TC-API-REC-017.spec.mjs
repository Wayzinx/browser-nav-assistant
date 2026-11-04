// 来源：docs/trace/cases/API-REC.json；REC API，独立真实 HTTP 用例。
import { test, expect, DAY } from '../fixtures/api.mjs';

// S1 显式发送 JSON 重置请求，替代夹具在步骤外的自动重置。
test.use({ autoReset: false });

test("TC-API-REC-017 非内置文档域名的 guide 路径仍触发文档策略", async ({ api, evidence }) => {
  await test.step('S1：POST /api/__test__/reset，以 JSON 空对象重置数据与缓存', async () => {
    const r = await api.post('/api/__test__/reset', {}, { setup: true });
    expect(r.status, 'S1 重置返回 200').toBe(200);
    expect(r.body, 'S1 重置成功').toMatchObject({ ok: true });
  });

  const T = await test.step('S2：同步一天前的独立 news 历史，固定时间为 T', async () => {
    const T = Date.now();
    const r = await api.seed({ activeTab: null, openTabs: [], history: [
          { url: 'https://news.example.org/a', title: 'News A', lastVisitTime: T - DAY, visitCount: 5 },
          { url: 'https://news.example.org/b', title: 'News B', lastVisitTime: T - DAY, visitCount: 1 },
        ] });
    expect(r.status, 'S2 同步返回 200').toBe(200);
    expect(r.body, 'S2 新建页面数量').toMatchObject({ created: 2, pageCount: 2 });
    evidence.note(JSON.stringify({ T, N: r.body.syncedAt }));
    return T;
  });

  const r = await test.step('S3：以非内置站点的 /guide/start 请求文档推荐', () =>
    api.post('/api/recommendations/next', {
      currentPage: { url: 'https://news.example.org/guide/start' }, openTabs: [], recentHistory: [],
    }, { params: { now: T } }));
  expect(r.status, '[E1] 推荐返回 200').toBe(200);
  expect(r.body.recommendations, '[E1] 返回两条推荐').toHaveLength(2);
  expect(r.body.recommendations.map(p => [p.url, p.strategy, p.score]), '[E2] guide 路径触发文档策略，排序和分数精确').toEqual([
    ['https://news.example.org/a', 'same_doc_site', 0.78],
    ['https://news.example.org/b', 'same_doc_site', 0.71],
  ]);
  for (const p of r.body.recommendations) {
    expect(p.reason, '[E2] 每条理由包含 news 域名').toContain('news.example.org');
  }
});
