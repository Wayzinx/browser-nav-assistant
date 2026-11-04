import { test, expect } from '../fixtures/api.mjs';

test('TC-API-CLEAN-002 空库返回空建议及零汇总', async ({ api }) => {
  await test.step('S1：GET /api/health 核对空库', async () => {
    const r = await api.get('/api/health');
    expect(r.status, '[E1] 健康检查返回 200').toBe(200);
    expect(r.body, '[E1] 页面和规则都为零').toMatchObject({ pageCount: 0, ruleCount: 0 });
  });
  await test.step('S2：GET /api/pages/cleanup-suggestions 不指定时间', async () => {
    const r = await api.get('/api/pages/cleanup-suggestions');
    expect(r.status, '[E2] 空库也返回 200').toBe(200);
    expect(r.body.suggestions, '[E2] 建议为空数组').toEqual([]);
    expect(r.body.summary, '[E3] 三类计数都为零').toEqual({ archive: 0, merge: 0, keep: 0 });
    expect(r.body.thresholdDays, '[E3] 默认阈值仍为 14 天').toBe(14);
  });
});
