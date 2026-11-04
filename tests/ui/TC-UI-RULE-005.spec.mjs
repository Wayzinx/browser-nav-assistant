import { test, expect } from '../fixtures/extension.mjs';

const TEXT = '把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档';

test('TC-UI-RULE-005 首页快捷解析切换规则页并传递原文', async ({ ext }) => {
  const popup = await test.step('S1：打开首页', async () => {
    const page = await ext.openPopup();
    await expect(page.getByTestId('home-rule-input')).toBeVisible();
    await ext.snap(page, '首页快捷输入');
    return page;
  });
  await test.step('S2：首页输入示例句并解析', async () => {
    await popup.getByTestId('home-rule-input').fill(TEXT);
    await expect(popup.getByTestId('home-rule-parse-button'), '[E1] 首页解析可用').toBeEnabled();
    await popup.getByTestId('home-rule-parse-button').click();
  });
  await test.step('S3：核对选中页签、输入和卡片顺序', async () => {
    await expect(popup.getByTestId('tab-rules'), '[E2] 规则页签被选中').toHaveAttribute('aria-selected', 'true');
    await expect(popup.getByTestId('panel-rules'), '[E2] 规则面板可见').toBeVisible();
    await expect(popup.getByTestId('rule-input'), '[E3] 原文完整传递').toHaveValue(TEXT);
    const cards = popup.getByTestId('rule-card');
    await expect(cards, '[E4] 生成两张卡片').toHaveCount(2);
    await expect(popup.getByTestId('rule-parse-loading')).toBeHidden();
    await expect(cards.nth(0), '[E4] 先建议归档').toHaveAttribute('data-type', 'archive_candidate');
    await expect(cards.nth(1), '[E4] 再永不归档').toHaveAttribute('data-type', 'never_archive');
    await ext.snap(popup, '快捷解析结果');
  });
});
