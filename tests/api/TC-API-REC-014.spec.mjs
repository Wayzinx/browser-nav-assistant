// 来源：docs/trace/cases/API-REC.json；REC API，独立真实 HTTP 用例。
import { test, expect, samplePayload } from '../fixtures/api.mjs';

// S1 显式发送 JSON 重置请求，替代夹具在步骤外的自动重置。
test.use({ autoReset: false });

test("TC-API-REC-014 不同仓库当前页不能把 GitHub 样例错标为同仓库", async ({ api, evidence }) => {
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

  const r = await test.step('S3：以另一个 GitHub 仓库的 PR 查询样例推荐', () =>
    api.post('/api/recommendations/next', {
      currentPage: { url: 'https://github.com/another/project/pull/1' },
      openTabs: payload.openTabs, recentHistory: [],
    }, { params: { now: N } }));
  expect(r.status, '[E1] 推荐返回 200').toBe(200);
  expect(r.body.recommendations.filter(p => p.strategy === 'same_repo'), '[E1] 不同仓库没有 same_repo 推荐').toEqual([]);
  const actions = r.body.recommendations.find(p => p.url === 'https://github.com/org/repo/actions');
  expect(actions, '[E2] Actions 存在且只使用同域策略').toMatchObject({
    url: 'https://github.com/org/repo/actions', strategy: 'same_domain',
  });
  expect(actions.reason, '[E2] 理由说明同域名').toContain('同域名');
  expect(actions.reason, '[E2] 不错误声称属于另一个仓库').not.toContain('同一仓库 another/project');

  await test.step('S4：GET /api/health，读回计数并核对查询没有写入副作用', async () => {
    const r = await api.get('/api/health');
    expect(r.status, '[E3] 健康检查返回 200').toBe(200);
    expect(r.body, '[E3] 页面、规则及同步状态保持预期').toMatchObject({ pageCount: 10, ruleCount: 0 });
  });
});
