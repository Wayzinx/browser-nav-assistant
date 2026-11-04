// 用例：TC-UI-DIAG-004（F-DIAG-02#AC1）storage 没有 apiBaseUrl 时诊断页显示默认地址 http://127.0.0.1:3000
import { test, expect } from '../fixtures/extension.mjs';
import { DEFAULT_API_BASE, enterDiagTab, checkState } from './diag-testkit.mjs';

test('TC-UI-DIAG-004 存储中没有 apiBaseUrl 时诊断页显示默认地址 http://127.0.0.1:3000', async ({ ext }) => {
  let popup;

  await test.step('S1：在 service worker 中删除 apiBaseUrl，打开 popup 并进入诊断页签', async () => {
    await ext.swEval(() => chrome.storage.local.remove('apiBaseUrl'));
    popup = await ext.openPopup();
    await enterDiagTab(popup);
    await ext.snap(popup, 'S1-默认地址诊断');
  });

  await test.step('S2：读取当前地址、输入框 value 与 API Base URL 检查项', async () => {
    await expect(popup.getByTestId('diag-api-base-url-current'), '[E1] 显示默认地址').toHaveText(DEFAULT_API_BASE);
    await expect(popup.getByTestId('diag-api-base-url-input'), '[E2] 输入框 value 为默认地址').toHaveValue(DEFAULT_API_BASE);
    const check = await checkState(popup, 'diag-check-api-base-url');
    expect(check.status, '[E3] diag-check-api-base-url data-status="ok"').toBe('ok');
    expect(check.value, '[E3] 检查项数值包含默认地址').toContain(DEFAULT_API_BASE);
    await ext.snap(popup, 'S2-默认地址检查项');
  });
});
