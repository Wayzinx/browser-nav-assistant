// 来源：docs/trace/cases/API-REC.json；REC API，独立真实 HTTP 用例。
import { test, expect, samplePayload } from '../fixtures/api.mjs';

// S1 显式发送 JSON 重置请求，替代夹具在步骤外的自动重置。
test.use({ autoReset: false });

test("TC-API-REC-007 未知当前域名仍返回至少一条全局兜底", async ({ api, evidence }) => {
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

  const currentUrl = 'https://unknown.example.net/x';
  const r = await test.step('S3：未知当前域名使用样例打开页请求兜底', () =>
    api.post('/api/recommendations/next', {
      currentPage: { url: currentUrl }, openTabs: payload.openTabs, recentHistory: [],
    }, { params: { now: N } }));
  expect(r.status, '[E1] 推荐返回 200').toBe(200);
  expect(r.body.recommendations, '[E1] 返回四条推荐').toHaveLength(4);
  expect(r.body.recommendations[0], '[E1] 首条为 PR，分数精确为 0.56').toMatchObject({
    url: 'https://github.com/org/repo/pull/456', score: 0.56,
  });
  for (const p of r.body.recommendations) {
    expect(p, '[E2] 每条都是固定理由的全局兜底并保留未知页上下文').toMatchObject({
      strategy: 'global_top', reason: '近期综合评分较高的页面，可作为备选', contextUrl: currentUrl,
    });
  }
});
