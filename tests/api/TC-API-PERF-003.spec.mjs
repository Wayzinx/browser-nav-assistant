// 用例：TC-API-PERF-003；F-PERF-02 AC1；PRD 13.4 推荐期望值；缓存 TTL 60 秒
import { test, expect, samplePayload } from '../fixtures/api.mjs';

test('TC-API-PERF-003 相同推荐请求第 2 次命中缓存且结果相同', async ({ api }) => {
  const T = Date.now();
  const payload = samplePayload({ now: T });
  const body = { currentPage: payload.activeTab, openTabs: payload.openTabs, recentHistory: payload.history };
  const rec = () => api.post('/api/recommendations/next', body, { params: { now: T } });

  await test.step('S1：POST /api/sync 导入平移后的样例', async () => {
    const r = await api.post('/api/sync', payload);
    expect(r.status, '[E1] 同步返回 200').toBe(200);
    expect(r.body, '[E1] created=10、pageCount=10').toMatchObject({ created: 10, pageCount: 10 });
  });

  const first = await test.step('S2：POST /api/recommendations/next?now=T（第 1 次）', async () => {
    const r = await rec();
    expect(r.status, '[E2] 第 1 次返回 200').toBe(200);
    expect(r.body.cached, '[E2] 第 1 次 cached=false').toBe(false);
    expect(r.body.recommendations, '[E2] 推荐 3 条').toHaveLength(3);
    const recs = r.body.recommendations;
    expect(recs.map((x) => x.url), '[E3] 推荐 url 顺序').toEqual(['https://github.com/org/repo/actions', 'https://react.dev/reference/react/useState', 'https://react.dev/learn']);
    expect(recs.map((x) => x.strategy), '[E3] strategy 顺序').toEqual(['same_repo', 'global_top', 'global_top']);
    expect(recs.map((x) => x.score), '[E3] score 顺序').toEqual([0.87, 0.46, 0.41]);
    return recs;
  });

  await test.step('S3：POST /api/recommendations/next?now=T（第 2 次，请求体相同）', async () => {
    const r = await rec();
    expect(r.status, '[E4] 第 2 次返回 200').toBe(200);
    expect(r.body.cached, '[E4] 第 2 次 cached=true').toBe(true);
    expect(r.body.recommendations, '[E4] 推荐结果与第 1 次深相等').toEqual(first);
  });
});
