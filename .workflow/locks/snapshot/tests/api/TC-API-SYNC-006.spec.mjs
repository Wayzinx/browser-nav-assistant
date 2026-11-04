import { test, expect } from '../fixtures/api.mjs';

test('TC-API-SYNC-006 首次同步空上下文不生成页面', async ({ api }) => {
  await test.step('S1：清空后端状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });
  const r = await test.step('S2：同步显式空上下文', async () => {
    const r = await api.post('/api/sync', { activeTab: null, openTabs: [], history: [] });
    expect(r.status, '[E2] 同步返回 200').toBe(200);
    expect(r.body, '[E2] 同步成功且默认 full').toMatchObject({ ok: true, mode: 'full' });
    expect(r.body, '[E3] 零观测、零页面、零拒收').toMatchObject({ received: 0, created: 0, updated: 0, rejected: 0, pageCount: 0, rejectedByReason: { invalid_url: 0, privacy: 0 } });
    expect(r.body.rejectedByReason, '[E3] 拒收原因计数恰为两项零值').toEqual({ invalid_url: 0, privacy: 0 });
    return r;
  });
  await test.step('S3：回读空页面集和本次同步时间', async () => {
    const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: r.body.syncedAt } });
    const health = await api.get('/api/health');
    expect(ranked.status, '[E4] ranked 返回 200').toBe(200);
    expect(ranked.body.pages, '[E4] 不生成页面或虚构来源').toEqual([]);
    expect(ranked.body.total, '[E4] total 为 0').toBe(0);
    expect(health.status, '[E5] health 返回 200').toBe(200);
    expect(health.body, '[E5] 空库也记录本次同步时间').toMatchObject({ pageCount: 0, lastSyncAt: r.body.syncedAt });
  });
});
