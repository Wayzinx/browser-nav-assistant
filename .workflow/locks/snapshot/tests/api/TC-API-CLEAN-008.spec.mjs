import { test, expect, samplePayload } from '../fixtures/api.mjs';

const ISSUE = 'https://github.com/org/repo/issues/123';

test('TC-API-CLEAN-008 样例的 query 变体恰好组成一个重复组', async ({ api }) => {
  const now = Date.now();
  await test.step('S1：POST /api/sync 导入平移后的样例', () => api.seed(samplePayload({ now })));
  await test.step('S2：读取整理建议中的 merge 项', async () => {
    const r = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
    expect(r.status, '[E1] 返回 200').toBe(200);
    const merges = r.body.suggestions.filter(s => s.action === 'merge');
    expect(merges, '[E1] 恰好一条合并建议').toHaveLength(1);
    expect(r.body.summary.merge, '[E1] 合并汇总为一').toBe(1);
    expect([...merges[0].urls].sort(), '[E2] 重复组的两个 URL 精确匹配').toEqual([ISSUE, `${ISSUE}?tab=comments`]);
    expect(merges[0].keepUrl, '[E3] 保留不带 query 的 URL').toBe(ISSUE);
    expect(merges[0].reason, '[E4] 合并理由精确匹配').toBe('去掉 query 参数后 URL 相同，疑似重复页面');
    expect(merges[0].titles, '[E5] 两个原标题都保留').toEqual(expect.arrayContaining(['Fix login redirect bug', 'Fix login redirect bug - Comments']));
  });
});
