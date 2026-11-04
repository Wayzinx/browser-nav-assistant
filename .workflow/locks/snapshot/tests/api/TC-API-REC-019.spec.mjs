// 来源：docs/trace/cases/API-REC.json；REC API，独立真实 HTTP 用例。
import { test, expect, DAY } from '../fixtures/api.mjs';

// S1 显式发送 JSON 重置请求，替代夹具在步骤外的自动重置。
test.use({ autoReset: false });

test("TC-API-REC-019 只有一个同域候选时返回一条并保持可解释评分", async ({ api, evidence }) => {
  await test.step('S1：POST /api/__test__/reset，以 JSON 空对象重置数据与缓存', async () => {
    const r = await api.post('/api/__test__/reset', {}, { setup: true });
    expect(r.status, 'S1 重置返回 200').toBe(200);
    expect(r.body, 'S1 重置成功').toMatchObject({ ok: true });
  });

  const T = await test.step('S2：同步一天前的独立 news 历史，固定时间为 T', async () => {
    const T = Date.now();
    const r = await api.seed({ activeTab: null, openTabs: [], history: [{ url: 'https://news.example.org/a', title: 'Only', lastVisitTime: T - DAY, visitCount: 1 }] });
    expect(r.status, '[E1] 同步返回 200').toBe(200);
    expect(r.body, '[E1] 新建页面数量').toMatchObject({ created: 1, pageCount: 1 });
    evidence.note(JSON.stringify({ T, N: r.body.syncedAt }));
    return T;
  });

  const r = await test.step('S3：同域只有一个候选时查询推荐', () =>
    api.post('/api/recommendations/next', {
      currentPage: { url: 'https://news.example.org/c' }, openTabs: [], recentHistory: [],
    }, { params: { now: T } }));
  expect(r.status, '[E2] 推荐返回 200').toBe(200);
  expect(r.body.recommendations, '[E2] 恰有一条推荐').toHaveLength(1);
  expect(r.body.recommendations[0], '[E2] 唯一候选使用同域策略，评分为 0.66').toMatchObject({
    url: 'https://news.example.org/a', strategy: 'same_domain', score: 0.66,
  });
  expect(r.body.recommendations[0].reason, '[E2] 理由包含同域名').toContain('同域名');
});
