// 来源：docs/trace/cases/API-REC.json；REC API，独立真实 HTTP 用例。
import { test, expect, samplePayload } from '../fixtures/api.mjs';

// S1 显式发送 JSON 重置请求，替代夹具在步骤外的自动重置。
test.use({ autoReset: false });

test("TC-API-REC-029 now 为零、负数、小数或非数字时均返回400", async ({ api, evidence }) => {
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

  await test.step('S3：分别提交 now=0、-1、1.5、abc 的独立请求', async () => {
    for (const now of ['0', '-1', '1.5', 'abc']) {
      const r = await api.post('/api/recommendations/next', {
        currentPage: null, openTabs: [], recentHistory: [],
      }, { params: { now } });
      expect(r.status, '[E1] now=' + now + ' 返回 400').toBe(400);
      expect(r.body.error.code, '[E1] now=' + now + ' 使用 VALIDATION_FAILED').toBe('VALIDATION_FAILED');
      expect(r.body.error.message, '[E1] now=' + now + ' 有非空错误消息').toMatch(/\S/);
      expect(r.body.error.details.fields, '[E1] now=' + now + ' 字段列表是数组').toEqual(expect.any(Array));
      expect(r.body.error.details.fields, '[E1] now=' + now + ' 指出 now 字段').toContain('now');
    }
  });

  await test.step('S4：GET /api/health，读回计数并核对查询没有写入副作用', async () => {
    const r = await api.get('/api/health');
    expect(r.status, '[E2] 健康检查返回 200').toBe(200);
    expect(r.body, '[E2] 页面、规则及同步状态保持预期').toMatchObject({ pageCount: 10, ruleCount: 0, lastSyncAt: N });
  });
});
