// 模板：E2E 接口链路用例（文件名 tests/e2e/<CaseID>.spec.mjs）
// 用例：TC-E2E-FLOW-001（示例）样例导入 → 排序 → 推荐 → 规则解析 → 保存 → 整理建议 → 删除规则 → 整理建议恢复 → 健康检查
// 编排要点（详见 references/api-e2e-patterns.md）：
//   1. 每个 test.step 对应用例的一个 S 步骤；step 的返回值就是传给下一步的参数（parsed → saved → ruleId）
//   2. 后端生成的值（规则 id 等）一律从上一步的响应中取，不要硬编码
//   3. 每一步都断言本步的结果，后面的步骤再断言「状态已经传递过来」（例如删除后 cleanup 中的 keep 消失）
//   4. 准备数据用 api.loadSample（setup，不参与变异）；被测调用用 api.get / api.post / api.del
import { test, expect } from '../fixtures/api.mjs';

const RULE_TEXT = '把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档';
const PR = 'https://github.com/org/repo/pull/456';
const ISSUE_123 = 'https://github.com/org/repo/issues/123';
const ISSUE_100 = 'https://github.com/org/repo/issues/100';
const INTERNAL = 'https://docs.internal.com/ai-agent-design';

test('TC-E2E-FLOW-001 规则从解析到生效再到删除的完整链路', async ({ api }) => {
  const { payload } = await api.loadSample();

  await test.step('S1：GET /api/pages/ranked 查看排序', async () => {
    const r = await api.get('/api/pages/ranked');
    expect(r.status, '[E1] 排序接口返回 200').toBe(200);
    expect(r.body.pages, '[E1] 共 10 个页面').toHaveLength(10);
    const scores = r.body.pages.map((p) => p.score);
    expect(scores, '[E1] 按 score 降序排列').toEqual([...scores].sort((a, b) => b - a));
    for (const p of r.body.pages) expect(p.reason, `[E1] ${p.url} 带有排序理由`).toMatch(/\S/);
  });

  await test.step('S2：以 PR 页为当前页请求下一步推荐', async () => {
    const r = await api.post('/api/recommendations/next', {
      currentPage: payload.activeTab, openTabs: payload.openTabs, recentHistory: payload.history,
    });
    expect(r.status, '[E2] 推荐接口返回 200').toBe(200);
    const recs = r.body.recommendations;
    expect(recs[0], '[E2] 首条推荐为同仓库的 Actions 页面').toMatchObject({ type: 'next_visit', url: 'https://github.com/org/repo/actions' });
    expect(recs[0].reason, '[E2] 首条推荐带有理由').toMatch(/\S/);
    const urls = recs.map((x) => x.url);
    expect(urls, '[E2] 不推荐当前页和已打开的页面').not.toContain(PR);
    expect(urls, '[E2] 不推荐已打开的 issues/123').not.toContain(ISSUE_123);
    expect(urls, '[E2] 不推荐与已打开页面重复的 ?tab=comments').not.toContain(`${ISSUE_123}?tab=comments`);
  });

  const parsed = await test.step('S3：POST /api/rules/parse 解析自然语言规则', async () => {
    const r = await api.post('/api/rules/parse', { text: RULE_TEXT });
    expect(r.status, '[E3] 解析接口返回 200').toBe(200);
    expect(r.body.rules, '[E3] 解析出 2 条规则').toHaveLength(2);
    expect(r.body.rules[0], '[E3] 第 1 条为 GitHub issue 7 天归档').toMatchObject({ type: 'archive_candidate', domain: 'github.com', urlPattern: '/issues/', inactiveDays: 7, action: 'suggest_archive' });
    expect(r.body.rules[1], '[E3] 第 2 条为 docs.internal.com 永不归档').toMatchObject({ type: 'never_archive', domain: 'docs.internal.com', action: 'keep' });
    return r.body.rules; // ← 传给 S4
  });

  const saved = await test.step('S4：POST /api/rules 保存解析结果，再查列表', async () => {
    const r = await api.post('/api/rules', { rules: parsed });
    expect(r.status, '[E4] 保存接口返回 201').toBe(201);
    expect(r.body.rules, '[E4] 保存了 2 条规则').toHaveLength(2);
    const list = await api.get('/api/rules');
    expect(list.body.rules.map((x) => x.id).sort(), '[E4] 列表中的规则 id 与保存响应一致').toEqual(r.body.rules.map((x) => x.id).sort());
    return r.body.rules; // ← 传给 S5、S6
  });

  await test.step('S5：整理建议体现规则', async () => {
    const r = await api.get('/api/pages/cleanup-suggestions');
    expect(r.status, '[E5] 整理建议接口返回 200').toBe(200);
    const keep = r.body.suggestions.filter((s) => s.action === 'keep').map((s) => s.url);
    expect(keep, '[E5] docs.internal.com 页面被保护').toContain(INTERNAL);
    const archive100 = r.body.suggestions.find((s) => s.action === 'archive' && s.url === ISSUE_100);
    expect(archive100?.reason, '[E5] issues/100 的归档理由提到 7 天规则').toMatch(/7\s*天/);
  });

  await test.step('S6：删除 never_archive 规则后，整理建议恢复', async () => {
    const ruleId = saved.find((x) => x.type === 'never_archive').id; // ← 来自 S4 的响应，不硬编码
    const d = await api.del(`/api/rules/${ruleId}`);
    expect(d.status, '[E6] 删除接口返回 200').toBe(200);
    const r = await api.get('/api/pages/cleanup-suggestions');
    expect(r.body.suggestions.filter((s) => s.action === 'keep'), '[E6] 删除保护规则后不再有 keep 建议').toHaveLength(0);
  });

  await test.step('S7：健康检查反映最新状态', async () => {
    const r = await api.get('/api/health');
    expect(r.body, '[E7] 剩余 1 条规则、10 个页面').toMatchObject({ status: 'ok', ruleCount: 1, pageCount: 10 });
  });
});
