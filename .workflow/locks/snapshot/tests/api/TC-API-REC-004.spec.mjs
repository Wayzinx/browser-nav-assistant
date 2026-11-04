// 来源：docs/trace/cases/API-REC.json；REC API，独立真实 HTTP 用例。
import { test, expect, samplePayload } from '../fixtures/api.mjs';

// S1 显式发送 JSON 重置请求，替代夹具在步骤外的自动重置。
test.use({ autoReset: false });

test("TC-API-REC-004 MDN 文档页首推同站点 Fetch API 页面", async ({ api, evidence }) => {
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

  const currentUrl = 'https://developer.mozilla.org/en-US/docs/Web/JavaScript';
  const r = await test.step('S3：以 MDN JavaScript 文档为当前页请求推荐', () =>
    api.post('/api/recommendations/next', {
      currentPage: { url: currentUrl }, openTabs: [], recentHistory: [],
    }, { params: { now: N } }));
  expect(r.status, '[E1] 推荐返回 200').toBe(200);
  expect(r.body.recommendations[0], '[E1] 首推同站点 Fetch API，分数为 0.81').toMatchObject({
    url: 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API', strategy: 'same_doc_site', score: 0.81,
  });
  expect(r.body.recommendations[0].reason, '[E2] 理由包含 MDN 域名').toContain('developer.mozilla.org');
  expect(r.body.recommendations[0].contextUrl, '[E2] 上下文等于 JavaScript 请求 URL').toBe(currentUrl);
});
