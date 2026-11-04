import { test, expect, samplePayload } from '../fixtures/api.mjs';

const ISSUE = 'https://github.com/org/repo/issues/100';
const GOOGLE = 'https://www.google.com/search?q=chrome+extension+manifest+v3';
const ARCHIVE = { rawText: '把 7 天没访问过的 GitHub issue 建议归档', type: 'archive_candidate', domain: 'github.com', urlPattern: '/issues/', inactiveDays: 7, action: 'suggest_archive' };
const PROTECT = { rawText: 'github.com 永远不要归档', type: 'never_archive', domain: 'github.com', action: 'keep' };

test('TC-API-CLEAN-019 never_archive 优先于归档规则', async ({ api }) => {
  const now = Date.now();
  await test.step('S1：同步平移后的样例', () => api.seed(samplePayload({ now })));
  const ruleId = await test.step('S2：同时保存归档规则与 GitHub 保护规则', async () => {
    const r = await api.post('/api/rules', { rules: [ARCHIVE, PROTECT] });
    expect(r.status, '[E1] 两条规则保存成功').toBe(201);
    const id = r.body.rules.find(rule => rule.type === 'never_archive').id;
    expect(id, '[E1] 保护规则 id 非空').toMatch(/\S/);
    return id;
  });
  await test.step('S3：核对保护优先及其他域名不受影响', async () => {
    const r = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
    expect(r.status, '[E1] 返回 200').toBe(200);
    const item = r.body.suggestions.find(s => s.action === 'keep' && s.url === ISSUE);
    expect(item, '[E1] 旧 issue 被保护规则保留').toMatchObject({ url: ISSUE, ruleId });
    expect(item.reason, '[E1] 理由包含 GitHub 保护域名').toContain('被保护域名配置（github.com）');
    const archives = r.body.suggestions.filter(s => s.action === 'archive');
    expect(archives.map(s => s.url), '[E2] 旧 issue 不在归档建议中').not.toContain(ISSUE);
    expect(archives.find(s => s.url === GOOGLE), '[E3] Google 仍按 35 天归档').toMatchObject({ url: GOOGLE, ageDays: 35 });
  });
});
