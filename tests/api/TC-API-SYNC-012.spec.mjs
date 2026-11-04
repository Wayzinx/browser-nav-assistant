import { test, expect } from '../fixtures/api.mjs';

const U = 'https://example.com/sources';

test('TC-API-SYNC-012 重复 openTab、活动页和关闭后来源只累积三种', async ({ api }) => {
  await test.step('S1：清空后端状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });
  await test.step('S2：同步第一批历史并回读来源', async () => {
    const r = await api.post('/api/sync', { history: [{ url: U, lastVisitTime: Date.now() - 600_000, visitCount: 1 }] });
    expect(r.status, '[E2] 第一批返回 200').toBe(200);
    expect(r.body.pageCount, '[E2] 只创建一页').toBe(1);
    const g = await api.get('/api/pages/ranked', { params: { limit: 500, now: r.body.syncedAt } });
    expect(g.status, '[E2] 第一批回读成功').toBe(200);
    expect(g.body.pages, '[E2] 第一批只有历史来源').toMatchObject([{ url: U, sources: ['history'] }]);
  });
  await test.step('S3：同页重复 openTab 并设为 active 后回读', async () => {
    const r = await api.post('/api/sync', { activeTab: { url: U }, openTabs: [{ url: U }, { url: U }], history: [] });
    expect(r.status, '[E3] 第二批返回 200').toBe(200);
    expect(r.body, '[E3] 三次重复观测只更新已有页').toMatchObject({ received: 3, created: 0, updated: 3, rejected: 0, pageCount: 1 });
    const g = await api.get('/api/pages/ranked', { params: { limit: 500, now: r.body.syncedAt } });
    expect(g.status, '[E4] 第二批回读成功').toBe(200);
    expect(g.body.pages, '[E4] 仍然只有一页').toHaveLength(1);
    expect([...g.body.pages[0].sources].sort(), '[E4] 来源恰为三种且不重复').toEqual(['active_tab', 'history', 'open_tab']);
    expect(g.body.pages[0].sources, '[E4] 来源数量为三').toHaveLength(3);
  });
  await test.step('S4：空快照关闭页面后回读累积来源', async () => {
    const r = await api.post('/api/sync', { activeTab: null, openTabs: [], history: [] });
    expect(r.status, '[E5] 第三批返回 200').toBe(200);
    expect(r.body, '[E5] 零观测保留原页面').toMatchObject({ received: 0, created: 0, updated: 0, rejected: 0, pageCount: 1 });
    const g = await api.get('/api/pages/ranked', { params: { limit: 500, now: r.body.syncedAt } });
    const health = await api.get('/api/health');
    expect(g.status, '[E6] 第三批回读成功').toBe(200);
    expect(g.body.pages, '[E6] 页面关闭后仍保留记录').toMatchObject([{ url: U, isOpen: false, isActive: false }]);
    expect([...g.body.pages[0].sources].sort(), '[E6] 关闭不删除三种历史来源').toEqual(['active_tab', 'history', 'open_tab']);
    expect(g.body.pages[0].sources, '[E6] 来源数保持三').toHaveLength(3);
    expect(health.status, '[E6] health 返回 200').toBe(200);
    expect(health.body.pageCount, '[E6] 健康状态仍为一页').toBe(1);
  });
});
