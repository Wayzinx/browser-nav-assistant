// 来源：docs/trace/cases/API-REC.json；REC API，独立真实 HTTP 用例。
import { test, expect } from '../fixtures/api.mjs';

// S1 显式发送 JSON 重置请求，替代夹具在步骤外的自动重置。
test.use({ autoReset: false });

test("TC-API-REC-015 六个合格候选按最终分数和访问时间排序后截断为五条", async ({ api, evidence }) => {
  await test.step('S1：POST /api/__test__/reset，以 JSON 空对象重置数据与缓存', async () => {
    const r = await api.post('/api/__test__/reset', {}, { setup: true });
    expect(r.status, 'S1 重置返回 200').toBe(200);
    expect(r.body, 'S1 重置成功').toMatchObject({ ok: true });
  });

  const T = await test.step('S2：同步六个同仓库候选，各自访问时间相差一秒', async () => {
    const T = Date.now();
    const r = await api.seed({ activeTab: null, openTabs: [], history: Array.from({ length: 6 }, (_, i) => ({
      url: 'https://github.com/limit/repo/actions/runs/' + i, title: 'Run ' + i,
      lastVisitTime: T - 300000 - i * 1000, visitCount: 1,
    })) });
    expect(r.status, '[E1] 同步返回 200').toBe(200);
    expect(r.body, '[E1] 新建六条页面').toMatchObject({ created: 6, pageCount: 6 });
    evidence.note(JSON.stringify({ T, N: r.body.syncedAt }));
    return T;
  });
  const repo = await test.step('S3：以同仓库 PR 查询 Top 5', () =>
    api.post('/api/recommendations/next', {
      currentPage: { url: 'https://github.com/limit/repo/pull/999' }, openTabs: [], recentHistory: [],
    }, { params: { now: T } }));
  expect(repo.status, '[E2] 同仓库推荐返回 200').toBe(200);
  const expectedUrls = Array.from({ length: 5 }, (_, i) => 'https://github.com/limit/repo/actions/runs/' + i);
  expect(repo.body.recommendations.map(p => [p.url, p.strategy, p.score]), '[E2] 同分候选按访问时间取前五，分数为 0.92').toEqual(
    expectedUrls.map(url => [url, 'same_repo', 0.92]));
  const global = await test.step('S4：以 null 当前页查询全局 Top 5', () =>
    api.post('/api/recommendations/next', {
      currentPage: null, openTabs: [], recentHistory: [],
    }, { params: { now: T } }));
  expect(global.status, '[E3] 全局推荐返回 200').toBe(200);
  expect(global.body.recommendations.map(p => [p.url, p.strategy, p.score]), '[E3] 全局前五顺序相同，分数为 0.50').toEqual(
    expectedUrls.map(url => [url, 'global_top', 0.50]));
  expect(global.body.recommendations.map(p => p.url), '[E3] 全局与同仓库的 URL 顺序相同').toEqual(
    repo.body.recommendations.map(p => p.url));
  expect(repo.body.recommendations.map(p => p.url), '[E4] 同仓库结果截断第六条').not.toContain('https://github.com/limit/repo/actions/runs/5');
  expect(global.body.recommendations.map(p => p.url), '[E4] 全局结果截断第六条').not.toContain('https://github.com/limit/repo/actions/runs/5');
});
