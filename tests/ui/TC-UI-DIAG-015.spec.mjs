// 用例：TC-UI-DIAG-015（F-DIAG-06#AC1）从未同步时「最近一次同步」警告「从未同步」，并提供「立即同步」入口
import { test, expect } from '../fixtures/extension.mjs';
import { DIAG_CHECK_IDS, enterDiagTab, checkState, renderedCheckCount } from './diag-testkit.mjs';

test('TC-UI-DIAG-015 从未同步时「最近一次同步」警告「从未同步」，并提供「立即同步」入口', async ({ ext }) => {
  let popup;

  await test.step('S1：删除 syncState 后打开 popup → 诊断页签，等待 diag-loading 消失', async () => {
    await ext.swEval(() => chrome.storage.local.remove('syncState'));
    popup = await ext.openPopup();
    await enterDiagTab(popup);
    await ext.snap(popup, 'S1-从未同步诊断');
  });

  await test.step('S2：读取 diag-check-last-sync 的状态与详情，并检查 diag-sync-now-button', async () => {
    const lastSync = await checkState(popup, 'diag-check-last-sync');
    expect(lastSync.status, '[E1] diag-check-last-sync data-status="warn"').toBe('warn');
    expect(lastSync.detail, '[E2] 详情包含「从未同步」').toContain('从未同步');
    await expect(popup.getByTestId('diag-sync-now-button'), '[E3] 「立即同步」入口可见').toBeVisible();
    expect(await renderedCheckCount(popup), '[E4] 未把其他检查项带崩：11 项全部渲染').toBe(DIAG_CHECK_IDS.length);
    await ext.snap(popup, 'S2-从未同步警告');
  });
});
