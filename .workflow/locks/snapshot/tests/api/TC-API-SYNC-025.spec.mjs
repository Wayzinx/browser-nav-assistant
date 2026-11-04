import { test, expect } from '../fixtures/api.mjs';

const MB = 1_048_576;
const URL = 'https://example.com/body';

test('TC-API-SYNC-025 请求体恰为 1 MB 接收、多一字节整批拒绝', async ({ api }) => {
  await test.step('S1：清空后端状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });
  const { r, raw2 } = await test.step('S2：构造精确字节边界并提交恰好 1 MB 的请求', async () => {
    const payload = { activeTab: null, openTabs: [], history: [{ url: URL, title: '', visitCount: 1, lastVisitTime: Date.now() - 600_000 }] };
    const padding = MB - Buffer.byteLength(JSON.stringify(payload), 'utf8');
    payload.history[0].title = 'a'.repeat(padding);
    const raw1 = JSON.stringify(payload);
    // JSON 尾部空白合法；增加一个 ASCII 空格只改变字节数，保持 JSON 内容有效。
    const raw2 = raw1 + ' ';
    expect(Buffer.byteLength(raw1, 'utf8'), '[E2] Raw1 恰为 1,048,576 字节').toBe(MB);
    expect(Buffer.byteLength(raw2, 'utf8'), '[E4] Raw2 恰比上限多一字节').toBe(MB + 1);
    const r = await api.raw('POST', '/api/sync', raw1);
    expect(r.status, '[E2] 恰好 1 MB 返回 200').toBe(200);
    expect(r.body, '[E2] 一条历史正常入库').toMatchObject({ received: 1, created: 1, updated: 0, rejected: 0, pageCount: 1 });
    return { r, raw2 };
  });
  const before = await test.step('S3：回读页面并保存合法请求后的快照', async () => {
    const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: r.body.syncedAt } });
    const health = await api.get('/api/health');
    expect(ranked.status, '[E3] 页面回读成功').toBe(200);
    expect(ranked.body.total, '[E3] 唯一页面入库').toBe(1);
    expect(ranked.body.pages, '[E3] 唯一 URL 正确且长标题截断到 500 字符').toMatchObject([{ normalizedUrl: URL, title: 'a'.repeat(500), visitCount: 1 }]);
    expect(health.status, '[E5] 基线 health 读取成功').toBe(200);
    return { ranked: ranked.body, health: health.body };
  });
  await test.step('S4：原样发送多一字节的合法 JSON 请求体', async () => {
    const bad = await api.raw('POST', '/api/sync', raw2);
    expect(bad.status, '[E4] 超一字节返回 413').toBe(413);
    expect(bad.body.error.code, '[E4] 错误码为 PAYLOAD_TOO_LARGE').toBe('PAYLOAD_TOO_LARGE');
    expect(bad.body.error.message, '[E4] 错误消息非空').toMatch(/\S/);
  });
  await test.step('S5：固定原 now 回读，确认超限请求无副作用', async () => {
    const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: r.body.syncedAt } });
    const health = await api.get('/api/health');
    expect(ranked.status, '[E5] 超限后页面读取成功').toBe(200);
    expect(health.status, '[E5] 超限后 health 读取成功').toBe(200);
    expect(ranked.body, '[E5] 页面快照深度不变').toEqual(before.ranked);
    expect(health.body, '[E5] 健康快照深度不变').toEqual(before.health);
    expect(health.body, '[E5] 超限请求不刷新同步时间').toMatchObject({ pageCount: 1, lastSyncAt: r.body.syncedAt });
  });
});
