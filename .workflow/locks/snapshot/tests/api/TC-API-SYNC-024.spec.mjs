import { test, expect, samplePayload } from '../fixtures/api.mjs';

test('TC-API-SYNC-024 text/plain 返回 415 且页面和同步时间不变', async ({ api }) => {
  await test.step('S1：清空后端状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });
  const before = await test.step('S2：导入样例并保存完整快照', async () => {
    const r = await api.post('/api/sync', samplePayload({ now: Date.now() }));
    expect(r.status, '[E3] 基线同步成功').toBe(200);
    const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: r.body.syncedAt } });
    const health = await api.get('/api/health');
    expect(ranked.status, '[E3] 基线页面读取成功').toBe(200);
    expect(health.status, '[E3] 基线 health 读取成功').toBe(200);
    expect(health.body.pageCount, '[E3] 基线共十页').toBe(10);
    return { syncedAt: r.body.syncedAt, ranked: ranked.body, health: health.body };
  });
  await test.step('S3：以 text/plain 原样提交空对象 JSON 字节', async () => {
    const r = await api.raw('POST', '/api/sync', '{}', 'text/plain');
    expect(r.status, '[E2] 不支持的 Content-Type 返回 415').toBe(415);
    expect(r.body.error.code, '[E2] 错误码为 UNSUPPORTED_MEDIA_TYPE').toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(r.body.error.message, '[E2] 错误消息非空').toMatch(/\S/);
  });
  await test.step('S4：固定原 now 回读并比较页面与健康快照', async () => {
    const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: before.syncedAt } });
    const health = await api.get('/api/health');
    expect(ranked.status, '[E3] 失败后页面读取成功').toBe(200);
    expect(health.status, '[E3] 失败后 health 读取成功').toBe(200);
    expect(ranked.body, '[E3] text/plain 未清除打开快照或修改页面').toEqual(before.ranked);
    expect(health.body, '[E3] 健康快照深度不变').toEqual(before.health);
    expect(health.body, '[E3] 页面数和同步时间保持原值').toMatchObject({ pageCount: 10, lastSyncAt: before.syncedAt });
  });
});
