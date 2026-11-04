// 来源：docs/trace/cases/API-REC.json；REC API，独立真实 HTTP 用例。
import { test, expect, samplePayload } from '../fixtures/api.mjs';

// S1 显式发送 JSON 重置请求，替代夹具在步骤外的自动重置。
test.use({ autoReset: false });

test("TC-API-REC-012 已归档的 Actions 即使关联度最高也不再被推荐", async ({ api, evidence }) => {
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

  await test.step('S3：通过真实接口归档 Actions 页面', async () => {
    const r = await api.post('/api/pages/archive', { urls: ['https://github.com/org/repo/actions'] }, { setup: true });
    expect(r.status, '[E1] 归档返回 200').toBe(200);
    expect(r.body, '[E1] 成功归档且仅影响一条已有页面').toMatchObject({ ok: true, affected: 1, notFound: 0 });
  });
  const r = await test.step('S4：以样例上下文查询，已归档页不得被推荐', () =>
    api.post('/api/recommendations/next', {
      currentPage: payload.activeTab, openTabs: payload.openTabs, recentHistory: payload.history,
    }, { params: { now: N } }));
  expect(r.status, '[E2] 推荐返回 200').toBe(200);
  const urls = r.body.recommendations.map(p => p.url);
  expect([...urls].sort(), '[E2] URL 集合严格等于两条 React 页面').toEqual([
    'https://react.dev/learn', 'https://react.dev/reference/react/useState',
  ]);
  expect(urls, '[E2] 已归档 Actions 被排除').not.toContain('https://github.com/org/repo/actions');
  expect(urls, '[E2] 待归档旧 Issue 被排除').not.toContain('https://github.com/org/repo/issues/100');
  expect(urls, '[E2] 待归档 Google 搜索页被排除').not.toContain('https://www.google.com/search?q=chrome+extension+manifest+v3');

  await test.step('S5：GET /api/health，读回计数并核对查询没有写入副作用', async () => {
    const r = await api.get('/api/health');
    expect(r.status, '[E3] 健康检查返回 200').toBe(200);
    expect(r.body, '[E3] 页面、规则及同步状态保持预期').toMatchObject({ pageCount: 10, ruleCount: 0 });
  });
});
