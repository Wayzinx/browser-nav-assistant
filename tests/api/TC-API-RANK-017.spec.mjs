// 用例：TC-API-RANK-017；F-RANK-03 AC2；D-20 未访问天数向下取整
import { test, expect, samplePayload } from '../fixtures/api.mjs';

test('TC-API-RANK-017 旧页面理由包含未访问天数', async ({ api }) => {
  const T = Date.now();
  await test.step('S1：POST /api/sync 导入平移后的样例', () => api.seed(samplePayload({ now: T })));

  const r = await test.step('S2：GET /api/pages/ranked?limit=500&now=T', () =>
    api.get('/api/pages/ranked', { params: { limit: 500, now: T } }));
  const reason = Object.fromEntries(r.body.pages.map((p) => [p.url, p.reason]));

  expect(reason['https://github.com/org/repo/issues/100'], '[E1] issues/100 理由').toBe('已 24 天未访问，常用域名 github.com');
  expect(reason['https://www.google.com/search?q=chrome+extension+manifest+v3'], '[E2] Google 搜索页理由').toBe('已 35 天未访问');
});
