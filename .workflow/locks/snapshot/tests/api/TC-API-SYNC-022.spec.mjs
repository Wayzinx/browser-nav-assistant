import { test, expect } from '../fixtures/api.mjs';

test('TC-API-SYNC-022 单条 javascript URL 拒收但合法 HTTPS 历史入库', async ({ api }) => {
  await test.step('S1：清空后端状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });
  const r = await test.step('S2：同时提交 javascript 与合法 HTTPS 历史', async () => {
    const time = Date.now() - 600_000;
    const r = await api.post('/api/sync', { activeTab: null, openTabs: [], history: [
      { url: 'javascript:alert(1)', title: 'Invalid', lastVisitTime: time, visitCount: 1 },
      { url: 'https://example.com/ok', title: 'OK page', lastVisitTime: time, visitCount: 1 },
    ] });
    expect(r.status, '[E2] 单条坏 URL 不导致整个请求 400').toBe(200);
    expect(r.body, '[E2] 两条观测只接收合法一页').toMatchObject({ ok: true, received: 2, created: 1, updated: 0, rejected: 1, pageCount: 1 });
    expect(r.body.rejectedByReason, '[E3] 准确记录一条 invalid_url').toEqual({ invalid_url: 1, privacy: 0 });
    return r;
  });
  await test.step('S3：回读合法页并核对拒收无残留', async () => {
    const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: r.body.syncedAt } });
    const health = await api.get('/api/health');
    expect(ranked.status, '[E4] ranked 返回 200').toBe(200);
    expect(ranked.body.total, '[E4] 仅保存一页').toBe(1);
    expect(ranked.body.pages, '[E4] 唯一合法页的规范 URL 和标题正确').toMatchObject([{ normalizedUrl: 'https://example.com/ok', title: 'OK page' }]);
    expect(ranked.body.pages.filter((p) => p.url.startsWith('javascript:')), '[E5] 没有 javascript 页面').toHaveLength(0);
    expect(health.status, '[E5] health 返回 200').toBe(200);
    expect(health.body.pageCount, '[E5] 健康状态仅一页').toBe(1);
  });
});
