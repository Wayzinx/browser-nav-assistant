import { test, expect, samplePayload } from '../fixtures/api.mjs';

const stablePages = (pages) => pages.map(({ id, normalizedUrl, sources, visitCount, lastVisitedAt, firstSeenAt, title }) => ({
  id, normalizedUrl, sources: [...sources].sort(), visitCount, lastVisitedAt, firstSeenAt, title,
})).sort((a, b) => a.normalizedUrl.localeCompare(b.normalizedUrl));

test('TC-API-SYNC-015 缺省空快照关闭所有页但保留页面字段', async ({ api }) => {
  await test.step('S1：清空后端状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });
  const before = await test.step('S2：导入样例并保存全部页面字段', async () => {
    const r = await api.post('/api/sync', samplePayload({ now: Date.now() }));
    expect(r.status, '[E4] 空快照前导入成功').toBe(200);
    const g = await api.get('/api/pages/ranked', { params: { limit: 500, now: r.body.syncedAt } });
    expect(g.status, '[E4] 空快照前完整回读成功').toBe(200);
    expect(g.body.pages, '[E4] 比较基线包含十页').toHaveLength(10);
    return stablePages(g.body.pages);
  });
  await test.step('S3：提交空对象并回读关闭状态及稳定字段', async () => {
    const r = await api.post('/api/sync', {});
    expect(r.status, '[E2] 空对象同步返回 200').toBe(200);
    expect(r.body, '[E2] 零观测不删除十页').toMatchObject({ received: 0, created: 0, updated: 0, rejected: 0, pageCount: 10 });
    const g = await api.get('/api/pages/ranked', { params: { limit: 500, now: r.body.syncedAt } });
    const health = await api.get('/api/health');
    expect(g.status, '[E3] 空快照后回读成功').toBe(200);
    expect(g.body.total, '[E3] 页面总数仍为十').toBe(10);
    expect(g.body.pages.map((p) => ({ isOpen: p.isOpen, isActive: p.isActive })), '[E3] 十页全部关闭且未激活').toEqual(Array.from({ length: 10 }, () => ({ isOpen: false, isActive: false })));
    expect(stablePages(g.body.pages), '[E4] ID、来源、次数、时间与标题均未变化').toEqual(before);
    expect(health.status, '[E5] health 返回 200').toBe(200);
    expect(health.body, '[E5] 保留十页并记录新同步时间').toMatchObject({ pageCount: 10, lastSyncAt: r.body.syncedAt });
  });
});
