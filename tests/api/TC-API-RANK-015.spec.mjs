// 用例：TC-API-RANK-015；D-01：超过「现在 + 5 分钟」的时间戳按「现在」处理
import { test, expect, DAY } from '../fixtures/api.mjs';

const FUTURE = 'https://example.com/future';

test('TC-API-RANK-015 未来时间戳按现在处理，recency 不超过 1', async ({ api }) => {
  const T = Date.now();

  const s = await test.step('S1：POST /api/sync 导入未来时间戳页面，记录 syncedAt', () =>
    api.post('/api/sync', { activeTab: null, openTabs: [], history: [{ url: FUTURE, title: 'future', lastVisitTime: T + 30 * DAY, visitCount: 3 }] }));
  expect(s.status, '[E1] 同步返回 200').toBe(200);
  expect(s.body.created, '[E1] created=1').toBe(1);

  const r = await test.step('S2：GET /api/pages/ranked?limit=500&now=T', () =>
    api.get('/api/pages/ranked', { params: { limit: 500, now: T } }));
  const p = r.body.pages.find((x) => x.url === FUTURE);

  expect(p.scoreDetail, '[E2] recency=1.00、frequency=1.00、domain=1.00、open=0').toMatchObject({ recency: 1, frequency: 1, domain: 1, open: 0 });
  expect(p.score, '[E2] score=0.80').toBe(0.8);

  expect(p.lastVisitedAt, '[E3] lastVisitedAt ≤ T+5 分钟').toBeLessThanOrEqual(T + 300_000);
  expect(Math.abs(p.lastVisitedAt - s.body.syncedAt), '[E3] 与 syncedAt 之差不超过 5000ms').toBeLessThanOrEqual(5000);

  for (const x of r.body.pages) {
    for (const [k, v] of Object.entries({ score: x.score, recency: x.scoreDetail.recency, frequency: x.scoreDetail.frequency, open: x.scoreDetail.open, domain: x.scoreDetail.domain })) {
      expect(v, `[E4] ${x.url} ${k} ≥ 0`).toBeGreaterThanOrEqual(0);
      expect(v, `[E4] ${x.url} ${k} ≤ 1`).toBeLessThanOrEqual(1);
    }
  }
});
