// 用例：TC-UI-DIAG-009（F-DIAG-03#AC1）当前窗口打开 https://react.dev/learn 时「tabs 权限」显示通过
import { test, expect } from '../fixtures/extension.mjs';
import { DIAG_CHECK_IDS, enterDiagTab, checkState, renderedCheckCount } from './diag-testkit.mjs';

const TARGET_URL = 'https://react.dev/learn';

test('TC-UI-DIAG-009 当前窗口打开 https://react.dev/learn 时「tabs 权限」显示通过', async ({ ext }) => {
  let popup;

  await test.step('S1：以 tab 方式打开 https://react.dev/learn（夹具离线化），并保持它是活动标签页', async () => {
    await ext.mockSites({ [TARGET_URL]: 'React – Learn' });
    const [page] = await ext.openTabs([TARGET_URL]);
    await page.bringToFront();
  });

  await test.step('S2：以 tab 方式打开 popup → 诊断页签，等待 diag-loading 消失', async () => {
    popup = await ext.openPopup();
    await enterDiagTab(popup);
  });

  await test.step('S3：读取 diag-check-tabs 的状态、名称与状态文本', async () => {
    const tabs = await checkState(popup, 'diag-check-tabs');
    expect(tabs.status, '[E1] diag-check-tabs data-status="ok"').toBe('ok');
    expect(tabs.name, '[E2] 检查项名称为「tabs 权限」').toBe('tabs 权限');
    expect(tabs.statusText, '[E2] 状态文本为「通过」').toBe('通过');
    expect(await renderedCheckCount(popup), '[E3] 登记的 11 个检查项全部渲染').toBe(DIAG_CHECK_IDS.length);
    await ext.snap(popup, 'S3-tabs 权限通过');
  });
});
