import { test, expect, samplePayload } from '../fixtures/api.mjs';

// features: F-RULE-09
// codePoints: C-BE-RULE-06, C-BE-RULE-08

test("TC-API-RULE-038 PATCH缺少或非布尔enabled返回400且保护规则仍生效", async ({ api }) => {
  await test.step('S1：通过真实 HTTP 重置本例状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });

  const baseline = await test.step('S2：导入固定时刻样例并保存保护规则快照', async () => {
    const now = Date.now();
    const sync = await api.post('/api/sync', samplePayload({ now }));
    expect(sync.status, '[E4] 样例导入成功').toBe(200);
    expect(sync.body.pageCount, '[E4] 样例去重为十个页面').toBe(10);
    const saved = await api.post('/api/rules', { rules: [{ rawText: '保护docs', type: 'never_archive', domain: 'docs.internal.com' }] });
    expect(saved.status, '[E4] 基线保护保存成功').toBe(201);
    expect(saved.body.rules, '[E4] 基线有一条保护规则').toHaveLength(1);
    const list = await api.get('/api/rules');
    expect(list.status, '[E4] 基线可读取').toBe(200);
    expect(list.body.rules[0].enabled, '[E4] 基线保护规则启用').toBe(true);
    return { now, id: saved.body.rules[0].id, list: list.body };
  });
  await test.step('S3：同一正式 id 逐一提交无效 enabled', async () => {
    for (const input of [{}, { enabled: 'false' }, { enabled: 0 }, { enabled: null }]) {
      const r = await api.patch(`/api/rules/${baseline.id}`, input);
      expect(r.status, '[E2] 每个非法 PATCH 返回 400').toBe(400);
      expect(r.body.error.code, '[E2] 布尔字段校验失败').toBe('VALIDATION_FAILED');
      expect(r.body.error.message, '[E3] 每个错误说明非空').toMatch(/\S/);
    }
  });
  await test.step('S4：回读规则、保护建议与健康计数不变', async () => {
    const list = await api.get('/api/rules');
    expect(list.status, '[E4] 列表成功').toBe(200);
    expect(list.body, '[E4] 包括 enabled 与 updatedAt 的快照不变').toEqual(baseline.list);
    expect(list.body.total, '[E4] 总数为一').toBe(1);
    const cleanup = await api.get('/api/pages/cleanup-suggestions', { params: { now: baseline.now } });
    expect(cleanup.status, '[E5] 整理建议成功').toBe(200);
    expect(cleanup.body.summary.keep, '[E5] 保留一条保护建议').toBe(1);
    expect(cleanup.body.suggestions, '[E5] docs 保护仍引用原正式 id').toEqual(expect.arrayContaining([expect.objectContaining({ action: 'keep', url: 'https://docs.internal.com/ai-agent-design', ruleId: baseline.id })]));
    const health = await api.get('/api/health');
    expect(health.status, '[E6] 健康检查成功').toBe(200);
    expect(health.body, '[E6] 规则仍启用且页面未变').toMatchObject({ ruleCount: 1, enabledRuleCount: 1, pageCount: 10 });
  });
});
