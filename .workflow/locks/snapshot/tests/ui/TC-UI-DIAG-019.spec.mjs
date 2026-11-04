// 用例：TC-UI-DIAG-019（F-DIAG-07#AC1）后端 2 条规则且插件缓存也是 2 条时「当前规则数量」显示 2 并通过
import { test, expect } from '../fixtures/extension.mjs';
import { enterDiagTab, checkState, listRules } from './diag-testkit.mjs';

const RULE_1 = { rawText: '把 7 天没访问过的 GitHub issue 建议归档', type: 'archive_candidate', domain: 'github.com', urlPattern: '/issues/', inactiveDays: 7, action: 'suggest_archive' };
const RULE_2 = { rawText: 'docs.internal.com 的页面永远不要归档', type: 'never_archive', domain: 'docs.internal.com', action: 'keep' };

test('TC-UI-DIAG-019 后端 2 条规则且插件缓存也是 2 条时「当前规则数量」显示 2 并通过', async ({ ext, api }) => {
  let popup;
  let savedIds = [];

  await test.step('S1：真实 POST /api/rules 提交两条规则', async () => {
    const res = await api.post('/api/rules', { rules: [RULE_1, RULE_2] });
    expect(res.status, '[E1] HTTP 201').toBe(201);
    expect(res.body.ruleCount, '[E1] ruleCount=2').toBe(2);
    savedIds = res.body.rules.map((rule) => rule.id);
    expect(savedIds.filter((id) => typeof id === 'string' && id.length > 0).length, '[E1] 两条返回规则 id 非空').toBe(2);
    expect(new Set(savedIds).size, '[E1] 两条规则 id 不同').toBe(2);
  });

  await test.step('S2：打开 popup，用 LIST_RULES network 自然写入缓存并读回', async () => {
    popup = await ext.openPopup();
    await expect(popup.getByTestId('panel-home')).toBeVisible();
    const network = await listRules(popup, 'network', 'diag-019-network');
    expect(network.rules.length, 'LIST_RULES network 返回 2 条').toBe(2);
    const cache = await listRules(popup, 'cache', 'diag-019-cache');
    expect(cache.fromCache, '[E2] 缓存读回 fromCache=true').toBe(true);
    expect(cache.rules.length, '[E2] 缓存 2 条').toBe(2);
    expect(cache.rules.map((rule) => rule.id).sort(), '[E2] 缓存 id 集合等于保存响应').toEqual([...savedIds].sort());
    const health = await api.get('/api/health');
    expect(health.body.ruleCount, '[E2] health.ruleCount=2').toBe(2);
  });

  await test.step('S3：点击 tab-diag，读取 diag-check-rule-count 的状态、数值与详情', async () => {
    await enterDiagTab(popup);
    const ruleCount = await checkState(popup, 'diag-check-rule-count');
    expect(ruleCount.status, '[E3] data-status="ok"').toBe('ok');
    expect(ruleCount.statusText, '[E3] 状态文本为「通过」').toBe('通过');
    expect(ruleCount.value, '[E3] diag-item-value="2"').toBe('2');
    expect(ruleCount.detail, '[E4] 详情不包含「规则数不一致」').not.toContain('规则数不一致');
    const rules = await api.get('/api/rules');
    expect(rules.body.total, '[E4] 真实 GET /api/rules total=2').toBe(2);
    await ext.snap(popup, 'S3-规则数一致');
  });
});
