import { test, expect } from '../fixtures/api.mjs';

// features: F-RULE-08
// codePoints: C-BE-RULE-06, C-BE-RULE-08, C-BE-CORE-11

test("TC-API-RULE-035 最后一条规则删除后归零且重复删除返回404", async ({ api }) => {
  await test.step('S1：通过真实 HTTP 重置本例状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });

  const saved = await test.step('S2：保存本例唯一规则并记录正式 id', async () => {
    const r = await api.post('/api/rules', { rules: [{ rawText: '保护docs', type: 'never_archive', domain: 'docs.internal.com' }] });
    expect(r.status, '[E2] 前置保存成功').toBe(201);
    expect(r.body.rules, '[E2] 仅保存一条规则').toHaveLength(1);
    expect(r.body.rules[0].id, '[E2] 获得正式 id').toMatch(/\S/);
    return r.body.rules[0];
  });
  const empty = await test.step('S3：删除最后一条规则并记录空库快照', async () => {
    const r = await api.del(`/api/rules/${saved.id}`);
    expect(r.status, '[E2] 第一次删除返回 200').toBe(200);
    expect(r.body, '[E2] 删除对应 id 且总数归零').toEqual({ deleted: saved.id, ruleCount: 0 });
    const list = await api.get('/api/rules');
    const health = await api.get('/api/health');
    expect(list.status, '[E3] 空列表可读取').toBe(200);
    expect(list.body, '[E3] 规则库完全为空').toEqual({ rules: [], total: 0 });
    expect(health.status, '[E3] 健康检查成功').toBe(200);
    expect(health.body, '[E3] 规则计数归零').toMatchObject({ ruleCount: 0, enabledRuleCount: 0 });
    return list.body;
  });
  await test.step('S4：重复删除同一个正式 id 并回读', async () => {
    const r = await api.del(`/api/rules/${saved.id}`);
    expect(r.status, '[E4] 重复删除返回 404').toBe(404);
    expect(r.body.error.code, '[E4] 资源不存在').toBe('NOT_FOUND');
    expect(r.body.error.message, '[E5] 重复删除错误说明非空').toMatch(/\S/);
    const list = await api.get('/api/rules');
    expect(list.status, '[E6] 回读成功').toBe(200);
    expect(list.body, '[E6] 空库快照不变').toEqual(empty);
    const health = await api.get('/api/health');
    expect(health.status, '[E6] 健康检查成功').toBe(200);
    expect(health.body, '[E6] 规则与页面仍为零').toMatchObject({ ruleCount: 0, pageCount: 0 });
  });
});
