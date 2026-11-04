// 用例：TC-UI-DIAG-003（F-DIAG-01#AC3）后端不可达时顶栏「后端未连接」+ 红点；改回可用地址后重开 popup 显示「后端已连接」
import { test, expect } from '../fixtures/extension.mjs';

test('TC-UI-DIAG-003 后端不可达时顶栏「后端未连接」且诊断页签出现红点，改回可用地址后重新打开 popup 显示「后端已连接」', async ({ ext }) => {
  let popup;
  await ext.useUnreachableBackend();

  await test.step('S1：以 tab 方式打开 popup，读取 connection-status 与 tab-diag-alert', async () => {
    popup = await ext.openPopup();
    await expect(popup.getByTestId('connection-status'), '[E1] 顶栏 data-state="offline"').toHaveAttribute('data-state', 'offline');
    await expect(popup.getByTestId('connection-status'), '[E1] 顶栏文本「后端未连接」').toHaveText('后端未连接');
    await expect(popup.getByTestId('tab-diag-alert'), '[E2] 诊断页签红点可见').toBeVisible();
    await ext.snap(popup, 'S1-后端未连接与红点');
  });

  await test.step('S2：进入诊断页签，把 API Base URL 改成测试后端地址并保存', async () => {
    await popup.getByTestId('tab-diag').click();
    await popup.getByTestId('diag-api-base-url-input').fill(ext.baseURL);
    await popup.getByTestId('diag-api-base-url-save').click();
    await expect(popup.getByTestId('diag-api-base-url-saved'), '[E3] 保存成功提示可见').toBeVisible();
    await expect(popup.getByTestId('diag-api-base-url-error'), '[E3] 校验错误不可见').toBeHidden();
    await ext.snap(popup, 'S2-保存可用地址');
  });

  await test.step('S3：读取 chrome.storage.local.apiBaseUrl', async () => {
    const stored = await ext.getStorage('apiBaseUrl');
    expect(stored.apiBaseUrl, '[E4] apiBaseUrl 已保存为可用地址').toBe(ext.baseURL);
  });

  await test.step('S4：关闭并重新以 tab 打开 popup，读取 connection-status 与 tab-diag-alert', async () => {
    const reopened = await ext.reopenPopup();
    await expect(reopened.getByTestId('connection-status'), '[E5] 顶栏 data-state="online"').toHaveAttribute('data-state', 'online');
    await expect(reopened.getByTestId('connection-status'), '[E5] 顶栏文本「后端已连接」').toHaveText('后端已连接');
    await ext.snap(reopened, 'S4-重新打开后已连接');
  });
});
