import { test, expect, samplePayload } from '../fixtures/api.mjs';

const KEEP = 'https://github.com/org/repo/issues/123';
const COMMENTS = `${KEEP}?tab=comments`;

test('TC-API-CLEAN-025 合并重复组后只保留主 URL', async ({ api }) => {
  const now = Date.now();
  await test.step('S1：同步平移后的样例', () => api.seed(samplePayload({ now })));
  await test.step('S2：合并 issues/123 的 query 变体', async () => {
    const r = await api.post('/api/pages/merge', { urls: [KEEP, COMMENTS], keepUrl: KEEP });
    expect(r.status, '[E1] 合并返回 200').toBe(200);
    expect(r.body, '[E1] 保留主 URL 并合并一页').toMatchObject({ ok: true, keepUrl: KEEP, merged: 1 });
  });
  await test.step('S3：读取合并后的排序结果', async () => {
    const r = await api.get('/api/pages/ranked', { params: { limit: 500 } });
    expect(r.status, '[E2] 返回 200').toBe(200);
    const urls = r.body.pages.map(p => p.url);
    expect(urls, '[E2] 主 URL 保留').toContain(KEEP);
    expect(urls, '[E2] comments 变体不再出现').not.toContain(COMMENTS);
    expect(r.body.total, '[E2] 未归档页数为九').toBe(9);
  });
  await test.step('S4：读取合并后的整理建议', async () => {
    const r = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
    expect(r.status, '[E3] 返回 200').toBe(200);
    expect(r.body.summary.merge, '[E3] 重复组数归零').toBe(0);
    expect(r.body.suggestions.filter(s => s.action === 'merge'), '[E3] 不再有合并建议').toEqual([]);
  });
});
