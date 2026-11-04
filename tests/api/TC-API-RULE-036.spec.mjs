import { test, expect, samplePayload } from '../fixtures/api.mjs';

// features: F-RULE-08
// codePoints: C-BE-RULE-06, C-BE-RULE-08, C-BE-CORE-11

const TEXT = "把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档";
const DOCS = "https://docs.internal.com/ai-agent-design";

test("TC-API-RULE-036 删除保护规则后样例docs的keep消失且pageCount保持10", async ({ api }) => {
  await test.step('S1：通过真实 HTTP 重置本例状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });

  const now = await test.step('S2：按 D-01 平移样例并通过真实 sync 导入', async () => {
    const n = Date.now();
    const r = await api.post('/api/sync', samplePayload({ now: n }));
    expect(r.status, '[E2] 样例同步返回 200').toBe(200);
    expect(r.body, '[E2] 样例同步数量准确').toMatchObject({ received: 14, created: 10, updated: 4, rejected: 0, pageCount: 10 });
    return n;
  });
  const saved = await test.step('S3：解析并保存两条规则以取得正式 id', async () => {
    const parsed = await api.post('/api/rules/parse', { text: TEXT });
    expect(parsed.status, '[E3] 前置解析成功').toBe(200);
    const r = await api.post('/api/rules', { rules: parsed.body.rules });
    expect(r.status, '[E3] 保存返回 201').toBe(201);
    expect(r.body.ruleCount, '[E3] 保存两条规则').toBe(2);
    expect(r.body.rules.map(rule => rule.type), '[E3] 取得归档与保护规则').toEqual(['archive_candidate', 'never_archive']);
    return { archive: r.body.rules[0], keep: r.body.rules[1] };
  });
  await test.step('S4：固定 now 读取保护生效时的整理建议', async () => {
    const r = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
    expect(r.status, '[E4] 整理建议成功').toBe(200);
    expect(r.body.summary, '[E4] 双规则整理建议数量').toEqual({ archive: 2, merge: 1, keep: 1 });
    expect(r.body.suggestions.map(item => item.action), '[E4] 整理建议顺序准确').toEqual(['archive', 'archive', 'merge', 'keep']);
    const kept = r.body.suggestions.filter(item => item.action === 'keep');
    expect(kept, '[E5] 只有一个保护建议').toHaveLength(1);
    expect(kept[0], '[E5] docs 保护引用本例正式 id').toMatchObject({ url: DOCS, ruleId: saved.keep.id });
    expect(kept[0].reason, '[E5] 保护理由准确').toContain('被保护域名配置（docs.internal.com）');
  });
  await test.step('S5：删除保护规则并使用同一 now 再查建议', async () => {
    const deleted = await api.del(`/api/rules/${saved.keep.id}`);
    expect(deleted.status, '[E6] 删除返回 200').toBe(200);
    expect(deleted.body, '[E6] 删除正式保护 id 且剩一条规则').toEqual({ deleted: saved.keep.id, ruleCount: 1 });
    const r = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
    expect(r.status, '[E7] 删除后整理建议成功').toBe(200);
    expect(r.body.summary, '[E7] 保护撤销但归档与合并不变').toEqual({ archive: 2, merge: 1, keep: 0 });
    expect(r.body.suggestions.filter(item => item.url === DOCS && ['keep', 'archive'].includes(item.action)), '[E7] 仍打开的 docs 不再 keep，也不应被归档').toHaveLength(0);
    const issue = r.body.suggestions.find(item => item.url === 'https://github.com/org/repo/issues/100');
    expect(issue, '[E8] 原归档规则仍生效').toMatchObject({ action: 'archive', ruleId: saved.archive.id });
    expect(issue.reason, '[E8] 保留七天规则理由').toContain('7 天');
  });
  await test.step('S6：核对剩余规则与页面计数', async () => {
    const list = await api.get('/api/rules');
    const health = await api.get('/api/health');
    expect(list.status, '[E9] 列表成功').toBe(200);
    expect(list.body.total, '[E9] 只剩归档规则').toBe(1);
    expect(list.body.rules, '[E9] 剩余正式规则不变').toEqual([saved.archive]);
    expect(health.status, '[E9] 健康检查成功').toBe(200);
    expect(health.body, '[E9] 页面数十且一条规则启用').toMatchObject({ ruleCount: 1, enabledRuleCount: 1, pageCount: 10 });
  });
});
