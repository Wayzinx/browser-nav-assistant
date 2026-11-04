import { test, expect, samplePayload } from '../fixtures/api.mjs';

const PULL = 'https://github.com/org/repo/pull/456';
const ISSUE = 'https://github.com/org/repo/issues/123';
const FETCH = 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API';
const DOC = 'https://docs.internal.com/ai-agent-design';

test('TC-API-SYNC-013 最新快照自动关闭旧文档并保留活动页', async ({ api }) => {
  await test.step('S1：清空后端状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });
  const payload = await test.step('S2：导入样例并回读初始打开状态', async () => {
    const payload = samplePayload({ now: Date.now() });
    const r = await api.post('/api/sync', payload);
    expect(r.status, '[E2] 首次同步成功').toBe(200);
    const g = await api.get('/api/pages/ranked', { params: { limit: 500, now: r.body.syncedAt } });
    expect(g.status, '[E2] 首次回读成功').toBe(200);
    expect(g.body.pages.find((p) => p.url === DOC).isOpen, '[E2] 文档最初打开').toBe(true);
    expect(g.body.pages.find((p) => p.url === PULL).isActive, '[E2] pull 最初激活').toBe(true);
    return payload;
  });
  await test.step('S3：只保留两个 openTabs 和原 activeTab 并回读', async () => {
    const r = await api.post('/api/sync', { activeTab: payload.activeTab, openTabs: payload.openTabs.filter((p) => [ISSUE, FETCH].includes(p.url)), history: [] });
    expect(r.status, '[E3] 第二批返回 200').toBe(200);
    expect(r.body, '[E3] 三条观测只更新已有页').toMatchObject({ received: 3, created: 0, updated: 3, rejected: 0, pageCount: 10 });
    const g = await api.get('/api/pages/ranked', { params: { limit: 500, now: r.body.syncedAt } });
    const health = await api.get('/api/health');
    expect(g.status, '[E4] 第二批回读成功').toBe(200);
    expect(g.body.pages.find((p) => p.url === DOC).isOpen, '[E4] 旧文档已关闭').toBe(false);
    expect(g.body.pages.find((p) => p.url === ISSUE).isOpen, '[E4] issue 仍打开').toBe(true);
    expect(g.body.pages.find((p) => p.url === FETCH).isOpen, '[E4] Fetch 仍打开').toBe(true);
    expect(g.body.pages.filter((p) => p.isOpen).map((p) => p.url).sort(), '[E5] 打开集合恰为三个 URL').toEqual([PULL, ISSUE, FETCH].sort());
    expect(g.body.pages.filter((p) => p.isActive).map((p) => p.url), '[E5] 活动集合恰为 pull').toEqual([PULL]);
    expect(g.body.total, '[E6] ranked 总数仍为十').toBe(10);
    expect(health.status, '[E6] health 返回 200').toBe(200);
    expect(health.body.pageCount, '[E6] 关闭页面不删除记录').toBe(10);
  });
});
