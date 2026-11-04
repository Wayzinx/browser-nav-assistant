import { test, expect, historyItem } from '../fixtures/extension.mjs';

// TDD 草稿：后端只有 3 个页面时验证 Top 5 下限（不足 5 条不补位）。
// 数据经真实 /api/sync 导入（api.seed），openTabs=[]、activeTab=null。
const THREE_TITLES = ['Page A', 'Page B', 'Page C'];

test('TC-UI-RANK-008 后端只有 3 个页面时首页历史排序显示 3 条（不足 5 条不补位），排序页签 ranked-total 为 3', async ({ ext, api }) => {
  await test.step('S1：用 api.seed 导入 3 条历史', async () => {
    const res = await api.seed({
      activeTab: null,
      openTabs: [],
      history: [
        historyItem('https://example.com/a', { title: 'Page A', daysAgo: 0, visitCount: 5 }),
        historyItem('https://example.com/b', { title: 'Page B', daysAgo: 1, visitCount: 3 }),
        historyItem('https://example.com/c', { title: 'Page C', daysAgo: 10, visitCount: 1 }),
      ],
    });
    expect(res.status, '[E1] 导入响应 200').toBe(200);
    expect(res.body.created, '[E1] 新建 3 个页面').toBe(3);
  });

  const popup = await test.step('S2：打开 popup，等待首页排序加载结束', async () => {
    const page = await ext.openPopup();
    await expect(page.getByTestId('home-ranked-loading'), '首页排序加载结束').toBeHidden();
    await expect(page.getByTestId('home-ranked-list'), '首页排序列表可见').toBeVisible();
    return page;
  });

  await test.step('S3：读取首页排序项数量、标题与分数', async () => {
    const items = popup.getByTestId('home-ranked-list').getByTestId('home-ranked-item');
    await expect(items, '[E2] 首页恰好显示 3 条（不足 5 条不补位）').toHaveCount(3);
    await expect(popup.getByTestId('home-ranked-empty'), '[E2] 首页空状态不可见').toBeHidden();
    await expect(items.getByTestId('ranked-item-title'), '[E3] 3 项标题依次为 Page A/B/C').toHaveText(THREE_TITLES);
    const scoreLocator = items.getByTestId('ranked-item-score');
    const scoreTexts = await scoreLocator.allInnerTexts();
    expect(scoreTexts.every((text) => /^\d\.\d{2}$/.test(text)), '[E3] 每项分数都是两位小数').toBe(true);
    const scores = scoreTexts.map(Number);
    expect(scores.every((value, i) => i === 0 || value <= scores[i - 1]), '[E3] 3 项分数非递增').toBe(true);
    await ext.snap(popup, '首页3条排序');
  });

  await test.step('S4：切到排序页签，读取条数', async () => {
    await popup.getByTestId('tab-ranked').click();
    await expect(popup.getByTestId('ranked-total'), '[E4] 排序页签条数为 3').toHaveText('3');
    await expect(popup.getByTestId('ranked-list').getByTestId('ranked-item'), '[E4] 排序页签列表为 3 条').toHaveCount(3);
    await ext.snap(popup, '排序页签3条');
  });
});
