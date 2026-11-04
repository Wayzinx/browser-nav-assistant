import { test, expect, samplePayload } from '../fixtures/api.mjs';

const ISSUE = 'https://github.com/org/repo/issues/100';
const GOOGLE = 'https://www.google.com/search?q=chrome+extension+manifest+v3';
const RULE = { rawText: '把 7 天没访问过的 GitHub issue 建议归档', type: 'archive_candidate', domain: 'github.com', urlPattern: '/issues/', inactiveDays: 7, action: 'suggest_archive' };

test('TC-API-CLEAN-015 归档规则覆盖阈值且理由引用原文', async ({ api }) => {
  const now = Date.now();
  await test.step('S1：同步平移后的样例', () => api.seed(samplePayload({ now })));
  const ruleId = await test.step('S2：保存 7 天 issue 归档规则并取得 id', async () => {
    const r = await api.post('/api/rules', { rules: [RULE] });
    expect(r.status, '[E2] 规则保存成功').toBe(201);
    expect(r.body.rules[0].id, '[E2] 返回非空规则 id').toMatch(/\S/);
    return r.body.rules[0].id;
  });
  await test.step('S3：核对命中与未命中规则的理由', async () => {
    const r = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
    expect(r.status, '[E1] 返回 200').toBe(200);
    const archives = r.body.suggestions.filter(s => s.action === 'archive');
    const issue = archives.find(s => s.url === ISSUE);
    expect(issue, '[E1] 旧 issue 仍为归档项').toMatchObject({ url: ISSUE });
    expect(issue.reason, '[E1] 精确说明 7 天阈值、24 天年龄和规则原文').toBe('超过 7 天未访问（已 24 天），且不在当前打开的 tab 中；命中规则「把 7 天没访问过的 GitHub issue 建议归档」');
    expect(issue, '[E2] 关联刚保存的规则且年龄不变').toMatchObject({ ruleId, ageDays: 24 });
    expect(archives.find(s => s.url === GOOGLE), '[E3] Google 不命中规则，仍使用默认阈值').toMatchObject({
      reason: '超过 14 天未访问（已 35 天），且不在当前打开的 tab 中', ruleId: null,
    });
    expect(r.body.summary, '[E4] 汇总仍为 2/1/0').toEqual({ archive: 2, merge: 1, keep: 0 });
  });
});
