// 用例：TC-API-RANK-014；时效分量边界（recency=0.5^(天/7)）
import { test, expect, DAY } from '../fixtures/api.mjs';

const NEW = 'https://a.example/new';
const OLD = 'https://b.example/old';

test('TC-API-RANK-014 时效分量边界：1 分钟前与 50 天前', async ({ api }) => {
  const T = Date.now();
  const history = [
    { url: NEW, title: 'new', lastVisitTime: T - 60_000, visitCount: 10 },
    { url: OLD, title: 'old', lastVisitTime: T - 50 * DAY, visitCount: 1 },
  ];

  const s = await test.step('S1：POST /api/sync 导入 2 条 history', () =>
    api.post('/api/sync', { activeTab: null, openTabs: [], history }));
  expect(s.status, '[E1] 同步返回 200').toBe(200);
  expect(s.body.created, '[E1] created=2').toBe(2);

  const r = await test.step('S2：GET /api/pages/ranked?limit=500&now=T', () =>
    api.get('/api/pages/ranked', { params: { limit: 500, now: T } }));
  const byUrl = Object.fromEntries(r.body.pages.map((p) => [p.url, p]));

  expect(byUrl[NEW].scoreDetail, '[E2] new 项 recency/frequency/open/domain').toMatchObject({ recency: 1, frequency: 1, open: 0, domain: 1 });
  expect(byUrl[NEW].score, '[E2] new 项 score=0.80').toBe(0.8);

  expect(byUrl[OLD].scoreDetail, '[E3] old 项 recency/frequency/domain').toMatchObject({ recency: 0.01, frequency: 0.29, domain: 0.1 });
  expect(byUrl[OLD].score, '[E3] old 项 score=0.10').toBe(0.1);

  expect(r.body.pages[0].url, '[E4] 0.80 排在 0.10 之前').toBe(NEW);
  for (const p of r.body.pages) {
    expect(p.score, `[E4] ${p.url} score ≥ 0`).toBeGreaterThanOrEqual(0);
    expect(p.score, `[E4] ${p.url} score ≤ 1`).toBeLessThanOrEqual(1);
  }
});
