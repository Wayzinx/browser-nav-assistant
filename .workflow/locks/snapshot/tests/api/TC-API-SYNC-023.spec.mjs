import { test, expect } from '../fixtures/api.mjs';

test('TC-API-SYNC-023 URL 长度 2048 接收、2049 拒收', async ({ api }) => {
  await test.step('S1：清空后端状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });
  const { r, short, long } = await test.step('S2：构造并校验 URL 长度后同步', async () => {
    const prefix = 'https://example.com/';
    const short = prefix + 'a'.repeat(2048 - prefix.length);
    const long = short + 'b';
    expect(short.length, '[E2] 接收边界 URL 恰为 2048 字符').toBe(2048);
    expect(long.length, '[E2] 拒收边界 URL 恰为 2049 字符').toBe(2049);
    const time = Date.now() - 600_000;
    const r = await api.post('/api/sync', { activeTab: null, openTabs: [], history: [short, long].map((url) => ({ url, lastVisitTime: time, visitCount: 1 })) });
    expect(r.status, '[E2] 长度边界同步返回 200').toBe(200);
    expect(r.body, '[E2] 一条接收、一条拒收').toMatchObject({ received: 2, created: 1, updated: 0, rejected: 1, pageCount: 1 });
    expect(r.body.rejectedByReason, '[E3] 超长 URL 计入 invalid_url').toEqual({ invalid_url: 1, privacy: 0 });
    return { r, short, long };
  });
  await test.step('S3：回读合法长度主键并确认超长项无残留', async () => {
    const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: r.body.syncedAt } });
    const health = await api.get('/api/health');
    expect(ranked.status, '[E4] ranked 返回 200').toBe(200);
    expect(ranked.body.total, '[E4] 总数为一').toBe(1);
    expect(ranked.body.pages.map((p) => p.normalizedUrl), '[E4] 只保存 U2048 且不包含 U2049').toEqual([short]);
    expect(ranked.body.pages[0].normalizedUrl.length, '[E4] 入库主键长度仍为 2048').toBe(2048);
    expect(ranked.body.pages.map((p) => p.url), '[E4] 没有保存超长原始 URL').not.toContain(long);
    expect(health.status, '[E5] health 返回 200').toBe(200);
    expect(health.body.pageCount, '[E5] 超长记录未创建新页').toBe(1);
    expect(ranked.body.pages[0].visitCount, '[E5] 超长记录未更新合法页次数').toBe(1);
  });
});
