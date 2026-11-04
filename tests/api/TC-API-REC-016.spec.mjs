// 来源：docs/trace/cases/API-REC.json；REC API，独立真实 HTTP 用例。
import { test, expect, DAY } from '../fixtures/api.mjs';

// S1 显式发送 JSON 重置请求，替代夹具在步骤外的自动重置。
test.use({ autoReset: false });

test("TC-API-REC-016 文档当前页没有同站点数据时不生成 same_doc_site 结果", async ({ api, evidence }) => {
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

  const r = await test.step('S3：当前 React 文档没有同站点历史，查询全局兜底', () =>
    api.post('/api/recommendations/next', {
      currentPage: { url: 'https://react.dev/learn' }, openTabs: [], recentHistory: [],
    }, { params: { now: T } }));
  expect(r.status, '[E1] 推荐返回 200').toBe(200);
  expect(r.body.recommendations.map(p => p.strategy), '[E1] 恰有两条全局推荐，没有文档策略').toEqual(['global_top', 'global_top']);
  expect(r.body.recommendations.map(p => [p.url, p.score]), '[E2] news 推荐的顺序和分数精确').toEqual([
    ['https://news.example.org/a', 0.48], ['https://news.example.org/b', 0.41],
  ]);

  await test.step('S4：GET /api/health，读回计数并核对查询没有写入副作用', async () => {
    const r = await api.get('/api/health');
    expect(r.status, '[E3] 健康检查返回 200').toBe(200);
    expect(r.body, '[E3] 页面、规则及同步状态保持预期').toMatchObject({ pageCount: 2, ruleCount: 0 });
  });
});
