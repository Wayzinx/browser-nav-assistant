// 用例：TC-API-RANK-010；domain 过滤的子域边界（等于该域名或为其子域，不按字符串后缀）
import { test, expect, HOUR } from '../fixtures/api.mjs';

test('TC-API-RANK-010 domain 过滤匹配子域但不匹配后缀相同的域名', async ({ api }) => {
  const T = Date.now();
  const history = ['https://react.dev/a', 'https://sub.react.dev/b', 'https://notreact.dev/c']
    .map((url) => ({ url, title: url, lastVisitTime: T - HOUR, visitCount: 1 }));

  const s = await test.step('S1：POST /api/sync 导入 3 条 history', () =>
    api.post('/api/sync', { activeTab: null, openTabs: [], history }));
  expect(s.status, '[E1] 同步返回 200').toBe(200);
  expect(s.body, '[E1] created=3、pageCount=3').toMatchObject({ created: 3, pageCount: 3 });

  const q = (domain) => api.get('/api/pages/ranked', { params: { domain, limit: 500, now: T } });

  const a = await test.step('S2：GET /api/pages/ranked?domain=react.dev&limit=500&now=T', () => q('react.dev'));
  expect(a.body.total, '[E2] react.dev 匹配 2 个页面').toBe(2);
  expect(a.body.pages.map((p) => p.url).sort(), '[E2] url 集合为 react.dev/a 与 sub.react.dev/b')
    .toEqual(['https://react.dev/a', 'https://sub.react.dev/b']);
  expect(a.body.pages.map((p) => p.url), '[E2] 不包含 notreact.dev/c').not.toContain('https://notreact.dev/c');

  const b = await test.step('S3：GET /api/pages/ranked?domain=sub.react.dev&limit=500&now=T', () => q('sub.react.dev'));
  expect(b.body.total, '[E3] sub.react.dev 只匹配 1 个页面').toBe(1);
  expect(b.body.pages[0].url, '[E3] 为 sub.react.dev/b').toBe('https://sub.react.dev/b');

  const c = await test.step('S4：GET /api/pages/ranked?domain=notreact.dev&limit=500&now=T', () => q('notreact.dev'));
  expect(c.body.total, '[E4] notreact.dev 只匹配 1 个页面').toBe(1);
  expect(c.body.pages[0].url, '[E4] 为 notreact.dev/c').toBe('https://notreact.dev/c');
});
