import { test, expect, historyItem } from '../fixtures/api.mjs';

const SUBDOMAIN = 'https://docs.internal.com/old';
const OTHER = 'https://notinternal.com/old';
const RULE = { rawText: 'internal.com 的页面永远不要归档', type: 'never_archive', domain: 'internal.com', action: 'keep' };

test('TC-API-CLEAN-013 保护子域但不保护仅字符串后缀相同的域名', async ({ api }) => {
  const now = Date.now();
  await test.step('S1：同步两个域名的 30 天旧页面', () => api.seed({
    activeTab: null, openTabs: [], history: [SUBDOMAIN, OTHER].map(url => historyItem(url, { daysAgo: 30, now })),
  }));
  await test.step('S2：保存 internal.com 保护规则', async () => {
    const r = await api.post('/api/rules', { rules: [RULE] });
    expect(r.status, '[E1] 保护规则保存成功').toBe(201);
  });
  await test.step('S3：核对域名匹配边界', async () => {
    const r = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
    expect(r.status, '[E1] 返回 200').toBe(200);
    const archives = r.body.suggestions.filter(s => s.action === 'archive');
    const keeps = r.body.suggestions.filter(s => s.action === 'keep');
    expect(keeps.map(s => s.url), '[E1] 子域受保护').toContain(SUBDOMAIN);
    expect(archives.map(s => s.url), '[E1] 子域不归档').not.toContain(SUBDOMAIN);
    expect(archives.find(s => s.url === OTHER), '[E2] 无点边界的后缀不匹配保护规则').toMatchObject({ url: OTHER, ageDays: 30 });
    expect(keeps.map(s => s.url), '[E2] notinternal.com 不受保护').not.toContain(OTHER);
    expect(r.body.summary, '[E3] 归档与保留各一条').toEqual({ archive: 1, merge: 0, keep: 1 });
  });
});
