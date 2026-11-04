import { test, expect } from '../fixtures/extension.mjs';

// TDD 草稿：reset 后后端无数据，不导入、不同步；空状态引导文案来自 ui-contract 登记。
test('TC-UI-RANK-005 后端数据为空时首页与排序页签都显示空状态，文案包含「同步浏览器上下文」且没有排序项', async ({ ext, api }) => {
  await test.step('S1：用 /api/health 确认 pageCount=0', async () => {
    const health = await api.get('/api/health');
    expect(health.status, '[E1] health 返回 200').toBe(200);
    expect(health.body.pageCount, '[E1] 重置后后端页面数为 0').toBe(0);
  });

  const popup = await test.step('S2：打开 popup，等待首页排序加载结束', async () => {
    const page = await ext.openPopup();
    await expect(page.getByTestId('home-ranked-loading'), '首页排序加载结束').toBeHidden();
    return page;
  });

  await test.step('S3：读取首页空状态与排序项数量', async () => {
    const empty = popup.getByTestId('home-ranked-empty');
    await expect(empty, '[E2] 首页排序空状态可见').toBeVisible();
    await expect(empty, '[E2] 空状态引导同步浏览器上下文').toContainText('同步浏览器上下文');
    await expect(popup.getByTestId('home-ranked-error'), '[E2] 首页排序错误状态不可见').toBeHidden();
    const homeItems = popup.getByTestId('home-ranked-list').getByTestId('home-ranked-item');
    await expect(homeItems, '[E3] 首页没有排序项').toHaveCount(0);
    await ext.snap(popup, '首页排序空状态');
  });

  await test.step('S4：切到排序页签，读取空状态与排序项数量', async () => {
    await popup.getByTestId('tab-ranked').click();
    await expect(popup.getByTestId('ranked-loading'), '排序页签加载结束').toBeHidden();
    const empty = popup.getByTestId('ranked-empty');
    await expect(empty, '[E4] 排序页签空状态可见').toBeVisible();
    await expect(empty, '[E4] 空状态引导同步浏览器上下文').toContainText('同步浏览器上下文');
    await expect(popup.getByTestId('ranked-error'), '[E4] 排序页签错误状态不可见').toBeHidden();
    await expect(popup.getByTestId('ranked-list').getByTestId('ranked-item'), '[E4] 排序页签没有排序项').toHaveCount(0);
    await ext.snap(popup, '排序页签空状态');
  });
});
