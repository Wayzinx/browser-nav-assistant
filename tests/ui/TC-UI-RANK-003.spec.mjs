import { test, expect } from '../fixtures/extension.mjs';

// TDD 草稿：筛选只走后端 ?openOnly=true（插件端不二次过滤），不替换消息或返回值。
// resource.json 中 isOpen=true 的 4 页，按分数降序。
const OPEN_TITLES = [
  'Fix login redirect bug',
  'Refactor auth middleware (#456)',
  'Fetch API - Web APIs | MDN',
  'AI Agent Design Guidelines',
];
const OPEN_SCORES = ['1.00', '0.94', '0.83', '0.56'];

test('TC-UI-RANK-003 排序页签点击「打开中」筛选：只显示 4 条，再次点击恢复 10 条', async ({ ext, api }) => {
  await test.step('S1：调用 api.loadSample() 导入样例', async () => {
    const { res } = await api.loadSample();
    expect(res.status, '样例导入成功').toBe(200);
  });

  const popup = await test.step('S2：打开 popup 并切到排序页签，等待完整列表', async () => {
    const page = await ext.openPopup();
    await page.getByTestId('tab-ranked').click();
    await expect(page.getByTestId('ranked-list'), '排序列表渲染').toBeVisible();
    await expect(page.getByTestId('ranked-total'), '初始共 10 条').toHaveText('10');
    return page;
  });

  await test.step('S3：点击「打开中」筛选，等待条数变化', async () => {
    await popup.getByTestId('ranked-filter-open').click();
    await expect(popup.getByTestId('ranked-total'), '筛选后条数变为 4').toHaveText('4');
  });

  await test.step('S4：读取筛选开关状态、条数与 4 条结果', async () => {
    await expect(popup.getByTestId('ranked-filter-open'), '[E1] 打开中筛选为按下状态').toHaveAttribute('aria-pressed', 'true');
    await expect(popup.getByTestId('ranked-total'), '[E2] 筛选后条数为 4').toHaveText('4');
    const items = popup.getByTestId('ranked-list').getByTestId('ranked-item');
    await expect(items, '[E2] 列表恰好 4 条').toHaveCount(4);
    await expect(items.getByTestId('ranked-item-title'), '[E3] 4 项标题及顺序为 4 个打开页').toHaveText(OPEN_TITLES);
    await expect(items.getByTestId('ranked-item-score'), '[E3] 4 项分数依次为 1.00/0.94/0.83/0.56').toHaveText(OPEN_SCORES);
    await ext.snap(popup, '打开中筛选结果4条');
  });

  await test.step('S5：再次点击取消筛选，等待条数恢复', async () => {
    await popup.getByTestId('ranked-filter-open').click();
    await expect(popup.getByTestId('ranked-total'), '[E4] 取消后条数恢复为 10').toHaveText('10');
    await expect(popup.getByTestId('ranked-filter-open'), '[E4] 筛选开关恢复未按下').toHaveAttribute('aria-pressed', 'false');
    await expect(popup.getByTestId('ranked-list').getByTestId('ranked-item'), '[E4] 列表恢复为 10 条').toHaveCount(10);
    await ext.snap(popup, '取消筛选恢复10条');
  });
});
