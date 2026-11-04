import { test, expect, historyItem, DAY } from '../fixtures/api.mjs';

const URL = 'https://example.com/open';

test('TC-API-CLEAN-006 旧页面打开时不归档而关闭后归档', async ({ api }) => {
  const now = Date.now();
  const history = [historyItem(URL, { title: 'open', daysAgo: 20, now })];
  await test.step('S1：同步 20 天前访问且当前打开的页面', async () => {
    const r = await api.post('/api/sync', {
      activeTab: null, openTabs: [{ url: URL, title: 'open', lastAccessed: now - 20 * DAY }], history,
    });
    expect(r.status, '[E1] 同步返回 200').toBe(200);
    expect(r.body.created, '[E1] 创建一个页面').toBe(1);
  });
  await test.step('S2：读取打开状态下的整理建议', async () => {
    const r = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
    expect(r.status, '[E2] 整理建议返回 200').toBe(200);
    expect(r.body.suggestions.filter(s => ['archive', 'keep'].includes(s.action)).map(s => s.url), '[E2] 该页面既不归档也不保留').not.toContain(URL);
    expect(r.body.summary.archive, '[E2] 无归档建议').toBe(0);
  });
  await test.step('S3：再次同步，openTabs 置空', () => api.seed({ activeTab: null, openTabs: [], history }));
  await test.step('S4：读取关闭后的整理建议', async () => {
    const r = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
    expect(r.status, '[E3] 整理建议返回 200').toBe(200);
    expect(r.body.suggestions.find(s => s.action === 'archive' && s.url === URL), '[E3] 关闭后按 20 天归档').toMatchObject({
      ageDays: 20, reason: '超过 14 天未访问（已 20 天），且不在当前打开的 tab 中',
    });
  });
});
