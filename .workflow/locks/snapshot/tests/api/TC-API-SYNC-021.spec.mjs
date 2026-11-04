import { test, expect } from '../fixtures/api.mjs';

test('TC-API-SYNC-021 openTabs 从 500 到 501 时保留上次合法快照', async ({ api }) => {
  await test.step('S1：清空后端状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });
  const before = await test.step('S2：同步 500 个打开页并保存快照', async () => {
    const openTabs = Array.from({ length: 500 }, (_, i) => ({ url: `https://example.com/tab-${i}`, title: `Tab ${i}` }));
    const r = await api.post('/api/sync', { activeTab: null, openTabs, history: [] });
    expect(r.status, '[E2] 500 个标签页返回 200').toBe(200);
    expect(r.body, '[E2] 全部 500 页入库').toMatchObject({ received: 500, created: 500, updated: 0, rejected: 0, pageCount: 500 });
    const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: r.body.syncedAt } });
    const health = await api.get('/api/health');
    expect(ranked.status, '[E3] 基线回读成功').toBe(200);
    expect(ranked.body.pages, '[E3] 基线返回 500 页').toHaveLength(500);
    expect(ranked.body.pages.map((p) => p.normalizedUrl).sort(), '[E3] 回读集合与 500 个标签一致').toEqual(openTabs.map((p) => p.url).sort());
    expect(ranked.body.pages.map((p) => ({ isOpen: p.isOpen, isActive: p.isActive, sources: p.sources })), '[E3] 全部打开、未激活且只有 open_tab 来源').toEqual(openTabs.map(() => ({ isOpen: true, isActive: false, sources: ['open_tab'] })));
    expect(health.status, '[E5] 基线 health 读取成功').toBe(200);
    return { openTabs, syncedAt: r.body.syncedAt, ranked: ranked.body, health: health.body };
  });
  const extra = 'https://example.com/tab-overflow';
  await test.step('S3：追加第 501 个标签页', async () => {
    const r = await api.post('/api/sync', { activeTab: null, openTabs: [...before.openTabs, { url: extra }], history: [] });
    expect(r.status, '[E4] 501 个标签页返回 413').toBe(413);
    expect(r.body.error.code, '[E4] 错误码为 PAYLOAD_TOO_LARGE').toBe('PAYLOAD_TOO_LARGE');
    expect(r.body.error.message, '[E4] 错误消息非空').toMatch(/\S/);
  });
  await test.step('S4：固定原 now 回读，确认超限未改变旧快照', async () => {
    const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: before.syncedAt } });
    const health = await api.get('/api/health');
    expect(ranked.status, '[E5] 超限后页面回读成功').toBe(200);
    expect(health.status, '[E5] 超限后 health 读取成功').toBe(200);
    expect(ranked.body, '[E5] 页面内容及打开状态深度不变').toEqual(before.ranked);
    expect(health.body, '[E5] 健康快照深度不变').toEqual(before.health);
    expect(health.body, '[E5] 保留 500 页与原同步时间').toMatchObject({ pageCount: 500, lastSyncAt: before.syncedAt });
    expect(ranked.body.pages.map((p) => p.url), '[E5] 第 501 个 URL 不存在').not.toContain(extra);
  });
});
