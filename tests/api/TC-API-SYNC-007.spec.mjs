import { test, expect, samplePayload } from '../fixtures/api.mjs';

const ISSUE = 'https://github.com/org/repo/issues/123';
const PULL = 'https://github.com/org/repo/pull/456';

test('TC-API-SYNC-007 重放同一份平移样例保持合并幂等', async ({ api }) => {
  await test.step('S1：清空后端状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });
  const { payload, before } = await test.step('S2：首次同步并保存各页 firstSeenAt', async () => {
    const payload = samplePayload({ now: Date.now() });
    const r = await api.post('/api/sync', payload);
    expect(r.status, '[E2] 首次同步返回 200').toBe(200);
    expect(r.body, '[E2] 首次统计正确').toMatchObject({ received: 14, created: 10, updated: 4, rejected: 0, pageCount: 10 });
    const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: r.body.syncedAt } });
    expect(ranked.status, '[E2] 首次回读成功').toBe(200);
    return { payload, before: ranked.body.pages };
  });
  const r = await test.step('S3：原样重放同一份请求', async () => {
    const r = await api.post('/api/sync', payload);
    expect(r.status, '[E3] 重放返回 200').toBe(200);
    expect(r.body, '[E3] 全部观测只更新已有页面').toMatchObject({ received: 14, created: 0, updated: 14, rejected: 0, pageCount: 10 });
    return r;
  });
  await test.step('S4：核对次数、首次时间、来源和最近访问时间', async () => {
    const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: r.body.syncedAt } });
    const health = await api.get('/api/health');
    expect(ranked.status, '[E4] 第二次回读成功').toBe(200);
    const issue = ranked.body.pages.find((p) => p.url === ISSUE);
    const pull = ranked.body.pages.find((p) => p.url === PULL);
    expect(issue.visitCount, '[E4] issue 次数仍为 8').toBe(8);
    expect(pull.visitCount, '[E4] pull 次数仍为 5').toBe(5);
    expect(ranked.body.total, '[E5] 页面总数仍为 10').toBe(10);
    expect(ranked.body.pages, '[E5] 完整回读 10 页').toHaveLength(10);
    const firstSeen = (pages) => pages.map((p) => [p.normalizedUrl, p.firstSeenAt]).sort(([a], [b]) => a.localeCompare(b));
    expect(firstSeen(ranked.body.pages), '[E5] 所有 firstSeenAt 与首次一致').toEqual(firstSeen(before));
    for (const p of ranked.body.pages) {
      expect(p.sources.length, `[E5] ${p.url} 来源无重复`).toBe(new Set(p.sources).size);
    }
    expect(issue.lastVisitedAt, '[E6] 历史页仍用原历史时间').toBe(payload.history.find((p) => p.url === ISSUE).lastVisitTime);
    expect(pull.lastVisitedAt, '[E6] 活动页使用第二次 syncedAt').toBe(r.body.syncedAt);
    expect(health.status, '[E7] health 返回 200').toBe(200);
    expect(health.body, '[E7] 健康状态更新到第二次同步').toMatchObject({ pageCount: 10, lastSyncAt: r.body.syncedAt });
  });
});
