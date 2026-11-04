// 来源：docs/trace/cases-api.json TC-API-DIAG-004（F-DIAG-09#AC2；C-BE-DIAG-01, C-BE-CORE-12）
// 规则 id 由后端生成，从 S1 响应中取，不写死。
import { test, expect } from '../fixtures/api.mjs';

const RULES = [
  { rawText: '把 7 天没访问过的 GitHub issue 建议归档', type: 'archive_candidate', domain: 'github.com', urlPattern: '/issues/', inactiveDays: 7, action: 'suggest_archive' },
  { rawText: 'docs.internal.com 的页面永远不要归档', type: 'never_archive', domain: 'docs.internal.com', action: 'keep' },
];

test('TC-API-DIAG-004 停用 1 条规则后 ruleCount 仍为 2、enabledRuleCount=1；删除该规则后 ruleCount=1', async ({ api }) => {
  const r2 = await test.step('S1：POST /api/rules 保存规则①②，记录 never_archive 的 id 为 R2', async () => {
    const r = await api.post('/api/rules', { rules: RULES });
    expect(r.status, '[E1] 保存规则返回 201').toBe(201);
    expect(r.body.ruleCount, '[E1] ruleCount=2').toBe(2);
    const keep = r.body.rules.find((x) => x.type === 'never_archive');
    expect(keep, 'S1 返回中包含 never_archive 规则').toMatchObject({ type: 'never_archive' });
    return keep.id;
  });

  await test.step('S2：GET /api/health', async () => {
    const r = await api.get('/api/health');
    expect(r.body, '[E2] ruleCount=2、enabledRuleCount=2').toMatchObject({ ruleCount: 2, enabledRuleCount: 2 });
  });

  await test.step('S3：PATCH /api/rules/<R2> { enabled: false }', async () => {
    const r = await api.patch(`/api/rules/${r2}`, { enabled: false });
    expect(r.status, '[E3] 停用返回 200').toBe(200);
    expect(r.body, '[E3] id=R2、enabled=false').toMatchObject({ id: r2, enabled: false });
  });

  await test.step('S4：GET /api/health', async () => {
    const r = await api.get('/api/health');
    expect(r.body, '[E4] ruleCount=2、enabledRuleCount=1').toMatchObject({ ruleCount: 2, enabledRuleCount: 1 });
  });

  await test.step('S5：DELETE /api/rules/<R2>', async () => {
    const r = await api.del(`/api/rules/${r2}`);
    expect(r.status, '[E5] 删除返回 200').toBe(200);
    expect(r.body, '[E5] deleted=R2、ruleCount=1').toMatchObject({ deleted: r2, ruleCount: 1 });
  });

  await test.step('S6：GET /api/health', async () => {
    const r = await api.get('/api/health');
    expect(r.body, '[E6] ruleCount=1、enabledRuleCount=1').toMatchObject({ ruleCount: 1, enabledRuleCount: 1 });
  });
});
