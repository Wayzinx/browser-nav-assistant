// 用例：TC-API-RANK-016；F-RANK-03 AC1；理由文案取 PRD 6.3 / 13.3
import { test, expect, samplePayload } from '../fixtures/api.mjs';

test('TC-API-RANK-016 issues/123 与 pull/456 的理由文案', async ({ api }) => {
  const T = Date.now();
  await test.step('S1：POST /api/sync 导入平移后的样例', () => api.seed(samplePayload({ now: T })));

  const r = await test.step('S2：GET /api/pages/ranked?limit=500&now=T', () =>
    api.get('/api/pages/ranked', { params: { limit: 500, now: T } }));
  const reason = Object.fromEntries(r.body.pages.map((p) => [p.url, p.reason]));

  expect(reason['https://github.com/org/repo/issues/123'], '[E1] issues/123 完整三句理由')
    .toBe('最近 3 天内多次访问（8 次），当前仍处于打开状态，常用域名 github.com');
  expect(reason['https://github.com/org/repo/pull/456'], '[E2] pull/456 以「正在浏览」开头').toMatch(/^正在浏览/);
  expect(reason['https://github.com/org/repo/pull/456'], '[E2] pull/456 完整理由')
    .toBe('正在浏览，最近 3 天内多次访问（5 次），常用域名 github.com');
});
