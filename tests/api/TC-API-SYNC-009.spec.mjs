import { test, expect } from '../fixtures/api.mjs';

test('TC-API-SYNC-009 history 次数为零、缺省和一时最小入库值均为一', async ({ api }) => {
  const T = Date.now();
  const urls = ['https://example.com/count-zero', 'https://example.com/count-missing', 'https://example.com/count-one'];
  await test.step('S1：清空后端状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });
  const r = await test.step('S2：同步零、缺省和一三种次数', async () => {
    const r = await api.post('/api/sync', { activeTab: null, openTabs: [], history: [
      { url: urls[0], visitCount: 0, lastVisitTime: T - 600_000 },
      { url: urls[1], lastVisitTime: T - 600_000 },
      { url: urls[2], visitCount: 1, lastVisitTime: T - 600_000 },
    ] });
    expect(r.status, '[E2] 同步返回 200').toBe(200);
    expect(r.body, '[E2] 三条观测创建三页').toMatchObject({ received: 3, created: 3, updated: 0, rejected: 0, pageCount: 3 });
    return r;
  });
  await test.step('S3：完整回读并核对最小次数和历史时间', async () => {
    const g = await api.get('/api/pages/ranked', { params: { limit: 500, now: r.body.syncedAt } });
    const health = await api.get('/api/health');
    expect(g.status, '[E3] ranked 返回 200').toBe(200);
    expect(g.body.total, '[E3] 总数为 3').toBe(3);
    expect(g.body.pages.map((p) => p.url).sort(), '[E3] 完整包含三种输入').toEqual([...urls].sort());
    expect(g.body.pages.map((p) => p.visitCount), '[E3] 每页次数均为 1').toEqual([1, 1, 1]);
    expect(g.body.pages.map((p) => ({ lastVisitedAt: p.lastVisitedAt, sources: p.sources })), '[E4] 三页使用原历史时间和来源').toEqual(urls.map(() => ({ lastVisitedAt: T - 600_000, sources: ['history'] })));
    expect(health.status, '[E4] health 返回 200').toBe(200);
    expect(health.body.pageCount, '[E4] 后端共三页').toBe(3);
  });
});
