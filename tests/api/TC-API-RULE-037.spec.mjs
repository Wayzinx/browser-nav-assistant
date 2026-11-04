import { test, expect, samplePayload } from '../fixtures/api.mjs';

// features: F-RULE-09
// codePoints: C-BE-RULE-06, C-BE-RULE-08

const DOCS = "https://docs.internal.com/ai-agent-design";

test("TC-API-RULE-037 停用再启用正式保护规则后keep消失再恢复", async ({ api }) => {
  await test.step('S1：通过真实 HTTP 重置本例状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });

  const now = await test.step('S2：按 D-01 平移样例并通过真实 sync 导入', async () => {
    const n = Date.now();
    const r = await api.post('/api/sync', samplePayload({ now: n }));
    expect(r.status, '[E2] 样例同步返回 200').toBe(200);
    expect(r.body.pageCount, '[E2] 样例包含十个去重页面').toBe(10);
    return n;
  });
  const keepId = await test.step('S3：保存启用的保护规则并核对初始 keep', async () => {
    const saved = await api.post('/api/rules', { rules: [{ rawText: 'docs.internal.com 的页面永远不要归档', type: 'never_archive', domain: 'docs.internal.com', action: 'keep' }] });
    expect(saved.status, '[E3] 保存返回 201').toBe(201);
    expect(saved.body.ruleCount, '[E3] 保存一条保护规则').toBe(1);
    expect(saved.body.rules, '[E3] 保存响应只有一条规则').toHaveLength(1);
    const id = saved.body.rules[0].id;
    expect(id, '[E3] 取得正式保护 id').toMatch(/\S/);
    const cleanup = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
    expect(cleanup.status, '[E3] 初始整理建议成功').toBe(200);
    expect(cleanup.body.suggestions, '[E3] 初始保护建议引用本次 id').toEqual(expect.arrayContaining([expect.objectContaining({ action: 'keep', url: DOCS, ruleId: id })]));
    return id;
  });
  await test.step('S4：停用同一正式规则并验证建议与计数', async () => {
    const r = await api.patch(`/api/rules/${keepId}`, { enabled: false });
    expect(r.status, '[E4] 停用返回 200').toBe(200);
    expect(r.body, '[E4] PATCH 直接返回顶层规则对象').toMatchObject({ id: keepId, enabled: false, updatedAt: expect.any(Number) });
    const cleanup = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
    expect(cleanup.status, '[E5] 停用后整理建议成功').toBe(200);
    expect(cleanup.body.summary, '[E5] keep 消失').toEqual({ archive: 2, merge: 1, keep: 0 });
    expect(cleanup.body.suggestions.filter(item => item.url === DOCS && ['keep', 'archive'].includes(item.action)), '[E5] docs 不被保留或错误归档').toHaveLength(0);
    const health = await api.get('/api/health');
    expect(health.status, '[E6] 健康检查成功').toBe(200);
    expect(health.body, '[E6] 规则仍存在但启用数归零').toMatchObject({ ruleCount: 1, enabledRuleCount: 0, pageCount: 10 });
  });
  await test.step('S5：重新启用并核对同 id 的保护恢复', async () => {
    const r = await api.patch(`/api/rules/${keepId}`, { enabled: true });
    expect(r.status, '[E7] 启用返回 200').toBe(200);
    expect(r.body, '[E7] 同一正式 id 重新启用').toMatchObject({ id: keepId, enabled: true });
    const cleanup = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
    expect(cleanup.status, '[E8] 恢复后整理建议成功').toBe(200);
    expect(cleanup.body.summary, '[E8] 恢复唯一 keep').toEqual({ archive: 2, merge: 1, keep: 1 });
    const kept = cleanup.body.suggestions.filter(item => item.action === 'keep');
    expect(kept, '[E8] keep 只有一条').toHaveLength(1);
    expect(kept[0], '[E8] 恢复原 docs 保护 id').toMatchObject({ url: DOCS, ruleId: keepId });
    const list = await api.get('/api/rules');
    const health = await api.get('/api/health');
    expect(list.status, '[E9] 规则列表成功').toBe(200);
    expect(list.body.total, '[E9] 仍只有一条规则').toBe(1);
    expect(list.body.rules, '[E9] 唯一规则启用状态正确').toEqual([expect.objectContaining({ id: keepId, enabled: true })]);
    expect(health.status, '[E9] 健康检查成功').toBe(200);
    expect(health.body, '[E9] 启用数恢复且页面不变').toMatchObject({ ruleCount: 1, enabledRuleCount: 1, pageCount: 10 });
  });
});
