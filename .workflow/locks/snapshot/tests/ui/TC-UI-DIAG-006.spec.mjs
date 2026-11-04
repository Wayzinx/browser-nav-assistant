// 用例：TC-UI-DIAG-006（F-DIAG-02#AC3）输入 not-a-url 保存时提示「地址格式错误」，storage 中的 apiBaseUrl 保持原值
import { test, expect } from '../fixtures/extension.mjs';
import { rerunDiag } from './diag-testkit.mjs';

test('TC-UI-DIAG-006 输入 not-a-url 保存时提示「地址格式错误」，storage 中的 apiBaseUrl 保持原值', async ({ ext }) => {
  let popup;

  await test.step('S1：打开 popup → 诊断页签，在输入框填入 not-a-url 并点击保存', async () => {
    popup = await ext.openPopup();
    await popup.getByTestId('tab-diag').click();
    await popup.getByTestId('diag-api-base-url-input').fill('not-a-url');
    await popup.getByTestId('diag-api-base-url-save').click();
    await ext.snap(popup, 'S1-保存非法地址');
  });

  await test.step('S2：读取校验错误、保存提示与 chrome.storage.local.apiBaseUrl', async () => {
    await expect(popup.getByTestId('diag-api-base-url-error'), '[E1] 校验错误可见').toBeVisible();
    await expect(popup.getByTestId('diag-api-base-url-error'), '[E1] 文本包含「地址格式错误」').toContainText('地址格式错误');
    const stored = await ext.getStorage('apiBaseUrl');
    expect(stored.apiBaseUrl, '[E2] storage.apiBaseUrl 保持原值').toBe(ext.baseURL);
    await expect(popup.getByTestId('diag-api-base-url-saved'), '[E3] 没有保存成功提示').toBeHidden();
    await ext.snap(popup, 'S2-校验失败');
  });

  await test.step('S3：再点击一次 diag-rerun-button，读取 diag-api-base-url-current', async () => {
    await rerunDiag(popup);
    await expect(popup.getByTestId('diag-api-base-url-current'), '[E4] 当前地址仍是原值').toHaveText(ext.baseURL);
    await ext.snap(popup, 'S3-重检后地址未变');
  });
});
