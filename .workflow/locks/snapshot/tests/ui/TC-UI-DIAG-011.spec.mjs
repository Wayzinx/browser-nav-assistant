// 用例：TC-UI-DIAG-011（F-DIAG-04#AC1）manifest 声明了 history 权限时「history 权限」显示通过
import { test, expect } from '../fixtures/extension.mjs';
import { DIAG_CHECK_IDS, enterDiagTab, checkState, renderedCheckCount } from './diag-testkit.mjs';

test('TC-UI-DIAG-011 manifest 声明了 history 权限时「history 权限」显示通过', async ({ ext }) => {
  let popup;

  await test.step('S1：通过 service worker 写入一条当前时间的历史', async () => {
    await ext.seedHistory(['https://react.dev/learn']);
  });

  await test.step('S2：打开 popup → 诊断页签，等待 diag-loading 消失', async () => {
    popup = await ext.openPopup();
    await enterDiagTab(popup);
  });

  await test.step('S3：读取 diag-check-history 的状态、名称与状态文本', async () => {
    const history = await checkState(popup, 'diag-check-history');
    expect(history.status, '[E1] diag-check-history data-status="ok"').toBe('ok');
    expect(history.name, '[E2] 检查项名称为「history 权限」').toBe('history 权限');
    expect(history.statusText, '[E2] 状态文本为「通过」').toBe('通过');
    expect(await renderedCheckCount(popup), '[E3] 登记的 11 个检查项全部渲染').toBe(DIAG_CHECK_IDS.length);
    for (const id of DIAG_CHECK_IDS) {
      await expect(popup.getByTestId(id), `[E3] ${id} 可见（不是隐藏的占位节点）`).toBeVisible();
    }
    await expect(popup.getByTestId('diag-check-history'), '[E1] history 检查项可见').toBeVisible();
    await ext.snap(popup, 'S3-history 权限通过');
  });
});
