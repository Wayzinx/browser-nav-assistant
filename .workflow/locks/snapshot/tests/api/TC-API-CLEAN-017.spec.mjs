import { test, expect, DAY, HOUR } from '../fixtures/api.mjs';

const ISSUE8 = 'https://github.com/org/repo/issues/88';
const ISSUE7 = 'https://github.com/org/repo/issues/89';
const RULE7 = { rawText: '把 7 天没访问过的 GitHub issue 建议归档', type: 'archive_candidate', domain: 'github.com', urlPattern: '/issues/', inactiveDays: 7, action: 'suggest_archive' };
const RULE10 = { ...RULE7, rawText: '把 10 天没访问过的 GitHub issue 建议归档', inactiveDays: 10 };

test('TC-API-CLEAN-017 多条归档规则取最小阈值并按整天数判定', async ({ api }) => {
  const now = Date.now();
  await test.step('S1：同步 8 天和 7 天 23 小时未访问的两个 issue', () => api.seed({
    activeTab: null, openTabs: [], history: [
      { url: ISSUE8, lastVisitTime: now - 8 * DAY, visitCount: 1 },
      { url: ISSUE7, lastVisitTime: now - 7 * DAY - 23 * HOUR, visitCount: 1 },
    ],
  }));
  const ids = await test.step('S2：保存 7 天和 10 天规则并按阈值提取 id', async () => {
    const r = await api.post('/api/rules', { rules: [RULE7, RULE10] });
    expect(r.status, '[E2] 两条规则保存成功').toBe(201);
    expect(r.body.rules, '[E2] 返回两条规则').toHaveLength(2);
    const id7 = r.body.rules.find(rule => rule.inactiveDays === 7).id;
    const id10 = r.body.rules.find(rule => rule.inactiveDays === 10).id;
    expect(id7, '[E2] 7 天规则 id 非空').toMatch(/\S/);
    expect(id10, '[E2] 10 天规则 id 非空').toMatch(/\S/);
    expect(id7, '[E2] 两条规则 id 不同').not.toBe(id10);
    return { id7, id10 };
  });
  await test.step('S3：读取多规则阈值下的整理建议', async () => {
    const r = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
    expect(r.status, '[E1] 返回 200').toBe(200);
    const archives = r.body.suggestions.filter(s => s.action === 'archive');
    const item = archives.find(s => s.url === ISSUE8);
    expect(item, '[E1] 8 天 issue 被归档').toMatchObject({ ageDays: 8 });
    expect(item.reason, '[E2] 理由精确使用较小的 7 天阈值').toBe('超过 7 天未访问（已 8 天），且不在当前打开的 tab 中；命中规则「把 7 天没访问过的 GitHub issue 建议归档」');
    expect(item.ruleId, '[E2] 引用 7 天规则').toBe(ids.id7);
    expect(item.ruleId, '[E2] 不引用 10 天规则').not.toBe(ids.id10);
    expect(archives.map(s => s.url), '[E3] 7 天 23 小时向下取整后不归档').not.toContain(ISSUE7);
    expect(r.body.summary.archive, '[E4] 只有一条归档建议').toBe(1);
  });
});
