import { test, expect, historyItem } from '../fixtures/api.mjs';

const URLS = ['https://github.com/org/repo/pull/77', 'https://gitlab.com/org/repo/issues/77'];
const RULE = { rawText: '把 7 天没访问过的 GitHub issue 建议归档', type: 'archive_candidate', domain: 'github.com', urlPattern: '/issues/', inactiveDays: 7, action: 'suggest_archive' };

test('TC-API-CLEAN-018 路径或域名不匹配的页面不受归档规则影响', async ({ api }) => {
  const now = Date.now();
  await test.step('S1：同步 10 天前的 GitHub PR 和 GitLab issue', () => api.seed({
    activeTab: null, openTabs: [], history: URLS.map(url => historyItem(url, { daysAgo: 10, now })),
  }));
  await test.step('S2：保存仅针对 GitHub issue 的 7 天规则', async () => {
    const r = await api.post('/api/rules', { rules: [RULE] });
    expect(r.status, '[E1] 规则保存成功').toBe(201);
  });
  await test.step('S3：核对路径与域名的规则作用范围', async () => {
    const r = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
    expect(r.status, '[E1] 返回 200').toBe(200);
    const urls = r.body.suggestions.filter(s => s.action === 'archive').map(s => s.url);
    expect(urls, '[E1] PR 路径不命中 issue 规则').not.toContain(URLS[0]);
    expect(urls, '[E2] GitLab 域名不命中 GitHub 规则').not.toContain(URLS[1]);
    expect(r.body.summary, '[E3] 两页均不产生整理建议').toEqual({ archive: 0, merge: 0, keep: 0 });
  });
});
