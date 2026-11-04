import { test, expect } from '../fixtures/api.mjs';

// features: F-RULE-07
// codePoints: C-BE-RULE-06, C-BE-RULE-08, C-BE-CORE-11

test("TC-API-RULE-032 空规则库返回200空数组及total=0", async ({ api }) => {
  await test.step('S1：通过真实 HTTP 重置本例状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });

  await test.step('S2：读取空列表和健康计数', async () => {
    const list = await api.get('/api/rules');
    expect(list.status, '[E2] 空列表返回 200').toBe(200);
    expect(list.body, '[E2] 返回空数组与 total=0').toEqual({ rules: [], total: 0 });
    const health = await api.get('/api/health');
    expect(health.status, '[E3] 健康检查成功').toBe(200);
    expect(health.body, '[E3] 全部规则计数和页面数为零').toMatchObject({ ruleCount: 0, enabledRuleCount: 0, pageCount: 0 });
  });
});
