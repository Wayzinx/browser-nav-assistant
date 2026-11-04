import { test, expect } from '../fixtures/api.mjs';

test('TC-API-SYNC-020 history 超限 501 条整批拒绝且不部分写入', async ({ api }) => {
  const T = Date.now();
  await test.step('S1：清空后端状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });
  await test.step('S2：提交 501 条不同历史', async () => {
    const history = Array.from({ length: 501 }, (_, i) => ({ url: `https://example.com/overflow-${i}`, lastVisitTime: T - 600_000, visitCount: 1 }));
    const r = await api.post('/api/sync', { activeTab: null, openTabs: [], history });
    expect(r.status, '[E2] 超限返回 413').toBe(413);
    expect(r.body.error.code, '[E2] 错误码为 PAYLOAD_TOO_LARGE').toBe('PAYLOAD_TOO_LARGE');
    expect(r.body.error.message, '[E2] 错误消息非空').toMatch(/\S/);
  });
  await test.step('S3：回读空库确认未部分写入前 500 条', async () => {
    const health = await api.get('/api/health');
    const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: T } });
    expect(health.status, '[E3] health 返回 200').toBe(200);
    expect(health.body, '[E3] 未写入页面或同步时间').toMatchObject({ pageCount: 0, lastSyncAt: null });
    expect(ranked.status, '[E4] ranked 返回 200').toBe(200);
    expect(ranked.body.total, '[E4] total 为零').toBe(0);
    expect(ranked.body.pages, '[E4] 没有部分写入页面').toEqual([]);
  });
});
