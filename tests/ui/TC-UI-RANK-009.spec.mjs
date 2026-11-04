import { test, expect } from '../fixtures/extension.mjs';

// TDD 草稿：只观察真实插件与真实后端，不替换消息或返回值。
// PRD 13.3 第 9 行 issues/100：recency=0.09、frequency=0.32、open=0、domain=1.00、score=0.23。
test('TC-UI-RANK-009 展开第 9 条 issues/100 显示时效 0.09、频次 0.32、打开 0.00、域名 1.00，再点收起后明细隐藏', async ({ ext, api }) => {
  await test.step('S1：调用 api.loadSample() 导入样例', async () => {
    const { res } = await api.loadSample();
    expect(res.status, '样例导入成功').toBe(200);
  });

  const popup = await test.step('S2：打开 popup 并切到排序页签，等待 10 条列表', async () => {
    const page = await ext.openPopup();
    await page.getByTestId('tab-ranked').click();
    await expect(page.getByTestId('ranked-list').getByTestId('ranked-item'), '完整列表渲染 10 条').toHaveCount(10);
    return page;
  });

  await test.step('S3：展开第 9 条，读取标题、分数与四项明细', async () => {
    const items = popup.getByTestId('ranked-list').getByTestId('ranked-item');
    const ninth = items.nth(8);
    await ninth.getByTestId('ranked-item-toggle').click();
    await expect(ninth.getByTestId('ranked-item-title'), '[E1] 第 9 项标题为 issues/100').toHaveText('Old bug report from last sprint');
    await expect(ninth.getByTestId('ranked-item-score'), '[E1] 第 9 项分数为 0.23').toHaveText('0.23');
    const detail = ninth.getByTestId('ranked-item-detail');
    await expect(detail, '第 9 条明细展开可见').toBeVisible();
    await expect(detail.getByTestId('ranked-detail-recency'), '[E2] 时效得分为 0.09').toHaveText('0.09');
    await expect(detail.getByTestId('ranked-detail-frequency'), '[E2] 频次得分为 0.32').toHaveText('0.32');
    await expect(detail.getByTestId('ranked-detail-open'), '[E2] 打开得分为 0.00').toHaveText('0.00');
    await expect(detail.getByTestId('ranked-detail-domain'), '[E2] 域名得分为 1.00').toHaveText('1.00');
    await ext.snap(popup, '第9条展开明细');
  });

  await test.step('S4：再次点击第 9 条的展开按钮收起，读取明细可见性', async () => {
    const items = popup.getByTestId('ranked-list').getByTestId('ranked-item');
    const ninth = items.nth(8);
    await ninth.getByTestId('ranked-item-toggle').click();
    await expect(ninth.getByTestId('ranked-item-detail'), '[E3] 第 9 项明细收起不可见').toBeHidden();
    await expect(items.first().getByTestId('ranked-item-detail'), '[E3] 第 1 项明细未被连带展开').toBeHidden();
    await ext.snap(popup, '第9条收起后');
  });
});
