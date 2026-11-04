// 来源：docs/trace/cases/API-REC.json；REC API，独立真实 HTTP 用例。
import { test, expect, samplePayload } from '../fixtures/api.mjs';

// S1 显式发送 JSON 重置请求，替代夹具在步骤外的自动重置。
test.use({ autoReset: false });

test("TC-API-REC-028 有请求体但媒体类型为 text/plain 返回415且不写入", async ({ api, evidence }) => {
  await test.step('S1：POST /api/__test__/reset，以 JSON 空对象重置数据与缓存', async () => {
    const r = await api.post('/api/__test__/reset', {}, { setup: true });
    expect(r.status, 'S1 重置返回 200').toBe(200);
    expect(r.body, 'S1 重置成功').toMatchObject({ ok: true });
  });

  const { N } = await test.step('S2：按 D-01 平移样例并真实同步，记录 syncedAt 为 N', async () => {
    const T = Date.now();
    const payload = samplePayload({ now: T });
    const r = await api.seed(payload);
    expect(r.status, 'S2 同步返回 200').toBe(200);
    expect(r.body, 'S2 同步样例的完整计数').toMatchObject({
      received: 14, created: 10, updated: 4, rejected: 0, pageCount: 10,
    });
    expect(r.body.syncedAt, 'S2 后端生成毫秒时间基准').toEqual(expect.any(Number));
    evidence.note(JSON.stringify({ T, N: r.body.syncedAt }));
    return { payload, N: r.body.syncedAt };
  });

  const r = await test.step('S3：以 text/plain 媒体类型发送有正文的原始 JSON 请求', () =>
    api.raw('POST', '/api/recommendations/next?now=' + N,
      JSON.stringify({ currentPage: null, openTabs: [], recentHistory: [] }), 'text/plain'));
  expect(r.status, '[E1] 错误媒体类型返回 415').toBe(415);
  expect(r.body.error.code, '[E1] 错误码为 UNSUPPORTED_MEDIA_TYPE').toBe('UNSUPPORTED_MEDIA_TYPE');
  expect(r.body.error.message, '[E1] 错误消息是非空字符串').toMatch(/\S/);

  await test.step('S4：GET /api/health，读回计数并核对查询没有写入副作用', async () => {
    const r = await api.get('/api/health');
    expect(r.status, '[E2] 健康检查返回 200').toBe(200);
    expect(r.body, '[E2] 页面、规则及同步状态保持预期').toMatchObject({ pageCount: 10, ruleCount: 0, lastSyncAt: N });
  });
});
