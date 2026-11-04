import { test, expect } from '../fixtures/extension.mjs';

test('TC-UI-RULE-016 离线无缓存显示列表错误而非空状态', async ({ ext }) => {
  const popup = await test.step('S1：无缓存时设置不可达后端并打开', async () => {
    expect((await ext.getStorage('cache')).cache?.rules, '新 profile 没有规则缓存').toBeUndefined();
    await ext.useUnreachableBackend();
    const page = await ext.openPopup();
    await expect(page.getByTestId('connection-status')).toHaveAttribute('data-state', 'offline', { timeout: 12000 });
    await ext.snap(page, '无缓存离线首页');
    return page;
  });
  await test.step('S2：打开规则页签等待加载失败', async () => {
    await popup.getByTestId('tab-rules').click();
    await expect(popup.getByTestId('rules-list-error'), '[E1] 错误提示可见').toBeVisible({ timeout: 12000 });
    await expect(popup.getByTestId('rules-list-error'), '[E1] 错误说明非空').toHaveText(/\S/);
    await expect(popup.getByTestId('rules-list-loading')).toBeHidden();
    await expect(popup.getByTestId('rules-list-empty'), '[E2] 不能误报空列表').toBeHidden();
    await expect(popup.getByTestId('rules-item'), '[E2] 没有缓存规则项').toHaveCount(0);
    await ext.snap(popup, '离线列表错误');
  });
});
