import { test, expect } from '../fixtures/api.mjs';

const URLS = ['https://github.com/org/repo/issues/123', 'https://github.com/org/repo/issues/123?tab=comments'];

test('TC-API-SYNC-005 保留业务 query 对应的独立页面', async ({ api }) => {
  await test.step('S1：清空后端状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });
  const r = await test.step('S2：同步有无 tab=comments 的两条历史', async () => {
    const r = await api.post('/api/sync', { activeTab: null, openTabs: [], history: URLS.map((url) => ({ url, lastVisitTime: Date.now() - 300_000, visitCount: 1 })) });
    expect(r.status, '[E2] 同步返回 200').toBe(200);
    expect(r.body, '[E2] 两个业务 URL 各创建一页').toMatchObject({ received: 2, created: 2, updated: 0, rejected: 0, pageCount: 2 });
    return r;
  });
  await test.step('S3：回读两个独立主键', async () => {
    const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: r.body.syncedAt } });
    const health = await api.get('/api/health');
    expect(ranked.status, '[E3] ranked 返回 200').toBe(200);
    expect(ranked.body.total, '[E3] total 为 2').toBe(2);
    expect(ranked.body.pages.map((p) => p.normalizedUrl).sort(), '[E3] normalizedUrl 保留业务 query').toEqual([...URLS].sort());
    expect(health.status, '[E4] health 返回 200').toBe(200);
    expect(health.body.pageCount, '[E4] 业务 query 没有被合并').toBe(2);
  });
});
