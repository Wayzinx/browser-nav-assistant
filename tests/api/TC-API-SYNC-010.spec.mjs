import { test, expect } from '../fixtures/api.mjs';

test('TC-API-SYNC-010 新历史的空标题回退为原始 URL', async ({ api }) => {
  const T = Date.now();
  const url = 'https://example.com/a';
  await test.step('S1：清空后端状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });
  const r = await test.step('S2：同步一条空标题历史', async () => {
    const r = await api.post('/api/sync', { activeTab: null, openTabs: [], history: [{ url, title: '', visitCount: 1, lastVisitTime: T - 600_000 }] });
    expect(r.status, '[E2] 同步返回 200').toBe(200);
    expect(r.body, '[E2] 创建一页且没有拒收').toMatchObject({ received: 1, created: 1, updated: 0, rejected: 0, pageCount: 1 });
    return r;
  });
  await test.step('S3：回读标题和历史属性', async () => {
    const g = await api.get('/api/pages/ranked', { params: { limit: 500, now: r.body.syncedAt } });
    const health = await api.get('/api/health');
    expect(g.status, '[E3] ranked 返回 200').toBe(200);
    expect(g.body.total, '[E3] 共一页').toBe(1);
    expect(g.body.pages, '[E3] 唯一页面标题等于原始 URL').toMatchObject([{ url, title: url }]);
    expect(g.body.pages[0], '[E4] 保留历史次数、时间与来源').toMatchObject({ visitCount: 1, lastVisitedAt: T - 600_000, sources: ['history'] });
    expect(health.status, '[E4] health 返回 200').toBe(200);
    expect(health.body.pageCount, '[E4] 后端共一页').toBe(1);
  });
});
