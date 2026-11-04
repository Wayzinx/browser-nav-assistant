import { test, expect } from '../fixtures/api.mjs';

test('TC-API-SYNC-004 主机大小写、跟踪参数、hash 和尾斜杠归为同页', async ({ api }) => {
  await test.step('S1：清空后端状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });
  const r = await test.step('S2：上传两个形式不同的历史 URL', async () => {
    const time = Date.now() - 300_000;
    const r = await api.post('/api/sync', { activeTab: null, openTabs: [], history: [
      { url: 'https://GitHub.com/org/repo/issues/123/?utm_source=mail#c1', lastVisitTime: time, visitCount: 1 },
      { url: 'https://github.com/org/repo/issues/123', lastVisitTime: time, visitCount: 1 },
    ] });
    expect(r.status, '[E2] 同步返回 200').toBe(200);
    expect(r.body, '[E2] 两条历史只创建一页').toMatchObject({ received: 2, created: 1, updated: 1, rejected: 0, pageCount: 1 });
    return r;
  });
  await test.step('S3：回读规范 URL 和页面总数', async () => {
    const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: r.body.syncedAt } });
    const health = await api.get('/api/health');
    expect(ranked.status, '[E3] ranked 返回 200').toBe(200);
    expect(ranked.body.total, '[E3] total 为 1').toBe(1);
    expect(ranked.body.pages, '[E3] 只返回一页').toHaveLength(1);
    expect(ranked.body.pages[0].normalizedUrl, '[E3] 去除非业务 URL 差异').toBe('https://github.com/org/repo/issues/123');
    expect(health.status, '[E4] health 返回 200').toBe(200);
    expect(health.body.pageCount, '[E4] 没有生成第二条记录').toBe(1);
  });
});
