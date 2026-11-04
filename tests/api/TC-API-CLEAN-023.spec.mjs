import { test, expect, samplePayload } from '../fixtures/api.mjs';

const ISSUE = 'https://github.com/org/repo/issues/100';

test('TC-API-CLEAN-023 归档后从建议、排序与推荐中移除但总数不变', async ({ api }) => {
  const now = Date.now();
  const payload = samplePayload({ now });
  await test.step('S1：同步平移后的样例', () => api.seed(payload));
  await test.step('S2：归档 issues/100', async () => {
    const r = await api.post('/api/pages/archive', { urls: [ISSUE] });
    expect(r.status, '[E1] 归档返回 200').toBe(200);
    expect(r.body, '[E1] 实际归档一页且没有找不到的 URL').toMatchObject({ ok: true, affected: 1, notFound: 0, archivedAt: expect.any(Number) });
  });
  await test.step('S3：读取归档后的整理建议', async () => {
    const r = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
    expect(r.status, '[E2] 返回 200').toBe(200);
    expect(r.body.suggestions.filter(s => s.action === 'archive').map(s => s.url), '[E2] issues/100 从归档建议中消失').not.toContain(ISSUE);
    expect(r.body.summary.archive, '[E2] 只剩一条归档建议').toBe(1);
  });
  await test.step('S4：读取最多 500 条排序结果', async () => {
    const r = await api.get('/api/pages/ranked', { params: { limit: 500 } });
    expect(r.status, '[E3] 返回 200').toBe(200);
    expect(r.body.pages.map(p => p.url), '[E3] 已归档页不在排序结果中').not.toContain(ISSUE);
    expect(r.body.total, '[E3] 未归档页数为九').toBe(9);
  });
  await test.step('S5：使用同一份样例上下文请求推荐', async () => {
    const r = await api.post('/api/recommendations/next', {
      currentPage: payload.activeTab, openTabs: payload.openTabs, recentHistory: payload.history,
    }, { params: { now } });
    expect(r.status, '[E4] 推荐返回 200').toBe(200);
    expect(r.body.recommendations.map(p => p.url), '[E4] 已归档页不在推荐中').not.toContain(ISSUE);
  });
  await test.step('S6：读取健康检查总数', async () => {
    const r = await api.get('/api/health');
    expect(r.status, '[E5] 返回 200').toBe(200);
    expect(r.body.pageCount, '[E5] 归档页仍计入总数').toBe(10);
  });
});
