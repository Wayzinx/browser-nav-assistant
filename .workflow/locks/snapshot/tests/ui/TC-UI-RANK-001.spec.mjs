import { test, expect } from '../fixtures/extension.mjs';

// TDD 草稿：只观察真实插件与真实后端（api.loadSample 经真实 /api/sync 导入），不替换消息或返回值。
// 期望值取自 PRD 13.3：样例无规则时 Top 5 的标题、两位小数分数与排序理由。
const TOP5_TITLES = [
  'Fix login redirect bug',
  'Refactor auth middleware (#456)',
  'Fetch API - Web APIs | MDN',
  'useState – React',
  'Fix login redirect bug - Comments',
];
const TOP5_SCORES = ['1.00', '0.94', '0.83', '0.69', '0.68'];
const FIRST_REASON = '最近 3 天内多次访问（8 次），当前仍处于打开状态，常用域名 github.com';

test('TC-UI-RANK-001 导入样例后打开 popup 首页：历史排序展示 5 条，分数 1.00/0.94/0.83/0.69/0.68 降序且理由非空', async ({ ext, api }) => {
  await test.step('S1：调用 api.loadSample() 导入样例，断言响应 200', async () => {
    const { res } = await api.loadSample();
    expect(res.status, '[E1] 导入响应 200').toBe(200);
    expect(res.body.created, '[E1] 样例新建 10 个页面').toBe(10);
  });

  const popup = await test.step('S2：以 tab 方式打开 popup，等待首页排序加载结束', async () => {
    const page = await ext.openPopup();
    await expect(page.getByTestId('tab-home'), '首页页签默认选中').toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('home-ranked-list'), '[E2] 历史排序列表可见').toBeVisible();
    await expect(page.getByTestId('home-ranked-loading'), '[E2] 加载态不可见').toBeHidden();
    await expect(page.getByTestId('home-ranked-empty'), '[E2] 空状态不可见').toBeHidden();
    await expect(page.getByTestId('home-ranked-error'), '[E2] 错误状态不可见').toBeHidden();
    return page;
  });

  await test.step('S3：读取 Top 5 排序项的标题、分数与理由', async () => {
    const items = popup.getByTestId('home-ranked-list').getByTestId('home-ranked-item');
    await expect(items, '[E3] 首页恰好展示 5 条排序项').toHaveCount(5);
    await expect(items.getByTestId('ranked-item-title'), '[E4] 5 项标题及顺序与 PRD 13.3 一致').toHaveText(TOP5_TITLES);

    const scoreLocator = items.getByTestId('ranked-item-score');
    await expect(scoreLocator, '[E5] 分数依次为 1.00/0.94/0.83/0.69/0.68').toHaveText(TOP5_SCORES);
    const scoreTexts = await scoreLocator.allInnerTexts();
    expect(scoreTexts.every((text) => /^\d\.\d{2}$/.test(text)), '[E5] 每项分数都是两位小数').toBe(true);
    const scores = scoreTexts.map(Number);
    expect(scores.every((value, i) => i === 0 || value <= scores[i - 1]), '[E5] 分数非递增').toBe(true);

    const reasonLocator = items.getByTestId('ranked-item-reason');
    const reasonTexts = await reasonLocator.allInnerTexts();
    expect(reasonTexts.every((text) => text.trim().length > 0), '[E6] 5 项理由 trim 后均非空').toBe(true);
    await expect(items.first().getByTestId('ranked-item-reason'), '[E6] 第 1 项理由完整匹配 PRD 13.3').toHaveText(FIRST_REASON);
    await expect(items.nth(1).getByTestId('ranked-item-reason'), '[E6] 第 2 项理由以「正在浏览」开头').toHaveText(/^正在浏览/);
    await ext.snap(popup, '首页历史排序Top5');
  });
});
