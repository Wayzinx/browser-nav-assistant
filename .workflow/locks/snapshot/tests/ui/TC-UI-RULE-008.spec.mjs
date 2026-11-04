import { test, expect } from '../fixtures/extension.mjs';

test('TC-UI-RULE-008 未指定天数展示默认十四天与中置信度', async ({ ext }) => {
  const popup = await test.step('S1：打开规则页签', async () => {
    const page = await ext.openPopup();
    await page.getByTestId('tab-rules').click();
    return page;
  });
  await test.step('S2：解析未指定天数的归档文本', async () => {
    await popup.getByTestId('rule-input').fill('GitHub 的页面建议归档');
    await popup.getByTestId('rule-parse-button').click();
    await expect(popup.getByTestId('rule-card'), '[E1] 只有一张规则卡片').toHaveCount(1);
    await ext.snap(popup, '默认天数解析');
  });
  await test.step('S3：核对默认值与提示', async () => {
    const card = popup.getByTestId('rule-card');
    await expect(card, '[E1] 建议归档类型').toHaveAttribute('data-type', 'archive_candidate');
    await expect(card.getByTestId('rule-card-type'), '[E1] 建议归档标签').toHaveText('建议归档');
    await expect(card.getByTestId('rule-card-fields'), '[E2] 正确域名').toContainText('github.com');
    await expect(card.getByTestId('rule-card-fields'), '[E2] 默认十四天').toContainText('14 天');
    await expect(card.getByTestId('rule-card-confidence'), '[E3] 中置信度').toHaveText('中');
    await expect(popup.getByTestId('rule-unparsed'), '[E4] 默认值提示可见').toBeVisible();
    await expect(popup.getByTestId('rule-unparsed'), '[E4] 说明使用默认十四天').toContainText('未指定天数，使用默认 14 天');
    await ext.snap(popup, '默认值说明');
  });
});
