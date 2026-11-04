// 用例：TC-UI-DIAG-014（F-DIAG-05#AC2）诊断完成后 chrome.storage.local 中不残留 __diag__ 探测键
import { test, expect } from '../fixtures/extension.mjs';
import { DIAG_CHECK_IDS, enterDiagTab, rerunDiag, renderedCheckCount } from './diag-testkit.mjs';

test('TC-UI-DIAG-014 诊断完成后 chrome.storage.local 中不残留 __diag__ 探测键', async ({ ext }) => {
  let popup;

  await test.step('S1：打开 popup → 诊断页签，等待 diag-loading 消失、检测完成', async () => {
    popup = await ext.openPopup();
    await enterDiagTab(popup);
    await expect(popup.getByTestId('diag-check-storage'), '本轮检测完成：storage 检查通过').toHaveAttribute('data-status', 'ok');
  });

  await test.step('S2：在 service worker 中读取 chrome.storage.local.get(null)，检查键名集合', async () => {
    const keys = Object.keys(await ext.swEval(() => chrome.storage.local.get(null)));
    expect(keys, '[E1] 键名集合不包含 __diag__').not.toContain('__diag__');
    await ext.snap(popup, 'S2-首轮检测后键名');
  });

  await test.step('S3：再点击 diag-rerun-button，完成后重复读取键名集合', async () => {
    await rerunDiag(popup);
    const keys = Object.keys(await ext.swEval(() => chrome.storage.local.get(null)));
    expect(keys, '[E2] 每次检测都清理 __diag__').not.toContain('__diag__');
    await expect(popup.getByTestId('diag-check-storage'), '[E3] 第二次检测也完成').toHaveAttribute('data-status', 'ok');
    expect(await renderedCheckCount(popup), '[E3] 登记的 11 个检查项全部渲染').toBe(DIAG_CHECK_IDS.length);
    await ext.snap(popup, 'S3-重检后键名');
  });
});
