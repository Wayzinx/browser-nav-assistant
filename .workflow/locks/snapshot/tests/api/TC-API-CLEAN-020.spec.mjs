import { test, expect, historyItem, DAY } from '../fixtures/api.mjs';

const URL = 'https://github.com/org/repo/issues/90';
const RULE = { rawText: '把 7 天没访问过的 GitHub issue 建议归档', type: 'archive_candidate', domain: 'github.com', urlPattern: '/issues/', inactiveDays: 7, action: 'suggest_archive' };

test('TC-API-CLEAN-020 打开中的旧 issue 优先于归档候选规则', async ({ api }) => {
  const now = Date.now();
  await test.step('S1：同步打开中的 20 天旧 issue', () => api.seed({
    activeTab: null, openTabs: [{ url: URL, title: 'Issue 90', lastAccessed: now - 20 * DAY }],
    history: [historyItem(URL, { title: 'Issue 90', daysAgo: 20, now })],
  }));
  await test.step('S2：保存 7 天 issue 规则', async () => {
    const r = await api.post('/api/rules', { rules: [RULE] });
    expect(r.status, '[E1] 规则保存成功').toBe(201);
  });
  await test.step('S3：核对打开状态的判定优先级', async () => {
    const r = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
    expect(r.status, '[E1] 返回 200').toBe(200);
    expect(r.body.suggestions.filter(s => s.action === 'archive').map(s => s.url), '[E1] 打开中的 issue 不归档').not.toContain(URL);
    expect(r.body.suggestions.filter(s => s.action === 'keep').map(s => s.url), '[E2] 普通打开状态也不产生 keep').not.toContain(URL);
    expect(r.body.summary, '[E3] 不产生任何整理建议').toEqual({ archive: 0, merge: 0, keep: 0 });
  });
});
