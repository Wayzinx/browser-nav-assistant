import { test, expect } from '../fixtures/api.mjs';

// features: F-RULE-06, F-RULE-07
// codePoints: C-BE-RULE-05, C-BE-RULE-06, C-BE-CORE-11

test("TC-API-RULE-031 保存补齐action和默认值并忽略客户端id与解析notes", async ({ api }) => {
  await test.step('S1：通过真实 HTTP 重置本例状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });

  const saved = await test.step('S2：提交客户端 id 和解析 notes 并省略默认字段', async () => {
    const r = await api.post('/api/rules', { rules: [{ id: 'client_injected_id', notes: ['客户端解析提示'], rawText: '保护docs', type: 'never_archive', domain: 'docs.internal.com' }] });
    expect(r.status, '[E2] 保存返回 201').toBe(201);
    expect(r.body.rules, '[E2] 保存一条规则').toHaveLength(1);
    expect(r.body.ruleCount, '[E2] 总数为一').toBe(1);
    const rule = r.body.rules[0];
    expect(rule.id, '[E3] 服务端正式 id 使用 rule_ 前缀且非空').toMatch(/^rule_\S+$/);
    expect(rule.id, '[E3] 不采纳客户端 id').not.toBe('client_injected_id');
    expect(rule, '[E4] 补齐 action 与默认值').toMatchObject({ action: 'keep', enabled: true, confidence: 'high' });
    expect(rule.notes === undefined ? [] : rule.notes, '[E5] 客户端解析 notes 只允许被移除或清空').toEqual([]);
    expect(rule, '[E6] 创建和更新时间为数值').toMatchObject({ createdAt: expect.any(Number), updatedAt: expect.any(Number) });
    return rule;
  });
  await test.step('S3：回读服务端补齐后的正式规则', async () => {
    const list = await api.get('/api/rules');
    expect(list.status, '[E7] 列表返回 200').toBe(200);
    expect(list.body.total, '[E7] 总数为一').toBe(1);
    expect(list.body.rules, '[E7] 唯一规则与保存结果深度相等').toEqual([saved]);
    const health = await api.get('/api/health');
    expect(health.status, '[E8] 健康检查成功').toBe(200);
    expect(health.body, '[E8] 健康计数正确').toMatchObject({ ruleCount: 1, enabledRuleCount: 1, pageCount: 0 });
  });
});
