import { test, expect } from '../fixtures/extension.mjs';

test('TC-UI-RULE-007 中途断网解析显示错误且结束加载', async ({ ext }) => {
  const popup = await test.step('S1：在线打开规则页签', async () => {
    const page = await ext.openPopup();
    await page.getByTestId('tab-rules').click();
    await expect(page.getByTestId('connection-status')).toHaveAttribute('data-state', 'online');
    await expect(page.getByTestId('rule-parse-button'), '[E1] 在线解析可用').toBeEnabled();
    await expect(page.getByTestId('rule-offline-hint'), '[E1] 无离线提示').toBeHidden();
    await ext.snap(page, '在线规则页');
    return page;
  });
  await test.step('S2：不刷新 popup 切换不可达后端', async () => {
    await ext.useUnreachableBackend();
  });
  await test.step('S3：解析并等待真实连接失败', async () => {
    await popup.getByTestId('rule-input').fill('github.com 永远不要归档');
    await popup.getByTestId('rule-parse-button').click();
    await expect(popup.getByTestId('rule-parse-error'), '[E2] 解析失败提示可见').toBeVisible({ timeout: 12000 });
    await expect(popup.getByTestId('rule-parse-error'), '[E2] 错误说明至少两个字符').toHaveText(/\S[\s\S]*\S/);
    await expect(popup.getByTestId('rule-parse-loading'), '[E3] 不残留加载态').toBeHidden();
    await expect(popup.getByTestId('rule-card'), '[E3] 不生成卡片').toHaveCount(0);
    await ext.snap(popup, '解析失败');
  });
});
