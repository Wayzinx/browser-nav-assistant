import { test, expect, historyItem } from '../fixtures/api.mjs';

const URL = 'https://docs.internal.com/old';
const RULE = { rawText: 'docs.internal.com 的页面永远不要归档', type: 'never_archive', domain: 'docs.internal.com', action: 'keep' };

test('TC-API-CLEAN-012 保护规则覆盖未打开的 30 天旧页面', async ({ api }) => {
  const now = Date.now();
  await test.step('S1：同步 30 天前的内部文档', () => api.seed({ activeTab: null, openTabs: [], history: [historyItem(URL, { title: 'old doc', daysAgo: 30, now })] }));
  const ruleId = await test.step('S2：保存保护规则并取得 id', async () => {
    const r = await api.post('/api/rules', { rules: [RULE] });
    expect(r.status, '[E1] 保护规则保存成功').toBe(201);
    expect(r.body.rules[0].id, '[E1] 保护规则 id 非空').toMatch(/\S/);
    return r.body.rules[0].id;
  });
  await test.step('S3：读取旧文档的保护建议', async () => {
    const r = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
    expect(r.status, '[E1] 返回 200').toBe(200);
    const item = r.body.suggestions.find(s => s.action === 'keep' && s.url === URL);
    expect(item, '[E1] 旧文档被保护且引用保存的 id').toMatchObject({ url: URL, ruleId });
    expect(item.reason, '[E1] 理由标明保护域名').toContain('被保护域名配置（docs.internal.com）');
    expect(r.body.suggestions.filter(s => s.action === 'archive').map(s => s.url), '[E2] 旧文档不归档').not.toContain(URL);
    expect(r.body.summary, '[E3] 仅有一条 keep').toEqual({ archive: 0, merge: 0, keep: 1 });
  });
});
