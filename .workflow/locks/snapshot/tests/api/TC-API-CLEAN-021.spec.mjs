import { test, expect, historyItem } from '../fixtures/api.mjs';

const URL = 'https://example.com/important';

test('TC-API-CLEAN-021 标记和取消重要会在 keep 与 archive 间切换', async ({ api }) => {
  const now = Date.now();
  await test.step('S1：同步 30 天前的页面', () => api.seed({ activeTab: null, openTabs: [], history: [historyItem(URL, { title: 'important', daysAgo: 30, now })] }));
  await test.step('S2：核对标记前的归档建议', async () => {
    const r = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
    expect(r.status, '[E1] 返回 200').toBe(200);
    expect(r.body.suggestions.find(s => s.action === 'archive' && s.url === URL), '[E1] 标记前按 30 天归档').toMatchObject({ url: URL, ageDays: 30 });
  });
  await test.step('S3：将已存在的页面标记为重要', async () => {
    const r = await api.post('/api/pages/important', { url: URL, important: true });
    expect(r.status, '[E2] 标记返回 200').toBe(200);
    expect(r.body, '[E2] 标记成功且没有新建页面').toMatchObject({ isImportant: true, created: false });
  });
  await test.step('S4：核对重要页面转为 keep', async () => {
    const r = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
    expect(r.status, '[E3] 返回 200').toBe(200);
    expect(r.body.suggestions.find(s => s.action === 'keep' && s.url === URL), '[E3] 重要页面的理由与 ruleId 精确匹配').toMatchObject({ reason: '你已标记为重要，不建议归档', ruleId: null });
    expect(r.body.suggestions.filter(s => s.action === 'archive').map(s => s.url), '[E4] 重要页面不归档').not.toContain(URL);
    expect(r.body.summary, '[E4] 只有一条 keep').toEqual({ archive: 0, merge: 0, keep: 1 });
  });
  await test.step('S5：取消页面的重要标记', async () => {
    const r = await api.post('/api/pages/important', { url: URL, important: false });
    expect(r.status, '[E5] 取消标记返回 200').toBe(200);
    expect(r.body.isImportant, '[E5] 重要标记已取消').toBe(false);
  });
  await test.step('S6：核对取消标记后的归档建议', async () => {
    const r = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
    expect(r.status, '[E5] 返回 200').toBe(200);
    expect(r.body.suggestions.find(s => s.action === 'archive' && s.url === URL), '[E5] 页面恢复为 30 天归档候选').toMatchObject({ ageDays: 30 });
    expect(r.body.suggestions.filter(s => s.action === 'keep').map(s => s.url), '[E5] keep 中不再有该页面').not.toContain(URL);
  });
});
