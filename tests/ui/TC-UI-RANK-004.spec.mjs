import { test, expect } from '../fixtures/extension.mjs';

// TDD 草稿：域名筛选只走后端 ?domain=react.dev（插件端不二次过滤），下拉选项取后端 domains。
// domains 排序：页面数降序、同数字母序；www. 已去掉（PRD 13.3 / F-RANK-01 契约）。
const ALL_DOMAIN_OPTIONS = ['', 'github.com', 'react.dev', 'developer.mozilla.org', 'docs.internal.com', 'google.com'];
const REACT_TITLES = ['useState – React', 'Quick Start – React'];
const REACT_SCORES = ['0.69', '0.57'];

test('TC-UI-RANK-004 排序页签域名下拉选 react.dev：只显示 useState 与 learn 2 条，下拉仍保留全部 5 个域名选项', async ({ ext, api }) => {
  await test.step('S1：调用 api.loadSample() 导入样例', async () => {
    const { res } = await api.loadSample();
    expect(res.status, '样例导入成功').toBe(200);
  });

  const popup = await test.step('S2：打开 popup 并切到排序页签，等待列表出现', async () => {
    const page = await ext.openPopup();
    await page.getByTestId('tab-ranked').click();
    await expect(page.getByTestId('ranked-list'), '排序列表渲染').toBeVisible();
    return page;
  });

  const domainFilter = popup.getByTestId('ranked-filter-domain');

  await test.step('S3：读取域名下拉的全部 option 值（DOM 顺序）', async () => {
    const optionValues = await domainFilter.evaluate((select) => [...select.options].map((option) => option.value));
    expect(optionValues, '[E1] 首项为空值「全部」，其后 5 个域名按页面数降序同数字母序').toEqual(ALL_DOMAIN_OPTIONS);
    await ext.snap(popup, '域名下拉全部选项');
  });

  await test.step('S4：选择 react.dev，读取筛选结果', async () => {
    await domainFilter.selectOption('react.dev');
    await expect(popup.getByTestId('ranked-total'), '[E2] 筛选后条数为 2').toHaveText('2');
    const items = popup.getByTestId('ranked-list').getByTestId('ranked-item');
    await expect(items, '[E2] 列表恰好 2 条').toHaveCount(2);
    await expect(items.getByTestId('ranked-item-title'), '[E3] 2 项为 useState 与 learn').toHaveText(REACT_TITLES);
    await expect(items.getByTestId('ranked-item-score'), '[E3] 2 项分数依次为 0.69/0.57').toHaveText(REACT_SCORES);
    await ext.snap(popup, '域名筛选react.dev结果2条');
  });

  await test.step('S5：再次读取下拉全部非空 option', async () => {
    const optionValues = await domainFilter.evaluate((select) => [...select.options].map((option) => option.value));
    expect(optionValues, '[E4] 选中后选项不收缩，仍为空值加 5 个域名').toEqual(ALL_DOMAIN_OPTIONS);
  });

  await test.step('S6：切回「全部」，等待列表恢复', async () => {
    await domainFilter.selectOption('');
    await expect(popup.getByTestId('ranked-total'), '[E5] 清空筛选后条数恢复为 10').toHaveText('10');
    await ext.snap(popup, '清空域名筛选恢复10条');
  });
});
