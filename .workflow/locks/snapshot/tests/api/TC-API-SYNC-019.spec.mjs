import { test, expect } from '../fixtures/api.mjs';

test('TC-API-SYNC-019 history 恰好 500 条全部入库并完整回读', async ({ api }) => {
  await test.step('S1：清空后端状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });
  const { r, history } = await test.step('S2：生成并同步 500 条不同历史', async () => {
    const time = Date.now() - 600_000;
    const history = Array.from({ length: 500 }, (_, i) => ({ url: `https://example.com/history-${i}`, title: `History ${i}`, lastVisitTime: time, visitCount: 1 }));
    const r = await api.post('/api/sync', { activeTab: null, openTabs: [], history });
    expect(r.status, '[E2] 500 条历史返回 200').toBe(200);
    expect(r.body, '[E2] 500 条全部创建，没有丢弃').toMatchObject({ received: 500, created: 500, updated: 0, rejected: 0, pageCount: 500 });
    return { r, history };
  });
  await test.step('S3：limit=500 完整回读 URL 集合和健康状态', async () => {
    const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: r.body.syncedAt } });
    const health = await api.get('/api/health');
    expect(ranked.status, '[E3] ranked 返回 200').toBe(200);
    expect(ranked.body.total, '[E3] total 为 500').toBe(500);
    expect(ranked.body.pages, '[E3] 完整返回 500 页').toHaveLength(500);
    expect(ranked.body.pages.map((p) => p.normalizedUrl).sort(), '[E3] 全部 500 个规范 URL 与输入相等').toEqual(history.map((p) => p.url).sort());
    expect(health.status, '[E4] health 返回 200').toBe(200);
    expect(health.body.pageCount, '[E4] 第 500 条没有被当作超限丢弃').toBe(500);
  });
});
