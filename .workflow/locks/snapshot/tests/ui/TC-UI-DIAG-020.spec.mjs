// 用例：TC-UI-DIAG-020（F-DIAG-07#AC2）缓存 1 条、health.ruleCount=2 时先警告「规则数不一致」，自动重新拉取后显示 2
import { test, expect } from '../fixtures/extension.mjs';
import { checkState, listRules, watchServiceWorkerApiRequests } from './diag-testkit.mjs';

const RULE_1 = { rawText: '把 7 天没访问过的 GitHub issue 建议归档', type: 'archive_candidate', domain: 'github.com', urlPattern: '/issues/', inactiveDays: 7, action: 'suggest_archive' };
const RULE_2 = { rawText: 'docs.internal.com 的页面永远不要归档', type: 'never_archive', domain: 'docs.internal.com', action: 'keep' };

test('TC-UI-DIAG-020 缓存 1 条、health.ruleCount=2 时先警告「规则数不一致」，自动重新拉取后显示 2', async ({ ext, api }) => {
  let popup;
  let savedIds = [];
  let requests = [];

  await test.step('S1：真实保存规则①（201）并打开 popup，用 LIST_RULES network 生成 1 条缓存', async () => {
    const first = await api.post('/api/rules', { rules: [RULE_1] });
    expect(first.status, '规则① HTTP 201').toBe(201);
    expect(first.body.ruleCount, '保存规则①后 ruleCount=1').toBe(1);
    popup = await ext.openPopup();
    await expect(popup.getByTestId('panel-home')).toBeVisible();
    const network = await listRules(popup, 'network', 'diag-020-network');
    expect(network.rules.length, 'network 返回 1 条').toBe(1);
    savedIds = [first.body.rules[0].id];
  });

  await test.step('S2：LIST_RULES cache 读回 1 条', async () => {
    const cache = await listRules(popup, 'cache', 'diag-020-cache-1');
    expect(cache.rules.length, '缓存 1 条').toBe(1);
  });

  await test.step('S3：真实 POST /api/rules 保存规则②使后端 2 条，而插件缓存仍 1 条', async () => {
    const second = await api.post('/api/rules', { rules: [RULE_2] });
    expect(second.status, '规则② HTTP 201').toBe(201);
    savedIds = [...savedIds, second.body.rules[0].id];
    const health = await api.get('/api/health');
    expect(health.body.ruleCount, '[E1] health.ruleCount=2').toBe(2);
    const cache = await listRules(popup, 'cache', 'diag-020-cache-2');
    expect(cache.fromCache, '[E1] fromCache=true').toBe(true);
    expect(cache.rules.length, '[E1] 缓存仍为 1 条（错配前置成立）').toBe(1);
  });

  await test.step('S4：注册只读监听后点击 tab-diag，读取 diag-check-rule-count', async () => {
    requests = watchServiceWorkerApiRequests(ext);
    await popup.getByTestId('tab-diag').click();
    await expect(popup.getByTestId('diag-check-rule-count'), '[E2] 先显示警告').toHaveAttribute('data-status', 'warn');
    const ruleCount = await checkState(popup, 'diag-check-rule-count');
    expect(ruleCount.detail, '[E2] 详情包含「规则数不一致」').toContain('规则数不一致');
    const rulesCalls = requests.filter((r) => r.method === 'GET' && r.path === '/api/rules');
    expect(rulesCalls.length, '[E3] 扩展 SW 自动发起真实 GET /api/rules').toBeGreaterThanOrEqual(1);
    await expect(popup.getByTestId('diag-check-rule-count').getByTestId('diag-item-value'), '[E3] 自动重拉后数量为 2').toHaveText('2');
    await ext.snap(popup, 'S4-规则数不一致后重拉');
  });

  await test.step('S5：LIST_RULES cache 读回刷新后的规则，并真实 GET /api/rules 核对', async () => {
    const cache = await listRules(popup, 'cache', 'diag-020-cache-3');
    expect(cache.fromCache, '[E4] fromCache=true').toBe(true);
    expect(cache.rules.length, '[E4] 缓存已刷新为 2 条').toBe(2);
    expect(cache.rules.map((rule) => rule.id).sort(), '[E4] 缓存 id 集合与两次保存响应一致').toEqual([...savedIds].sort());
    const rules = await api.get('/api/rules');
    expect(rules.body.total, '[E5] 真实 GET /api/rules total=2').toBe(2);
    const health = await api.get('/api/health');
    expect(health.body.ruleCount, '[E5] 诊断没有写库副作用：health.ruleCount 仍为 2').toBe(2);
  });
});
