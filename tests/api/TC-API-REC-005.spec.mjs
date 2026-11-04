// 来源：docs/trace/cases/API-REC.json；REC API，独立真实 HTTP 用例。
import { test, expect, DAY } from '../fixtures/api.mjs';

// S1 显式发送 JSON 重置请求，替代夹具在步骤外的自动重置。
test.use({ autoReset: false });

test("TC-API-REC-005 普通站点同域候选按评分排序且理由标明同域名", async ({ api, evidence }) => {
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
    expect(r.status, '[E1] 同步返回 200').toBe(200);
    expect(r.body, '[E1] 新建页面数量').toMatchObject({ created: 2, pageCount: 2 });
    evidence.note(JSON.stringify({ T, N: r.body.syncedAt }));
    return T;
  });

  const currentUrl = 'https://news.example.org/c';
  const r = await test.step('S3：以同域 news 页面请求推荐，固定 now=T', () =>
    api.post('/api/recommendations/next', {
      currentPage: { url: currentUrl }, openTabs: [], recentHistory: [],
    }, { params: { now: T } }));
  expect(r.status, '[E2] 推荐返回 200').toBe(200);
  expect(r.body.recommendations.map(p => [p.url, p.strategy, p.score]), '[E2] 同域两条推荐的顺序与精确评分').toEqual([
    ['https://news.example.org/a', 'same_domain', 0.66],
    ['https://news.example.org/b', 'same_domain', 0.59],
  ]);
  for (const p of r.body.recommendations) {
    expect(p.reason, '[E3] 每条理由标明同域名').toContain('同域名');
    expect(p.contextUrl, '[E3] 上下文为 news 当前页').toBe(currentUrl);
  }
});
