import { test, expect, HOUR } from '../fixtures/api.mjs';

const URLS = ['https://www.google.com/search?q=a', 'https://www.google.com/search?q=b'];

test('TC-API-CLEAN-010 语义参数 q 不同的搜索页不合并', async ({ api }) => {
  const now = Date.now();
  await test.step('S1：同步两个不同搜索词的历史', async () => {
    const r = await api.post('/api/sync', {
      activeTab: null, openTabs: [],
      history: URLS.map((url, i) => ({ url, lastVisitTime: now - (i + 1) * HOUR, visitCount: 1 })),
    });
    expect(r.status, '[E1] 返回 200').toBe(200);
    expect(r.body.created, '[E1] 两个页面分别入库').toBe(2);
  });
  await test.step('S2：读取整理建议确认语义参数参与判重', async () => {
    const r = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
    expect(r.status, '[E2] 返回 200').toBe(200);
    expect(r.body.suggestions.filter(s => s.action === 'merge' && URLS.every(url => s.urls.includes(url))), '[E2] 没有同时包含两个搜索页的组').toEqual([]);
    expect(r.body.summary, '[E3] 不合并且不归档近期页面').toMatchObject({ merge: 0, archive: 0 });
  });
});
