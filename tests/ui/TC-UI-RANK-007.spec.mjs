import { test, expect } from '../fixtures/extension.mjs';

// TDD 草稿：先在线让无筛选默认列表（limit=50）写入 cache.ranked，再切到没有服务监听的端口模拟离线。
// 缓存口径（C-FE-RANK-01）：带筛选请求离线时返回 NO_CACHE「筛选需要在线」，不读写缓存。
test('TC-UI-RANK-007 排序页签离线时点「打开中」筛选：显示「筛选需要在线」提示且控件保留，取消筛选回到 10 条缓存列表', async ({ ext, api }) => {
  let popup;

  await test.step('S1：调用 api.loadSample() 导入样例', async () => {
    const { res } = await api.loadSample();
    expect(res.status, '样例导入成功').toBe(200);
  });

  await test.step('S2：在线打开排序页签，默认列表写入 cache.ranked', async () => {
    popup = await ext.openPopup();
    await popup.getByTestId('tab-ranked').click();
    await expect(popup.getByTestId('ranked-total'), '在线默认列表共 10 条').toHaveText('10');
    await expect.poll(
      async () => (await ext.getStorage('cache')).cache?.ranked?.cachedAt ?? 0,
      { message: '等待无筛选默认列表写入 cache.ranked' },
    ).toBeGreaterThan(0);
    const storage = await ext.getStorage('cache');
    expect(storage.cache.ranked.data.pages, '[E1] cache.ranked.data.pages 长度为 10').toHaveLength(10);
    await ext.snap(popup, '在线默认列表已缓存');
  });

  await test.step('S3：切到不可达后端，重新打开 popup 与排序页签，等待缓存列表渲染', async () => {
    await ext.useUnreachableBackend();
    popup = await ext.reopenPopup();
    await popup.getByTestId('tab-ranked').click();
    await expect(popup.getByTestId('ranked-list').getByTestId('ranked-item'), '离线回退缓存渲染 10 项').toHaveCount(10);
  });

  await test.step('S4：离线点击「打开中」筛选，读取提示与控件', async () => {
    await popup.getByTestId('ranked-filter-open').click();
    const hint = popup.getByTestId('ranked-filter-offline-hint');
    await expect(hint, '[E2] 离线筛选提示可见').toBeVisible();
    await expect(hint, '[E2] 提示文案为「筛选需要在线」').toContainText('筛选需要在线');
    await expect(popup.getByTestId('ranked-filter-open'), '[E3] 打开中筛选控件保留可见').toBeVisible();
    await expect(popup.getByTestId('ranked-filter-domain'), '[E3] 域名筛选控件保留可见').toBeVisible();
    await ext.snap(popup, '离线筛选需要在线提示');
  });

  await test.step('S5：读取 storage 中 cache.ranked 的页数', async () => {
    const storage = await ext.getStorage('cache');
    expect(storage.cache.ranked.data.pages, '[E4] 筛选结果未写入缓存，缓存仍为 10 页').toHaveLength(10);
  });

  await test.step('S6：再次点击取消筛选，回到缓存默认列表', async () => {
    await popup.getByTestId('ranked-filter-open').click();
    await expect(popup.getByTestId('ranked-filter-offline-hint'), '[E5] 取消筛选后离线提示不可见').toBeHidden();
    await expect(popup.getByTestId('ranked-total'), '[E5] 回到缓存的 10 条').toHaveText('10');
    await expect(popup.getByTestId('offline-banner-ranked'), '[E5] 排序页离线横幅可见').toBeVisible();
    await ext.snap(popup, '取消筛选回到缓存列表');
  });
});
