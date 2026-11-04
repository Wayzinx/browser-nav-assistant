import { test, expect, samplePayload } from '../fixtures/api.mjs';

const LEARN = 'https://react.dev/learn';
const PULL = 'https://github.com/org/repo/pull/456';
const ISSUE = 'https://github.com/org/repo/issues/123';

test('TC-API-SYNC-011 历史页成为 openTab 后累积来源', async ({ api }) => {
  await test.step('S1：清空后端状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });
  await test.step('S2：导入样例并确认 learn 最初只有历史来源', async () => {
    const r = await api.post('/api/sync', samplePayload({ now: Date.now() }));
    expect(r.status, '[E2] 首次同步成功').toBe(200);
    const g = await api.get('/api/pages/ranked', { params: { limit: 500, now: r.body.syncedAt } });
    expect(g.status, '[E2] 首次回读成功').toBe(200);
    expect(g.body.pages.find((p) => p.url === LEARN), '[E2] learn 最初仅历史且未打开').toMatchObject({ sources: ['history'], isOpen: false });
  });
  await test.step('S3：只打开 learn 并回读累积来源', async () => {
    const r = await api.post('/api/sync', { activeTab: null, openTabs: [{ url: LEARN }], history: [] });
    expect(r.status, '[E3] 第二次同步返回 200').toBe(200);
    expect(r.body, '[E3] 只更新 learn 而不增加页面').toMatchObject({ received: 1, created: 0, updated: 1, rejected: 0, pageCount: 10 });
    const g = await api.get('/api/pages/ranked', { params: { limit: 500, now: r.body.syncedAt } });
    const health = await api.get('/api/health');
    expect(g.status, '[E4] 第二次回读成功').toBe(200);
    const learn = g.body.pages.find((p) => p.url === LEARN);
    expect([...learn.sources].sort(), '[E4] learn 累积两种来源').toEqual(['history', 'open_tab']);
    expect(learn.isOpen, '[E4] learn 当前打开').toBe(true);
    expect([...g.body.pages.find((p) => p.url === PULL).sources].sort(), '[E5] pull 历史来源不因关闭丢失').toEqual(['active_tab', 'history']);
    expect([...g.body.pages.find((p) => p.url === ISSUE).sources].sort(), '[E5] issue 保留历史和 open_tab').toEqual(['history', 'open_tab']);
    expect(g.body.pages, '[E5] 仍能回读全部十页').toHaveLength(10);
    for (const p of g.body.pages) {
      expect(p.sources.length, `[E5] ${p.url} 来源不重复`).toBe(new Set(p.sources).size);
    }
    expect(health.status, '[E6] health 返回 200').toBe(200);
    expect(health.body, '[E6] 页面总数和同步时间一致').toMatchObject({ pageCount: 10, lastSyncAt: r.body.syncedAt });
  });
});
