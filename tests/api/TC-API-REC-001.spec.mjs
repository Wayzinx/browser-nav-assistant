// 来源：docs/trace/cases/API-REC.json；REC API，独立真实 HTTP 用例。
import { test, expect, samplePayload } from '../fixtures/api.mjs';

// S1 显式发送 JSON 重置请求，替代夹具在步骤外的自动重置。
test.use({ autoReset: false });

test("TC-API-REC-001 PR 样例返回精确三条推荐并排除当前、打开、重复和待归档页面", async ({ api, evidence }) => {
  await test.step('S1：POST /api/__test__/reset，以 JSON 空对象重置数据与缓存', async () => {
    const r = await api.post('/api/__test__/reset', {}, { setup: true });
    expect(r.status, '[E1] 重置返回 200').toBe(200);
    expect(r.body, '[E1] 重置成功').toMatchObject({ ok: true });
  });

  const { payload, N } = await test.step('S2：按 D-01 平移样例并真实同步，记录 syncedAt 为 N', async () => {
    const T = Date.now();
    const payload = samplePayload({ now: T });
    const r = await api.seed(payload);
    expect(r.status, '[E1] 同步返回 200').toBe(200);
    expect(r.body, '[E1] 同步样例的完整计数').toMatchObject({
      received: 14, created: 10, updated: 4, rejected: 0, pageCount: 10,
    });
    expect(r.body.syncedAt, 'S2 后端生成毫秒时间基准').toEqual(expect.any(Number));
    evidence.note(JSON.stringify({ T, N: r.body.syncedAt }));
    return { payload, N: r.body.syncedAt };
  });

  const r = await test.step('S3：以样例 PR、打开页和历史请求推荐，时间固定为 N', () =>
    api.post('/api/recommendations/next', {
      currentPage: payload.activeTab, openTabs: payload.openTabs, recentHistory: payload.history,
    }, { params: { now: N } }));
  expect(r.status, '[E2] 推荐返回 200').toBe(200);
  expect(r.body.recommendations, '[E2] 恰有三条推荐').toHaveLength(3);
  expect(r.body, '[E2] 首次请求未命中缓存且生成时间为 N').toMatchObject({ cached: false, generatedAt: N });
  expect(r.body.recommendations.map(p => [p.url, p.title, p.strategy, p.score]), '[E3] 精确推荐内容与顺序').toEqual([
    ['https://github.com/org/repo/actions', 'Actions · org/repo', 'same_repo', 0.87],
    ['https://react.dev/reference/react/useState', 'useState – React', 'global_top', 0.46],
    ['https://react.dev/learn', 'Quick Start – React', 'global_top', 0.41],
  ]);
  for (const p of r.body.recommendations) {
    expect(p.id, '[E4] 推荐 ID 使用 rec_ 前缀').toMatch(/^rec_/);
    expect(p, '[E4] 推荐类型、当前上下文与创建时间').toMatchObject({
      type: 'next_visit', contextUrl: payload.activeTab.url, createdAt: N,
    });
    expect(p.reason, '[E4] 理由是非空字符串').toMatch(/\S/);
    expect(typeof p.score, '[E4] 分数是 number').toBe('number');
    expect(Math.abs(Math.round(p.score * 100) - p.score * 100), '[E4] 两位小数的误差不超过 1e-9').toBeLessThanOrEqual(1e-9);
    expect(p.score, '[E4] 分数达到推荐下限').toBeGreaterThanOrEqual(0.3);
  }
  const scores = r.body.recommendations.map(p => p.score);
  expect(scores, '[E4] 分数非递增').toEqual([...scores].sort((a, b) => b - a));
  expect(r.body.recommendations[0].reason, '[E5] PR 上下文理由').toContain('PR');
  expect(r.body.recommendations[0].reason, '[E5] CI 推荐理由').toContain('CI');
  expect(r.body.recommendations.slice(1).map(p => p.reason), '[E5] 其余两条为固定兜底理由').toEqual([
    '近期综合评分较高的页面，可作为备选', '近期综合评分较高的页面，可作为备选',
  ]);
  const urls = r.body.recommendations.map(p => p.url);
  const excluded = [
    payload.activeTab.url, ...payload.openTabs.map(p => p.url),
    'https://github.com/org/repo/issues/123?tab=comments',
    'https://github.com/org/repo/issues/100',
    'https://www.google.com/search?q=chrome+extension+manifest+v3',
  ];
  expect(urls.filter(url => excluded.includes(url)), '[E6] 排除当前、打开、重复和待归档的七条样例 URL').toEqual([]);

  await test.step('S4：GET /api/health，读回计数并核对查询没有写入副作用', async () => {
    const r = await api.get('/api/health');
    expect(r.status, '[E7] 健康检查返回 200').toBe(200);
    expect(r.body, '[E7] 页面、规则及同步状态保持预期').toMatchObject({ pageCount: 10, ruleCount: 0 });
  });
});
