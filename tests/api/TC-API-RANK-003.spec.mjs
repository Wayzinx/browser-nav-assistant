// 用例：TC-API-RANK-003；F-RANK-01 AC3；openOnly=true 只返回打开中的页面
import { test, expect, samplePayload } from '../fixtures/api.mjs';

const OPEN = [
  'https://github.com/org/repo/issues/123',
  'https://github.com/org/repo/pull/456',
  'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API',
  'https://docs.internal.com/ai-agent-design',
];

test('TC-API-RANK-003 openOnly=true 只返回 4 个打开中的页面', async ({ api }) => {
  const T = Date.now();
  await test.step('S1：POST /api/sync 导入平移后的样例', () => api.seed(samplePayload({ now: T })));

  const r = await test.step('S2：GET /api/pages/ranked?openOnly=true&now=T', () =>
    api.get('/api/pages/ranked', { params: { openOnly: 'true', now: T } }));

  expect(r.status, '[E1] 返回 200').toBe(200);
  expect(r.body.total, '[E1] total=4').toBe(4);
  expect(r.body.pages, '[E1] pages 共 4 条').toHaveLength(4);
  expect(r.body.pages.map((p) => p.url), '[E2] 按 score 降序的 4 个打开页面').toEqual(OPEN);
  expect(r.body.pages.map((p) => p.isOpen), '[E3] 每一项 isOpen=true').toEqual([true, true, true, true]);
  expect(r.body.pages.map((p) => p.url), '[E3] 不包含未打开的 useState 页面').not.toContain('https://react.dev/reference/react/useState');
});
