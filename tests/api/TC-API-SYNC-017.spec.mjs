import { test, expect } from '../fixtures/api.mjs';

test('TC-API-SYNC-017 非法 JSON 返回 INVALID_JSON 且空库不变', async ({ api }) => {
  await test.step('S1：清空后端状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });
  await test.step('S2：原样发送非法 JSON 字节', async () => {
    const r = await api.raw('POST', '/api/sync', '{bad');
    expect(r.status, '[E2] 非法 JSON 返回 400').toBe(400);
    expect(r.body.error.code, '[E2] 错误码为 INVALID_JSON').toBe('INVALID_JSON');
    expect(r.body.error.message, '[E2] 错误消息非空').toMatch(/\S/);
  });
  await test.step('S3：回读空页面和未同步的健康状态', async () => {
    const health = await api.get('/api/health');
    const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: Date.now() } });
    expect(health.status, '[E3] health 返回 200').toBe(200);
    expect(health.body, '[E3] 解析失败不写入页面或同步时间').toMatchObject({ pageCount: 0, lastSyncAt: null });
    expect(ranked.status, '[E4] ranked 返回 200').toBe(200);
    expect(ranked.body.pages, '[E4] 没有解析失败生成的页面').toEqual([]);
    expect(ranked.body.total, '[E4] 页面总数为零').toBe(0);
  });
});
