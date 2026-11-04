import { test, expect, samplePayload } from '../fixtures/api.mjs';

const ISSUE = 'https://github.com/org/repo/issues/123';
const PULL = 'https://github.com/org/repo/pull/456';

test('TC-API-SYNC-018 JSON 解析异常后快照不变且合法重试幂等', async ({ api }) => {
  await test.step('S1：清空后端状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });
  const before = await test.step('S2：导入样例并保存页面和健康快照', async () => {
    const payload = samplePayload({ now: Date.now() });
    const r = await api.post('/api/sync', payload);
    expect(r.status, '[E3] 基线同步成功').toBe(200);
    const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: r.body.syncedAt } });
    const health = await api.get('/api/health');
    expect(ranked.status, '[E3] 基线页面读取成功').toBe(200);
    expect(health.status, '[E3] 基线 health 读取成功').toBe(200);
    expect(health.body.pageCount, '[E3] 基线包含十页').toBe(10);
    return { payload, syncedAt: r.body.syncedAt, ranked: ranked.body, health: health.body };
  });
  await test.step('S3：发送截断的 JSON，实际字节长度由 HTTP 客户端计算', async () => {
    const badRaw = JSON.stringify({ activeTab: { url: 'https://example.com/partial' }, openTabs: [], history: [] }).slice(0, -1);
    const r = await api.raw('POST', '/api/sync', badRaw);
    expect(r.status, '[E2] 解析异常返回 400').toBe(400);
    expect(r.body.error.code, '[E2] 错误码为 INVALID_JSON').toBe('INVALID_JSON');
    expect(r.body.error.message, '[E2] 错误消息非空').toMatch(/\S/);
  });
  await test.step('S4：固定原 now 回读页面和健康快照', async () => {
    const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: before.syncedAt } });
    const health = await api.get('/api/health');
    expect(ranked.status, '[E3] 异常后页面回读成功').toBe(200);
    expect(health.status, '[E3] 异常后 health 回读成功').toBe(200);
    expect(ranked.body, '[E3] 解析异常不改变任何页面或打开快照').toEqual(before.ranked);
    expect(health.body, '[E3] 解析异常不改变健康快照').toEqual(before.health);
    expect(health.body, '[E3] 页面数和同步时间保持原值').toMatchObject({ pageCount: 10, lastSyncAt: before.syncedAt });
  });
  await test.step('S5：重试原合法 payload 并验证幂等恢复', async () => {
    const r = await api.post('/api/sync', before.payload);
    expect(r.status, '[E4] 合法重试返回 200').toBe(200);
    expect(r.body, '[E4] 原观测只更新已有页面').toMatchObject({ received: 14, created: 0, updated: 14, rejected: 0, pageCount: 10 });
    const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: r.body.syncedAt } });
    const health = await api.get('/api/health');
    expect(ranked.status, '[E5] 重试后页面回读成功').toBe(200);
    const issue = ranked.body.pages.find((p) => p.url === ISSUE);
    expect(issue.visitCount, '[E5] 重试不累加 issue 次数').toBe(8);
    expect([...issue.sources].sort(), '[E5] issue 来源仍为两种').toEqual(['history', 'open_tab']);
    expect(ranked.body.pages.find((p) => p.url === PULL).lastVisitedAt, '[E5] 活动页时间为重试 syncedAt').toBe(r.body.syncedAt);
    const expectedOpen = [...new Set([before.payload.activeTab, ...before.payload.openTabs].map((p) => p.url))].sort();
    expect(ranked.body.pages.filter((p) => p.isOpen).map((p) => p.url).sort(), '[E5] 打开集合与原样例相同').toEqual(expectedOpen);
    expect(health.status, '[E6] 重试后 health 返回 200').toBe(200);
    expect(health.body, '[E6] 重试后服务和同步状态恢复').toMatchObject({ pageCount: 10, lastSyncAt: r.body.syncedAt });
  });
});
