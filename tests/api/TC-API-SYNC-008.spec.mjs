import { test, expect } from '../fixtures/api.mjs';

const U = 'https://example.com/merge';

test('TC-API-SYNC-008 次数取 max、首次时间取 min 且空标题不覆盖', async ({ api }) => {
  const T = Date.now();
  await test.step('S1：清空后端状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });
  const first = await test.step('S2：同步次数 8 和 Original 标题并回读', async () => {
    const r = await api.post('/api/sync', { history: [{ url: U, title: 'Original', visitCount: 8, lastVisitTime: T - 600_000 }] });
    expect(r.status, '[E2] 首次同步返回 200').toBe(200);
    expect(r.body, '[E2] 首次只创建一页').toMatchObject({ created: 1, updated: 0, pageCount: 1 });
    const g = await api.get('/api/pages/ranked', { params: { limit: 500, now: r.body.syncedAt } });
    expect(g.status, '[E3] 首次回读成功').toBe(200);
    expect(g.body.pages, '[E3] 唯一页面初始值正确').toMatchObject([{ url: U, visitCount: 8, lastVisitedAt: T - 600_000, firstSeenAt: T - 600_000, title: 'Original' }]);
    return g.body.pages[0];
  });
  const second = await test.step('S3：同步较小次数、更早时间和空标题并回读', async () => {
    const r = await api.post('/api/sync', { history: [{ url: U, title: '', visitCount: 2, lastVisitTime: T - 1_200_000 }] });
    expect(r.status, '[E2] 第二次同步返回 200').toBe(200);
    expect(r.body, '[E2] 第二次只更新一页').toMatchObject({ created: 0, updated: 1, pageCount: 1 });
    const g = await api.get('/api/pages/ranked', { params: { limit: 500, now: r.body.syncedAt } });
    expect(g.status, '[E4] 第二次回读成功').toBe(200);
    expect(g.body.pages, '[E4] 次数和最近时间不倒退，首次时间前移且保留标题').toMatchObject([{ url: U, visitCount: 8, lastVisitedAt: T - 600_000, firstSeenAt: T - 1_200_000, title: 'Original' }]);
    return g.body.pages[0];
  });
  await test.step('S4：同步较新历史和 New 标题并核对三次主键', async () => {
    const r = await api.post('/api/sync', { history: [{ url: U, title: 'New', visitCount: 12, lastVisitTime: T - 300_000 }] });
    expect(r.status, '[E2] 第三次同步返回 200').toBe(200);
    expect(r.body, '[E2] 第三次只更新一页').toMatchObject({ created: 0, updated: 1, pageCount: 1 });
    const g = await api.get('/api/pages/ranked', { params: { limit: 500, now: r.body.syncedAt } });
    const health = await api.get('/api/health');
    expect(g.status, '[E5] 第三次回读成功').toBe(200);
    expect(g.body.pages, '[E5] 次数和最近时间更新但首次时间保持最早值').toMatchObject([{ url: U, visitCount: 12, lastVisitedAt: T - 300_000, firstSeenAt: T - 1_200_000, title: 'New' }]);
    expect(first.id, '[E6] 首次获得服务端生成的页面 ID').toEqual(expect.any(String));
    expect([second.id, g.body.pages[0].id], '[E6] 三次页面 ID 相等').toEqual([first.id, first.id]);
    expect([first.sources, second.sources, g.body.pages[0].sources], '[E6] 始终只有历史来源').toEqual([['history'], ['history'], ['history']]);
    expect(health.status, '[E6] health 返回 200').toBe(200);
    expect(health.body.pageCount, '[E6] 健康状态仅一页').toBe(1);
  });
});
