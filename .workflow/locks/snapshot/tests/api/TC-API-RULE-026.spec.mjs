import { test, expect } from '../fixtures/api.mjs';

// features: F-RULE-06
// codePoints: C-BE-RULE-05, C-BE-RULE-06, C-BE-RULE-08

test("TC-API-RULE-026 保存数组最小1条与最大20条均接受且id唯一", async ({ api }) => {
  await test.step('S1：通过真实 HTTP 重置本例状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });

  for (const n of [1, 20]) {
    const rules = await test.step('S2：每轮重置并构造合法规则数组边界', async () => {
      const reset = await api.post('/api/__test__/reset', {});
      expect(reset.status, '[E2] 每轮重置成功').toBe(200);
      expect(reset.body.ok, '[E2] 每轮重置确认').toBe(true);
      return Array.from({ length: n }, (_, i) => ({ rawText: `保护边界${i}`, type: 'never_archive', domain: `edge${i}.example.com` }));
    });
    await test.step('S3：保存本轮边界并立即回读', async () => {
      const r = await api.post('/api/rules', { rules });
      expect(r.status, '[E2] 边界保存返回 201').toBe(201);
      expect(r.body.rules, '[E2] 本次保存数量准确').toHaveLength(n);
      expect(r.body.ruleCount, '[E2] 规则总数为本轮 n').toBe(n);
      for (const rule of r.body.rules) {
        expect(rule.id, '[E3] 正式 id 是非空字符串').toMatch(/\S/);
        expect(rule.enabled, '[E3] 默认启用').toBe(true);
      }
      expect(new Set(r.body.rules.map(rule => rule.id)).size, '[E3] 本轮 id 互不重复').toBe(n);
      const list = await api.get('/api/rules');
      expect(list.status, '[E4] 列表成功').toBe(200);
      expect(list.body.total, '[E4] 列表总数准确').toBe(n);
      expect(list.body.rules.map(rule => rule.rawText), '[E4] 原文按创建顺序').toEqual(rules.map(rule => rule.rawText));
      expect(list.body.rules.map(rule => rule.id), '[E4] 列表 id 顺序与保存一致').toEqual(r.body.rules.map(rule => rule.id));
      const health = await api.get('/api/health');
      expect(health.status, '[E5] 健康检查成功').toBe(200);
      expect(health.body, '[E5] 本轮健康计数正确').toMatchObject({ ruleCount: n, enabledRuleCount: n, pageCount: 0 });
    });
  }
});
