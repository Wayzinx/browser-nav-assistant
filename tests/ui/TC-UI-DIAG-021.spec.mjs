// 用例：TC-UI-DIAG-021（F-DIAG-07 边界）规则数离线时警告，恢复同一后端并重检后 2 条一致且通过
import { test, expect } from '../fixtures/extension.mjs';
import { DIAG_CHECK_IDS, checkState, listRules, renderedCheckCount } from './diag-testkit.mjs';

const RULE_1 = { rawText: '把 7 天没访问过的 GitHub issue 建议归档', type: 'archive_candidate', domain: 'github.com', urlPattern: '/issues/', inactiveDays: 7, action: 'suggest_archive' };
const RULE_2 = { rawText: 'docs.internal.com 的页面永远不要归档', type: 'never_archive', domain: 'docs.internal.com', action: 'keep' };

test('TC-UI-DIAG-021 规则数离线时警告，恢复同一后端并重检后2条一致且通过', async ({ ext, api }) => {
  let popup;

  await test.step('S1：真实保存两条规则并在 popup 里生成、读回 2 条缓存', async () => {
    const saved = await api.post('/api/rules', { rules: [RULE_1, RULE_2] });
    expect(saved.status, '两条规则 HTTP 201').toBe(201);
    popup = await ext.openPopup();
    await expect(popup.getByTestId('panel-home')).toBeVisible();
    const network = await listRules(popup, 'network', 'diag-021-network');
    expect(network.rules.length, 'network 返回 2 条').toBe(2);
    const cache = await listRules(popup, 'cache', 'diag-021-cache-1');
    expect(cache.rules.length, '缓存 2 条').toBe(2);
    const health = await api.get('/api/health');
    expect(health.body.ruleCount, 'health.ruleCount=2').toBe(2);
  });

  await test.step('S2：把 apiBaseUrl 指向无服务端口后重新检测，读取规则数警告与排查建议', async () => {
    await ext.useUnreachableBackend();
    await popup.getByTestId('tab-diag').click();
    await popup.getByTestId('diag-rerun-button').click();
    await expect(popup.getByTestId('diag-check-rule-count'), '[E1] 规则数检查为警告').toHaveAttribute('data-status', 'warn');
    const ruleCount = await checkState(popup, 'diag-check-rule-count');
    expect(ruleCount.hintSteps.join(' '), '[E1] 排查建议说明「规则页签」或「重新拉取」').toMatch(/规则页签|重新拉取/);
    const backend = await checkState(popup, 'diag-check-backend');
    expect(backend.status, '[E2] 后端不可达时「后端服务连接」失败').toBe('fail');
    const storage = await checkState(popup, 'diag-check-storage');
    expect(storage.status, '[E2] storage 检查仍通过').toBe('ok');
    expect(await renderedCheckCount(popup), '[E2] 11 项检查均渲染').toBe(DIAG_CHECK_IDS.length);
    await ext.snap(popup, 'S2-离线规则数警告');
  });

  await test.step('S3：恢复同一后端地址，重开 popup 重新检测并核对两端一致', async () => {
    await ext.setApiBase(ext.baseURL);
    popup = await ext.reopenPopup();
    await popup.getByTestId('tab-diag').click();
    await popup.getByTestId('diag-rerun-button').click();
    await expect(popup.getByTestId('diag-check-rule-count'), '[E3] 恢复后规则数检查通过').toHaveAttribute('data-status', 'ok');
    const ruleCount = await checkState(popup, 'diag-check-rule-count');
    expect(ruleCount.value, '[E3] diag-item-value="2"').toBe('2');
    const health = await api.get('/api/health');
    expect(health.body.ruleCount, '[E3] health.ruleCount=2').toBe(2);
    const cache = await listRules(popup, 'cache', 'diag-021-cache-2');
    expect(cache.rules.length, '[E3] 缓存 2 条，两端一致').toBe(2);
    await ext.snap(popup, 'S3-恢复后规则数通过');
  });
});
