import { test, expect } from '../fixtures/extension.mjs';

// TDD 草稿：后端不可达由「没有服务监听的端口」构造（ext.useUnreachableBackend），
// 不 route 后端；新 context 无 cache.ranked，GET_RANKED 网络失败无缓存可回退。
test('TC-UI-RANK-006 后端不可达且无缓存：首页显示 home-ranked-error 并带诊断入口，排序页签显示 ranked-error', async ({ ext }) => {
  await test.step('S1：切到不可达后端，并确认 storage 中没有排序缓存', async () => {
    await ext.useUnreachableBackend();
    const stored = await ext.getStorage('cache');
    expect(stored.cache?.ranked ?? null, '[E1] 新上下文不存在 cache.ranked').toBeNull();
  });

  const popup = await test.step('S2：打开 popup，等待首页排序加载结束', async () => {
    const page = await ext.openPopup();
    await expect(page.getByTestId('home-ranked-loading'), '首页排序加载结束').toBeHidden();
    return page;
  });

  await test.step('S3：读取首页错误状态、诊断入口与排序项数量', async () => {
    const errorBox = popup.getByTestId('home-ranked-error');
    await expect(errorBox, '[E2] 首页排序错误状态可见').toBeVisible();
    await expect(errorBox.getByTestId('error-diag-link'), '[E2] 首页错误状态内诊断入口可见').toBeVisible();
    await expect(popup.getByTestId('home-ranked-empty'), '[E2] 首页空状态不可见').toBeHidden();
    const homeItems = popup.getByTestId('home-ranked-list').getByTestId('home-ranked-item');
    await expect(homeItems, '[E3] 首页没有排序项').toHaveCount(0);
    await ext.snap(popup, '首页排序错误状态');
  });

  await test.step('S4：切到排序页签，读取错误状态、诊断入口与排序项数量', async () => {
    await popup.getByTestId('tab-ranked').click();
    await expect(popup.getByTestId('ranked-loading'), '排序页签加载结束').toBeHidden();
    const errorBox = popup.getByTestId('ranked-error');
    await expect(errorBox, '[E4] 排序页签错误状态可见').toBeVisible();
    await expect(errorBox.getByTestId('error-diag-link'), '[E4] 排序错误状态内诊断入口可见').toBeVisible();
    await expect(popup.getByTestId('ranked-list').getByTestId('ranked-item'), '[E4] 排序页签没有排序项').toHaveCount(0);
    await ext.snap(popup, '排序页签错误状态');
  });
});
