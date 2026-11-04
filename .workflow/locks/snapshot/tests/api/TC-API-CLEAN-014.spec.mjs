import { test, expect, historyItem } from '../fixtures/api.mjs';

const URL = 'https://docs.internal.com/old';
const RULE = { rawText: 'docs.internal.com 的页面永远不要归档', type: 'never_archive', domain: 'docs.internal.com', action: 'keep', enabled: false };

test('TC-API-CLEAN-014 禁用的保护规则不阻止默认归档', async ({ api }) => {
  const now = Date.now();
  await test.step('S1：同步 30 天前的内部文档', () => api.seed({ activeTab: null, openTabs: [], history: [historyItem(URL, { daysAgo: 30, now })] }));
  await test.step('S2：保存 enabled=false 的保护规则', async () => {
    const r = await api.post('/api/rules', { rules: [RULE] });
    expect(r.status, '[E1] 保存返回 201').toBe(201);
    expect(r.body.rules[0].enabled, '[E1] 返回的规则保持禁用').toBe(false);
  });
  await test.step('S3：读取禁用规则下的整理建议', async () => {
    const r = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
    expect(r.status, '[E2] 返回 200').toBe(200);
    expect(r.body.suggestions.filter(s => s.action === 'keep').map(s => s.url), '[E2] 旧文档不受保护').not.toContain(URL);
    expect(r.body.summary.keep, '[E2] 保留计数为零').toBe(0);
    expect(r.body.suggestions.find(s => s.action === 'archive' && s.url === URL), '[E3] 仍按默认阈值归档且无 ruleId').toMatchObject({ ageDays: 30, ruleId: null });
  });
});
