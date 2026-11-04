// 用例：TC-UI-DIAG-023（F-DIAG-08#AC2）enablePrivacyFilter=false 时「隐私过滤」显示警告并提示检查后端配置
import { test, expect } from '../fixtures/extension.mjs';
import { enterDiagTab, checkState } from './diag-testkit.mjs';

test('TC-UI-DIAG-023 enablePrivacyFilter=false 时「隐私过滤」显示警告并提示检查后端配置', async ({ ext, api }) => {
  let popup;

  await test.step('S1：真实 PUT /api/config 关闭隐私过滤', async () => {
    const res = await api.put('/api/config', { enablePrivacyFilter: false });
    expect(res.status, '[E1] 返回 200').toBe(200);
    expect(res.body.enablePrivacyFilter, '[E1] body.enablePrivacyFilter=false').toBe(false);
  });

  await test.step('S2：打开 popup → 诊断页签，等待 diag-loading 消失', async () => {
    popup = await ext.openPopup();
    await enterDiagTab(popup);
    await ext.snap(popup, 'S2-关闭隐私过滤后的诊断');
  });

  await test.step('S3：读取「隐私过滤」的状态、排查步骤，并读取 activeTab 的状态', async () => {
    await expect(popup.getByTestId('diag-check-privacy'), '[E2] 隐私过滤为警告').toHaveAttribute('data-status', 'warn');
    const privacy = await checkState(popup, 'diag-check-privacy');
    expect(privacy.hintSteps.join(' '), '[E3] 排查步骤包含 enablePrivacyFilter').toContain('enablePrivacyFilter');
    const activeTab = await checkState(popup, 'diag-check-active-tab');
    expect(activeTab.status, '[E4] 只有隐私项随配置变化：activeTab 仍通过').toBe('ok');
    await ext.snap(popup, 'S3-隐私过滤警告');
  });
});
