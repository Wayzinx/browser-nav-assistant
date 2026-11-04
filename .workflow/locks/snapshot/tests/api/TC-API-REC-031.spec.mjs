// 来源：docs/trace/cases/API-REC.json；REC API，独立真实 HTTP 用例。
import { test, expect, samplePayload } from '../fixtures/api.mjs';

// S1 显式发送 JSON 重置请求，替代夹具在步骤外的自动重置。
test.use({ autoReset: false });

test("TC-API-REC-031 JSON 正文恰好1MiB被接受而多1字节返回413", async ({ api, evidence }) => {
  await test.step('S1：POST /api/__test__/reset，以 JSON 空对象重置数据与缓存', async () => {
    const r = await api.post('/api/__test__/reset', {}, { setup: true });
    expect(r.status, 'S1 重置返回 200').toBe(200);
    expect(r.body, 'S1 重置成功').toMatchObject({ ok: true });
  });

  const { payload, N } = await test.step('S2：按 D-01 平移样例并真实同步，记录 syncedAt 为 N', async () => {
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

  const body = await test.step('S3：构造恰好 1MiB 的原始 UTF-8 JSON 正文并请求推荐', async () => {
    const body = { currentPage: null, openTabs: payload.openTabs, recentHistory: [], padding: '' };
    const base = JSON.stringify(body);
    body.padding = 'x'.repeat(1048576 - Buffer.byteLength(base, 'utf8'));
    const raw = JSON.stringify(body);
    expect(Buffer.byteLength(raw, 'utf8'), 'S3 原始正文精确为 1048576 字节').toBe(1048576);
    evidence.note(JSON.stringify({ step: 'S3', bodyBytes: Buffer.byteLength(raw, 'utf8') }));
    const r = await api.raw('POST', '/api/recommendations/next?now=' + N, raw, 'application/json');
    expect(r.status, '[E1] 恰好 1MiB 正文被接受，未知 padding 被忽略').toBe(200);
    expect(r.body.recommendations, '[E1] 返回四条全局兜底').toHaveLength(4);
    for (const p of r.body.recommendations) {
      expect(p.strategy, '[E1] 使用全局兜底策略').toBe('global_top');
      expect(p.score, '[E1] 分数达到推荐下限').toBeGreaterThanOrEqual(0.3);
    }
    return body;
  });
  await test.step('S4：仅增加一个 ASCII 字节，以同样媒体类型发送超限正文', async () => {
    const raw = JSON.stringify({ ...body, padding: body.padding + 'x' });
    expect(Buffer.byteLength(raw, 'utf8'), 'S4 原始正文精确为 1048577 字节').toBe(1048577);
    evidence.note(JSON.stringify({ step: 'S4', bodyBytes: Buffer.byteLength(raw, 'utf8') }));
    const r = await api.raw('POST', '/api/recommendations/next?now=' + N, raw, 'application/json');
    expect(r.status, '[E2] 多一个字节返回 413').toBe(413);
    expect(r.body.error.code, '[E2] 错误码为 PAYLOAD_TOO_LARGE').toBe('PAYLOAD_TOO_LARGE');
    expect(r.body.error.message, '[E2] 错误消息是非空字符串').toMatch(/\S/);
  });

  await test.step('S5：GET /api/health，读回计数并核对查询没有写入副作用', async () => {
    const r = await api.get('/api/health');
    expect(r.status, '[E3] 健康检查返回 200').toBe(200);
    expect(r.body, '[E3] 页面、规则及同步状态保持预期').toMatchObject({ pageCount: 10, ruleCount: 0, lastSyncAt: N });
  });
});
