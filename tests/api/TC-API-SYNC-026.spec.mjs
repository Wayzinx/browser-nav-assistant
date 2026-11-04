import { test, expect } from '../fixtures/api.mjs';

test('TC-API-SYNC-026 未来十分钟历史按服务器同步时间截断', async ({ api }) => {
  await test.step('S1：清空后端状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });
  const { r, T } = await test.step('S2：记录当前时间并提交未来十分钟的历史', async () => {
    const T = Date.now();
    const r = await api.post('/api/sync', { activeTab: null, openTabs: [], history: [{ url: 'https://example.com/future', title: 'Future', visitCount: 8, lastVisitTime: T + 600_000 }] });
    expect(r.status, '[E2] 时钟偏差记录仍返回 200').toBe(200);
    expect(r.body, '[E2] 接收一条并创建一页').toMatchObject({ received: 1, created: 1, updated: 0, rejected: 0, pageCount: 1 });
    return { r, T };
  });
  await test.step('S3：以本次服务器时间回读并核对截断结果', async () => {
    const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: r.body.syncedAt } });
    const health = await api.get('/api/health');
    expect(ranked.status, '[E3] ranked 返回 200').toBe(200);
    expect(ranked.body.pages, '[E3] 唯一页面首次和最近时间均截断到 syncedAt').toMatchObject([{ lastVisitedAt: r.body.syncedAt, firstSeenAt: r.body.syncedAt }]);
    expect(ranked.body.pages[0].lastVisitedAt, '[E3] 不保留未来十分钟的时间').not.toBe(T + 600_000);
    expect(ranked.body.pages[0], '[E4] 历史次数和来源不受时钟截断影响').toMatchObject({ visitCount: 8, sources: ['history'], isOpen: false, isActive: false });
    expect(health.status, '[E5] health 返回 200').toBe(200);
    expect(health.body, '[E5] 健康状态与本次同步一致').toMatchObject({ pageCount: 1, lastSyncAt: r.body.syncedAt });
  });
});
