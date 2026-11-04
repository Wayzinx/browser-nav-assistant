import { test, expect } from '../fixtures/api.mjs';

test('TC-API-SYNC-028 query 换序和跟踪参数归一化但保留业务值差异', async ({ api }) => {
  await test.step('S1：清空后端状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });
  const r = await test.step('S2：上传 query 换序、带跟踪参数及业务值变化的三条历史', async () => {
    const time = Date.now() - 600_000;
    const urls = [
      'https://Example.com/a/?b=2&utm_source=mail&a=1#c1',
      'https://example.com/a?a=1&b=2',
      'https://example.com/a?b=3&a=1',
    ];
    const r = await api.post('/api/sync', { activeTab: null, openTabs: [], history: urls.map((url) => ({ url, lastVisitTime: time, visitCount: 1 })) });
    expect(r.status, '[E2] 同步返回 200').toBe(200);
    expect(r.body, '[E2] 仅业务值变化时创建第二页').toMatchObject({ received: 3, created: 2, updated: 1, rejected: 0, pageCount: 2 });
    return r;
  });
  await test.step('S3：回读业务 query 对应的两个规范主键', async () => {
    const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: r.body.syncedAt } });
    const health = await api.get('/api/health');
    expect(ranked.status, '[E3] ranked 返回 200').toBe(200);
    expect(ranked.body.total, '[E3] 总数为二').toBe(2);
    expect(ranked.body.pages.map((p) => p.normalizedUrl).sort(), '[E3] 两个主键保留真实业务差异').toEqual(['https://example.com/a?a=1&b=2', 'https://example.com/a?a=1&b=3']);
    expect(health.status, '[E4] health 返回 200').toBe(200);
    expect(health.body.pageCount, '[E4] 不因参数顺序或非业务差异多建页').toBe(2);
  });
});
