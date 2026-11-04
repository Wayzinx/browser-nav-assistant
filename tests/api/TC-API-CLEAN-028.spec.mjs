import { test, expect, samplePayload } from '../fixtures/api.mjs';

const GOOGLE = 'https://www.google.com/search?q=chrome+extension+manifest+v3';
const ISSUE = 'https://github.com/org/repo/issues/100';

test('TC-API-CLEAN-028 部分 URL 存在时只归档存在的页面', async ({ api }) => {
  const now = Date.now();
  await test.step('S1：同步平移后的样例', () => api.seed(samplePayload({ now })));
  await test.step('S2：同时归档存在和不存在的 URL', async () => {
    const r = await api.post('/api/pages/archive', { urls: [GOOGLE, 'https://example.com/not-exist'] });
    expect(r.status, '[E1] 部分存在返回 200').toBe(200);
    expect(r.body, '[E1] 实际归档一页且一页未找到').toMatchObject({ affected: 1, notFound: 1 });
  });
  await test.step('S3：回读整理建议', async () => {
    const r = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
    expect(r.status, '[E2] 返回 200').toBe(200);
    const urls = r.body.suggestions.filter(s => s.action === 'archive').map(s => s.url);
    expect(urls, '[E2] Google 已移除且只剩旧 issue').toEqual([ISSUE]);
    expect(urls, '[E2] 已归档的 Google 不再出现').not.toContain(GOOGLE);
    expect(r.body.summary.archive, '[E2] 只剩一条归档建议').toBe(1);
  });
});
