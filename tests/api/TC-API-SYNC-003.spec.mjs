import { test, expect, samplePayload } from '../fixtures/api.mjs';

const ISSUE = 'https://github.com/org/repo/issues/123';
const PULL = 'https://github.com/org/repo/pull/456';
const LEARN = 'https://react.dev/learn';

test('TC-API-SYNC-003 D-01 平移样例首次导入并保留时间和来源', async ({ api }) => {
  await test.step('S1：清空后端状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });
  const payload = await test.step('S2：构造 D-01 平移样例并保留历史时间', async () => samplePayload({ now: Date.now() }));
  const r = await test.step('S3：首次同步平移样例', async () => {
    const r = await api.post('/api/sync', payload);
    expect(r.status, '[E2] 同步返回 200').toBe(200);
    expect(r.body, '[E2] 同步成功且默认 full').toMatchObject({ ok: true, mode: 'full' });
    expect(Number.isInteger(r.body.syncedAt), '[E2] syncedAt 是整数').toBe(true);
    expect(r.body.syncedAt, '[E2] syncedAt 为正毫秒时间').toBeGreaterThan(0);
    expect(r.body, '[E3] 14 条观测合并为 10 页').toMatchObject({ received: 14, created: 10, updated: 4, rejected: 0, pageCount: 10 });
    expect(r.body.rejectedByReason, '[E4] 两种拒收计数均为零').toEqual({ invalid_url: 0, privacy: 0 });
    return r;
  });
  await test.step('S4：回读全部页面并核对时间、次数、来源及健康状态', async () => {
    const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: r.body.syncedAt } });
    const health = await api.get('/api/health');
    expect(ranked.status, '[E5] ranked 返回 200').toBe(200);
    expect(ranked.body.total, '[E5] total 为 10').toBe(10);
    expect(ranked.body.pages, '[E5] 返回 10 页').toHaveLength(10);
    const urls = [...new Set([payload.activeTab, ...payload.openTabs, ...payload.history].map((p) => p.url))].sort();
    expect(ranked.body.pages.map((p) => p.normalizedUrl).sort(), '[E5] 规范 URL 集合恰为样例十个业务 URL，保留 tab=comments').toEqual(urls);
    const issue = ranked.body.pages.find((p) => p.url === ISSUE);
    const pull = ranked.body.pages.find((p) => p.url === PULL);
    const learn = ranked.body.pages.find((p) => p.url === LEARN);
    expect(issue, '[E6] issue 次数和历史访问时间准确').toMatchObject({ visitCount: 8, lastVisitedAt: payload.history.find((p) => p.url === ISSUE).lastVisitTime });
    expect(pull, '[E7] 活动页次数为 5 且本次同步时间覆盖历史时间').toMatchObject({ visitCount: 5, lastVisitedAt: r.body.syncedAt, isActive: true });
    expect([...pull.sources].sort(), '[E8] pull 来源恰为 active_tab 和 history').toEqual(['active_tab', 'history']);
    expect([...issue.sources].sort(), '[E9] issue 来源恰为 history 和 open_tab').toEqual(['history', 'open_tab']);
    expect(learn, '[E10] learn 只有历史来源且未打开').toMatchObject({ sources: ['history'], isOpen: false });
    expect(health.status, '[E11] health 返回 200').toBe(200);
    expect(health.body, '[E11] 健康状态与本次同步一致').toMatchObject({ pageCount: 10, lastSyncAt: r.body.syncedAt });
  });
});
