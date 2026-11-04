// 用例：TC-UI-DIAG-007（F-DIAG-02#AC3 边界）端口越界的地址（65536）按格式错误拒绝，storage 中的 apiBaseUrl 保持原值
import { test, expect } from '../fixtures/extension.mjs';

test('TC-UI-DIAG-007 端口越界的地址（65536）按格式错误拒绝，storage 中的 apiBaseUrl 保持原值', async ({ ext }) => {
  let popup;

  await test.step('S1：打开 popup → 诊断页签，填入 http://127.0.0.1:65536 并点击保存', async () => {
    popup = await ext.openPopup();
    await popup.getByTestId('tab-diag').click();
    await popup.getByTestId('diag-api-base-url-input').fill('http://127.0.0.1:65536');
    await popup.getByTestId('diag-api-base-url-save').click();
    await ext.snap(popup, 'S1-保存越界端口');
  });

  await test.step('S2：读取校验错误、保存提示、当前地址与 chrome.storage.local.apiBaseUrl', async () => {
    await expect(popup.getByTestId('diag-api-base-url-error'), '[E1] 校验错误可见').toBeVisible();
    await expect(popup.getByTestId('diag-api-base-url-error'), '[E1] 文本包含「地址格式错误」').toContainText('地址格式错误');
    const stored = await ext.getStorage('apiBaseUrl');
    expect(stored.apiBaseUrl, '[E2] storage.apiBaseUrl 保持原值').toBe(ext.baseURL);
    await expect(popup.getByTestId('diag-api-base-url-current'), '[E3] 当前地址仍显示原值').toHaveText(ext.baseURL);
    await expect(popup.getByTestId('diag-api-base-url-saved'), '[E3] 没有保存成功提示').toBeHidden();
    await ext.snap(popup, 'S2-越界端口被拒绝');
  });
});
