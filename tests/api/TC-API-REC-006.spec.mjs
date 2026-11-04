// 来源：docs/trace/cases/API-REC.json；REC API，独立真实 HTTP 用例。
import { test, expect, samplePayload } from '../fixtures/api.mjs';

// S1 显式发送 JSON 重置请求，替代夹具在步骤外的自动重置。
test.use({ autoReset: false });

test("TC-API-REC-006 系统页 null 当前上下文返回全局高分兜底", async ({ api, evidence }) => {
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

  const r = await test.step('S3：以 null 系统页上下文和样例打开页请求全局兜底', () =>
    api.post('/api/recommendations/next', {
      currentPage: null, openTabs: payload.openTabs, recentHistory: [],
    }, { params: { now: N } }));
  expect(r.status, '[E1] 推荐返回 200').toBe(200);
  expect(r.body.recommendations.map(p => [p.url, p.score]), '[E1] 全局兜底恰有四条且顺序、分数精确').toEqual([
    ['https://github.com/org/repo/pull/456', 0.56],
    ['https://react.dev/reference/react/useState', 0.46],
    ['https://github.com/org/repo/actions', 0.45],
    ['https://react.dev/learn', 0.41],
  ]);
  for (const p of r.body.recommendations) {
    expect(p, '[E2] 每条都使用全局策略、固定理由及 null 上下文').toMatchObject({
      strategy: 'global_top', reason: '近期综合评分较高的页面，可作为备选', contextUrl: null,
    });
  }
  const excluded = [...payload.openTabs.map(p => p.url), 'https://github.com/org/repo/issues/123?tab=comments'];
  expect(r.body.recommendations.filter(p => excluded.includes(p.url)), '[E3] 打开页及相同 dupKey 的变体全部被排除').toEqual([]);
});
