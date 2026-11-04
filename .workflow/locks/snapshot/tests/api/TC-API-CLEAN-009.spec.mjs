import { test, expect, HOUR } from '../fixtures/api.mjs';

const URLS = ['https://example.com/doc', 'https://example.com/doc?tab=a', 'https://example.com/doc?tab=b'];

test('TC-API-CLEAN-009 三个非语义 query 变体合成一组', async ({ api }) => {
  const now = Date.now();
  await test.step('S1：同步三个独立 URL 的近期历史', async () => {
    const r = await api.post('/api/sync', {
      activeTab: null, openTabs: [],
      history: URLS.map((url, i) => ({ url, lastVisitTime: now - (i + 1) * HOUR, visitCount: 1 })),
    });
    expect(r.status, '[E1] 同步返回 200').toBe(200);
    expect(r.body.created, '[E1] 三个 normalizedUrl 分别入库').toBe(3);
  });
  await test.step('S2：读取三变体的合并建议', async () => {
    const r = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
    expect(r.status, '[E2] 返回 200').toBe(200);
    expect(r.body.summary, '[E2] 只有一个重复组').toEqual({ archive: 0, merge: 1, keep: 0 });
    const merges = r.body.suggestions.filter(s => s.action === 'merge');
    expect(merges, '[E3] 恰好一个 merge 项').toHaveLength(1);
    expect(merges[0].urls, '[E3] 组内有三个 URL').toHaveLength(3);
    expect([...merges[0].urls].sort(), '[E3] URL 集合精确匹配').toEqual(URLS);
    expect(merges[0], '[E4] 保留最短 URL 且理由准确').toMatchObject({
      keepUrl: URLS[0], reason: '去掉 query 参数后 URL 相同，疑似重复页面',
    });
  });
});
