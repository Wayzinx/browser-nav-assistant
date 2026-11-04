import { test, expect, samplePayload } from '../fixtures/api.mjs';

const PULL = 'https://github.com/org/repo/pull/456';
const ISSUE = 'https://github.com/org/repo/issues/123';
const FETCH = 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API';
const DOC = 'https://docs.internal.com/ai-agent-design';

test('TC-API-SYNC-014 activeTab=null 清除原活动页的打开和激活状态', async ({ api }) => {
  await test.step('S1：清空后端状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });
  const payload = await test.step('S2：导入样例并记录原活动页', async () => {
    const payload = samplePayload({ now: Date.now() });
    const r = await api.post('/api/sync', payload);
    expect(r.status, '[E2] 首次同步成功').toBe(200);
    const g = await api.get('/api/pages/ranked', { params: { limit: 500, now: r.body.syncedAt } });
    expect(g.status, '[E2] 首次回读成功').toBe(200);
    expect(g.body.pages.find((p) => p.url === PULL), '[E2] pull 最初打开且激活').toMatchObject({ isOpen: true, isActive: true });
    expect(g.body.pages.find((p) => p.url === DOC).isOpen, '[E2] 旧文档最初打开').toBe(true);
    return payload;
  });
  await test.step('S3：同步 null 活动页和两个打开页并回读', async () => {
    const r = await api.post('/api/sync', { activeTab: null, openTabs: payload.openTabs.filter((p) => [ISSUE, FETCH].includes(p.url)), history: [] });
    expect(r.status, '[E3] 第二批返回 200').toBe(200);
    expect(r.body, '[E3] 两条观测只更新已有页').toMatchObject({ received: 2, created: 0, updated: 2, rejected: 0, pageCount: 10 });
    const g = await api.get('/api/pages/ranked', { params: { limit: 500, now: r.body.syncedAt } });
    const health = await api.get('/api/health');
    expect(g.status, '[E4] 第二批回读成功').toBe(200);
    expect(g.body.pages.find((p) => p.url === PULL), '[E4] 原活动页关闭且不再激活').toMatchObject({ isOpen: false, isActive: false });
    expect(g.body.pages.find((p) => p.url === DOC).isOpen, '[E4] 旧文档已关闭').toBe(false);
    expect(g.body.pages.filter((p) => p.isOpen).map((p) => p.url).sort(), '[E5] 只保留两个打开 URL').toEqual([ISSUE, FETCH].sort());
    expect(g.body.pages.filter((p) => p.isActive), '[E5] 没有活动页').toHaveLength(0);
    expect(health.status, '[E6] health 返回 200').toBe(200);
    expect(health.body, '[E6] 保留十页并更新同步时间').toMatchObject({ pageCount: 10, lastSyncAt: r.body.syncedAt });
  });
});
