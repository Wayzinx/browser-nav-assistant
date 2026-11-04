// 用例：TC-API-RANK-020；PRD 6.3 理由首句的时段边界；D-20 未访问天数向下取整，归档阈值 14 天
import { test, expect, DAY, HOUR } from '../fixtures/api.mjs';

const BASE = 'https://example.com/p';

test('TC-API-RANK-020 理由首句按未访问时长选择文案', async ({ api }) => {
  const T = Date.now();
  const ages = [20 * HOUR, 2 * DAY, 3 * DAY + HOUR, 13 * DAY, 14 * DAY];
  const history = ages.map((age, n) => ({ url: `${BASE}${n}`, title: `p${n}`, lastVisitTime: T - age, visitCount: 1 }));

  await test.step('S1：POST /api/sync 导入 5 条 history', () => api.seed({ activeTab: null, openTabs: [], history }));

  const r = await test.step('S2：GET /api/pages/ranked?limit=500&now=T，按 path 取理由第 1 句', () =>
    api.get('/api/pages/ranked', { params: { limit: 500, now: T } }));
  const reason = Object.fromEntries(r.body.pages.map((p) => [p.url, p.reason]));
  const first = (n) => reason[`${BASE}${n}`].split('，')[0];

  expect(first(0), '[E1] 20 小时前：今天访问过').toBe('今天访问过');
  expect(first(1), '[E2] 2 天前：最近 3 天内访问').toBe('最近 3 天内访问');
  expect(first(2), '[E2] 3 天 1 小时前：3 天前访问').toBe('3 天前访问');
  expect(first(3), '[E3] 13 天前：13 天前访问').toBe('13 天前访问');
  expect(first(4), '[E3] 14 天前：已 14 天未访问').toBe('已 14 天未访问');

  for (let n = 0; n < 5; n++) {
    const text = reason[`${BASE}${n}`];
    expect(text.split('，').length, `[E4] /p${n} 理由不超过 3 句`).toBeLessThanOrEqual(3);
    expect(text, `[E4] /p${n} 理由以「，常用域名 example.com」结尾`).toMatch(/，常用域名 example\.com$/);
  }
});
