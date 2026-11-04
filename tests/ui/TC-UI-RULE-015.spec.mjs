import { test, expect } from '../fixtures/extension.mjs';

test('TC-UI-RULE-015 零规则显示空状态而非错误', async ({ ext, api }) => {
  await test.step('S1：核对后端初始没有规则', async () => {
    const response = await api.get('/api/rules');
    expect(response.body.total, '[E1] 初始规则数为零').toBe(0);
  });
  await test.step('S2：打开规则页签核对空状态与计数', async () => {
    const popup = await ext.openPopup();
    await popup.getByTestId('tab-rules').click();
    await expect(popup.getByTestId('rules-list-loading')).toBeHidden();
    await expect(popup.getByTestId('rules-list-empty'), '[E2] 显示空列表').toBeVisible();
    await expect(popup.getByTestId('rules-list-error'), '[E2] 不显示错误').toBeHidden();
    await expect(popup.getByTestId('rules-count'), '[E3] 列表计数为零').toHaveText('0');
    await expect(popup.getByTestId('rules-item'), '[E3] 没有列表项').toHaveCount(0);
    await ext.snap(popup, '零规则空状态');
  });
});
