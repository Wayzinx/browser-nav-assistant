import { test, expect, samplePayload } from '../fixtures/api.mjs';

test('TC-API-SYNC-016 openTabs 类型非法时不部分合并或清空快照', async ({ api }) => {
  await test.step('S1：清空后端状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });
  const before = await test.step('S2：导入样例并保存完整页面与健康快照', async () => {
    const payload = samplePayload({ now: Date.now() });
    const r = await api.post('/api/sync', payload);
    expect(r.status, '[E4] 基线同步成功').toBe(200);
    const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: r.body.syncedAt } });
    const health = await api.get('/api/health');
    expect(ranked.status, '[E4] 基线页面回读成功').toBe(200);
    expect(health.status, '[E5] 基线 health 回读成功').toBe(200);
    expect(health.body.pageCount, '[E5] 基线包含十页').toBe(10);
    return { payload, syncedAt: r.body.syncedAt, ranked: ranked.body, health: health.body };
  });
  await test.step('S3：提交夹带新页面和字段修改的非法 openTabs', async () => {
    const r = await api.post('/api/sync', {
      activeTab: { url: 'https://react.dev/learn', title: 'Must not replace' },
      openTabs: 'not-an-array',
      history: [
        { ...before.payload.history[0], title: 'Must not replace', visitCount: 999 },
        { url: 'https://example.com/partial', title: 'Must not exist', lastVisitTime: Date.now() - 300_000, visitCount: 1 },
      ],
    });
    expect(r.status, '[E2] 非法结构返回 400').toBe(400);
    expect(r.body.error.code, '[E2] 错误码为 VALIDATION_FAILED').toBe('VALIDATION_FAILED');
    expect(r.body.error.message, '[E2] 错误消息非空').toMatch(/\S/);
    expect(r.body.error.details.fields, '[E3] 字段错误包含 openTabs').toContain('openTabs');
  });
  await test.step('S4：固定相同 now 回读，确认失败没有副作用', async () => {
    const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: before.syncedAt } });
    const health = await api.get('/api/health');
    expect(ranked.status, '[E4] 失败后页面仍可读取').toBe(200);
    expect(ranked.body, '[E4] 页面、来源、次数、时间和打开状态深度不变').toEqual(before.ranked);
    expect(ranked.body.pages.map((p) => p.url), '[E4] 没有部分写入新 URL').not.toContain('https://example.com/partial');
    expect(health.status, '[E5] 失败后 health 仍正常').toBe(200);
    expect(health.body, '[E5] 健康快照深度不变').toEqual(before.health);
    expect(health.body, '[E5] 保留十页和原同步时间').toMatchObject({ pageCount: 10, lastSyncAt: before.syncedAt });
  });
});
