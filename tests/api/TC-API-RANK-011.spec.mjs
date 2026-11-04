// 用例：TC-API-RANK-011；F-RANK-02 AC1；期望分数取自 PRD 13.3
import { test, expect, samplePayload } from '../fixtures/api.mjs';

test('TC-API-RANK-011 评分公式样例核对 8 个代表页面', async ({ api }) => {
  const T = Date.now();
  await test.step('S1：POST /api/sync 导入平移后的样例', () => api.seed(samplePayload({ now: T })));

  const r = await test.step('S2：GET /api/pages/ranked?limit=500&now=T，按 url 建索引', () =>
    api.get('/api/pages/ranked', { params: { limit: 500, now: T } }));
  expect(r.status, '[E1] 返回 200').toBe(200);
  const score = Object.fromEntries(r.body.pages.map((p) => [p.url, p.score]));

  expect(score['https://github.com/org/repo/issues/123'], '[E2] issues/123=1.00').toBe(1);
  expect(score['https://github.com/org/repo/pull/456'], '[E2] pull/456=0.94').toBe(0.94);
  expect(score['https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API'], '[E2] Fetch_API=0.83').toBe(0.83);
  expect(score['https://react.dev/reference/react/useState'], '[E3] useState=0.69').toBe(0.69);
  expect(score['https://react.dev/learn'], '[E3] react.dev/learn=0.57').toBe(0.57);
  expect(score['https://docs.internal.com/ai-agent-design'], '[E4] docs.internal=0.56').toBe(0.56);
  expect(score['https://github.com/org/repo/issues/100'], '[E4] issues/100=0.23').toBe(0.23);
  expect(score['https://www.google.com/search?q=chrome+extension+manifest+v3'], '[E4] Google 搜索页=0.11').toBe(0.11);

  for (const p of r.body.pages) {
    expect(typeof p.score, `[E5] ${p.url} score 为数字`).toBe('number');
    expect(Math.abs(p.score * 100 - Math.round(p.score * 100)), `[E5] ${p.url} score 保留 2 位小数`).toBeLessThan(1e-9);
  }
});
