import { test, expect } from '../fixtures/extension.mjs';

// TDD 草稿：只观察真实插件与真实后端，不替换消息或返回值。
// 期望值取自 PRD 13.3 第 1 行（issues/123 明细）与第 10 行（Google 搜索页 score=0.11）。
const FIRST_TITLE = 'Fix login redirect bug';
const ALL_TITLES = [
  'Fix login redirect bug',
  'Refactor auth middleware (#456)',
  'Fetch API - Web APIs | MDN',
  'useState – React',
  'Fix login redirect bug - Comments',
  'Actions · org/repo',
  'Quick Start – React',
  'AI Agent Design Guidelines',
  'Old bug report from last sprint',
  'chrome extension manifest v3 - Google Search',
];
const ALL_SCORES = ['1.00', '0.94', '0.83', '0.69', '0.68', '0.68', '0.57', '0.56', '0.23', '0.11'];

test('TC-UI-RANK-002 排序页签展示完整 10 条且公式常驻，展开第 1 条显示时效 0.99、频次 1.00、打开 1.00、域名 1.00', async ({ ext, api }) => {
  await test.step('S1：调用 api.loadSample() 导入样例', async () => {
    const { res } = await api.loadSample();
    expect(res.status, '样例导入成功').toBe(200);
  });

  const popup = await test.step('S2：打开 popup 并切到排序页签，等待加载结束', async () => {
    const page = await ext.openPopup();
    await page.getByTestId('tab-ranked').click();
    await expect(page.getByTestId('ranked-loading'), '排序页签加载结束').toBeHidden();
    await expect(page.getByTestId('ranked-list'), '排序完整列表渲染').toBeVisible();
    return page;
  });

  await test.step('S3：读取公式说明、条数与完整列表的标题、分数', async () => {
    await expect(popup.getByTestId('tab-ranked'), '[E1] 排序页签被选中').toHaveAttribute('aria-selected', 'true');
    await expect(popup.getByTestId('panel-ranked'), '[E1] 排序面板可见').toBeVisible();
    await expect(popup.getByTestId('ranked-empty'), '[E1] 空状态不可见').toBeHidden();
    await expect(popup.getByTestId('ranked-error'), '[E1] 错误状态不可见').toBeHidden();

    const formula = popup.getByTestId('ranked-formula');
    await expect(formula, '[E2] 评分公式常驻可见').toBeVisible();
    await expect(formula, '[E2] 公式含时效权重 0.4').toContainText('0.4');
    await expect(formula, '[E2] 公式含频次权重 0.3').toContainText('0.3');
    await expect(formula, '[E2] 公式含打开权重 0.2').toContainText('0.2');
    await expect(formula, '[E2] 公式含域名权重 0.1').toContainText('0.1');

    await expect(popup.getByTestId('ranked-total'), '[E3] 当前筛选条数为 10').toHaveText('10');
    const items = popup.getByTestId('ranked-list').getByTestId('ranked-item');
    await expect(items, '[E3] 完整列表恰有 10 条').toHaveCount(10);
    await expect(items.getByTestId('ranked-item-title'), '[E4] 10 项标题及顺序与 PRD 13.3 一致').toHaveText(ALL_TITLES);
    const scoreLocator = items.getByTestId('ranked-item-score');
    await expect(scoreLocator, '[E4] 10 项分数及顺序与 PRD 13.3 一致').toHaveText(ALL_SCORES);
    await expect(items.first().getByTestId('ranked-item-title'), '[E4] 第 1 项标题为 issues/123').toHaveText(FIRST_TITLE);
    await expect(items.first().getByTestId('ranked-item-score'), '[E4] 第 1 项分数为 1.00').toHaveText('1.00');
    await expect(items.nth(9).getByTestId('ranked-item-score'), '[E4] 第 10 项分数为 0.11').toHaveText('0.11');
    const scoreTexts = await scoreLocator.allInnerTexts();
    const scores = scoreTexts.map(Number);
    expect(scores.every((value, i) => i === 0 || value <= scores[i - 1]), '[E4] 10 项分数非递增（允许同分）').toBe(true);
    await ext.snap(popup, '排序页签完整列表');
  });

  await test.step('S4：展开前确认明细隐藏，然后点击第 1 条的展开按钮', async () => {
    const firstItem = popup.getByTestId('ranked-list').getByTestId('ranked-item').first();
    await expect(firstItem.getByTestId('ranked-item-detail'), '[E5] 点击前评分明细不可见').toBeHidden();
    await firstItem.getByTestId('ranked-item-toggle').click();
  });

  await test.step('S5：读取第 1 条展开后的评分明细', async () => {
    const firstItem = popup.getByTestId('ranked-list').getByTestId('ranked-item').first();
    const detail = firstItem.getByTestId('ranked-item-detail');
    await expect(detail, '[E5] 点击后评分明细可见').toBeVisible();
    await expect(detail.getByTestId('ranked-detail-recency'), '[E6] 时效得分为 0.99').toHaveText('0.99');
    await expect(detail.getByTestId('ranked-detail-frequency'), '[E6] 频次得分为 1.00').toHaveText('1.00');
    await expect(detail.getByTestId('ranked-detail-open'), '[E6] 打开得分为 1.00').toHaveText('1.00');
    await expect(detail.getByTestId('ranked-detail-domain'), '[E6] 域名得分为 1.00').toHaveText('1.00');
    for (const testId of ['ranked-detail-recency', 'ranked-detail-frequency', 'ranked-detail-open', 'ranked-detail-domain']) {
      await expect(detail.getByTestId(testId), `[E6] ${testId} 文本为两位小数`).toHaveText(/^\d\.\d{2}$/);
    }
    await ext.snap(popup, '第1条展开评分明细');
  });
});
