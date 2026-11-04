import { test, expect } from '../fixtures/extension.mjs';

test('TC-UI-RULE-004 离线时首页和规则页的解析均禁用', async ({ ext }) => {
  const popup = await test.step('S1：设置不可达后端并打开 popup', async () => {
    await ext.useUnreachableBackend();
    const page = await ext.openPopup();
    await expect(page.getByTestId('connection-status'), '[E1] 连接状态为离线').toHaveAttribute('data-state', 'offline', { timeout: 12000 });
    await expect(page.getByTestId('connection-status'), '[E1] 显示未连接').toHaveText('后端未连接');
    await ext.snap(page, '离线首页');
    return page;
  });
  await test.step('S2：核对首页解析按钮', async () => {
    await expect(popup.getByTestId('home-rule-parse-button'), '[E2] 首页解析不可用').toBeDisabled();
  });
  await test.step('S3：输入规则后解析仍不可用', async () => {
    await popup.getByTestId('tab-rules').click();
    await popup.getByTestId('rule-input').fill('github.com 永远不要归档');
    await expect(popup.getByTestId('rule-parse-button'), '[E3] 输入文本后仍禁用解析').toBeDisabled();
    await expect(popup.getByTestId('rule-offline-hint'), '[E4] 离线提示可见').toBeVisible();
    await expect(popup.getByTestId('rule-offline-hint'), '[E4] 说明暂时无法解析').toContainText('后端未连接，暂时无法解析');
    await expect(popup.getByTestId('rule-card'), '[E4] 不生成卡片').toHaveCount(0);
    await ext.snap(popup, '离线规则页');
  });
});
