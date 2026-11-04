import { test, expect, DAY, HOUR } from '../fixtures/api.mjs';

const PROTECTED = 'https://docs.internal.com/both';
const OPEN = 'https://example.com/open-important';
const RULE = { rawText: 'docs.internal.com 的页面永远不要归档', type: 'never_archive', domain: 'docs.internal.com', action: 'keep' };

test('TC-API-CLEAN-022 保护优先于重要且重要优先于打开状态', async ({ api }) => {
  const now = Date.now();
  await test.step('S1：同步受保护旧页面及打开中的新页面', () => api.seed({
    activeTab: null, openTabs: [{ url: OPEN, lastAccessed: now - HOUR }], history: [
      { url: PROTECTED, lastVisitTime: now - 30 * DAY, visitCount: 1 },
      { url: OPEN, lastVisitTime: now - HOUR, visitCount: 1 },
    ],
  }));
  const ruleId = await test.step('S2：保存保护规则并取得 id', async () => {
    const r = await api.post('/api/rules', { rules: [RULE] });
    expect(r.status, '[E1] 保护规则保存成功').toBe(201);
    expect(r.body.rules[0].id, '[E1] 保护规则 id 非空').toMatch(/\S/);
    return r.body.rules[0].id;
  });
  await test.step('S3：将两个页面都标记为重要', async () => {
    for (const url of [PROTECTED, OPEN]) {
      const r = await api.post('/api/pages/important', { url, important: true });
      expect(r.status, '[E3] 标记返回 200').toBe(200);
      expect(r.body.isImportant, '[E3] 两个页面都已标记').toBe(true);
    }
  });
  await test.step('S4：核对相邻优先级的理由及汇总', async () => {
    const r = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
    expect(r.status, '[E1] 返回 200').toBe(200);
    const keeps = r.body.suggestions.filter(s => s.action === 'keep');
    const protectedItem = keeps.find(s => s.url === PROTECTED);
    expect(protectedItem, '[E1] 保护优先并引用规则').toMatchObject({ url: PROTECTED, ruleId });
    expect(protectedItem.reason, '[E1] 理由使用保护域名').toContain('被保护域名配置（docs.internal.com）');
    expect(protectedItem.reason, '[E1] 不采用重要标记理由').not.toContain('你已标记为重要');
    expect(keeps.find(s => s.url === OPEN), '[E2] 重要优先于打开状态').toMatchObject({ reason: '你已标记为重要，不建议归档', ruleId: null });
    expect(r.body.summary, '[E3] 两个页面都保留').toEqual({ archive: 0, merge: 0, keep: 2 });
  });
});
