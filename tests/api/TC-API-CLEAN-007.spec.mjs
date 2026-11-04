import { test, expect, DAY, HOUR } from '../fixtures/api.mjs';

const URL = 'https://example.com/old';

test('TC-API-CLEAN-007 整天数超过 14 才归档的毫秒边界', async ({ api }) => {
  const lastVisitTime = Date.now() - 20 * DAY;
  await test.step('S1：同步旧页面并固定其最后访问时间', () => api.seed({
    activeTab: null, openTabs: [], history: [{ url: URL, title: 'old', lastVisitTime, visitCount: 1 }],
  }));
  await test.step('S2：未访问 14 天 23 小时', async () => {
    const r = await api.get('/api/pages/cleanup-suggestions', { params: { now: lastVisitTime + 14 * DAY + 23 * HOUR } });
    expect(r.status, '[E1] 返回 200').toBe(200);
    expect(r.body.suggestions.filter(s => s.action === 'archive').map(s => s.url), '[E1] 14 天 23 小时不归档').not.toContain(URL);
    expect(r.body.summary.archive, '[E1] 归档数为零').toBe(0);
  });
  await test.step('S3：未访问 15 天减 1 毫秒', async () => {
    const r = await api.get('/api/pages/cleanup-suggestions', { params: { now: lastVisitTime + 15 * DAY - 1 } });
    expect(r.status, '[E2] 返回 200').toBe(200);
    expect(r.body.suggestions.filter(s => s.action === 'archive').map(s => s.url), '[E2] 差 1 毫秒仍不归档').not.toContain(URL);
    expect(r.body.summary.archive, '[E2] 归档数为零').toBe(0);
  });
  await test.step('S4：未访问恰好 15 天', async () => {
    const r = await api.get('/api/pages/cleanup-suggestions', { params: { now: lastVisitTime + 15 * DAY } });
    expect(r.status, '[E3] 返回 200').toBe(200);
    const item = r.body.suggestions.find(s => s.action === 'archive' && s.url === URL);
    expect(item, '[E3] 恰好 15 天出现归档建议').toMatchObject({ url: URL, ageDays: 15 });
    expect(r.body.summary.archive, '[E3] 恰好一条归档').toBe(1);
    expect(item, '[E4] 理由使用默认阈值且没有规则').toMatchObject({
      reason: '超过 14 天未访问（已 15 天），且不在当前打开的 tab 中', ruleId: null,
    });
  });
});
