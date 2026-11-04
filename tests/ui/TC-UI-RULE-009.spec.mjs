import { test, expect } from '../fixtures/extension.mjs';

test('TC-UI-RULE-009 冲突只提示，仍可确认保存两条', async ({ ext }) => {
  const popup = await test.step('S1：打开规则页签', async () => {
    const page = await ext.openPopup();
    await page.getByTestId('tab-rules').click();
    return page;
  });
  await test.step('S2：解析冲突的归档与保护规则', async () => {
    await popup.getByTestId('rule-input').fill('7 天没访问的 GitHub issue 建议归档；github.com 永远不要归档');
    await popup.getByTestId('rule-parse-button').click();
    await expect(popup.getByTestId('rule-card'), '[E1] 冲突句仍解析出两条').toHaveCount(2);
  });
  await test.step('S3：核对卡片顺序、冲突提示与保存按钮', async () => {
    const cards = popup.getByTestId('rule-card');
    await expect(cards.nth(0), '[E1] 第一条归档').toHaveAttribute('data-type', 'archive_candidate');
    await expect(cards.nth(1), '[E1] 第二条保护').toHaveAttribute('data-type', 'never_archive');
    await expect(popup.getByTestId('rule-unparsed'), '[E2] 冲突提示可见').toBeVisible();
    await expect(popup.getByTestId('rule-unparsed'), '[E2] 提醒冲突').toContainText('冲突');
    await expect(popup.getByTestId('rule-unparsed'), '[E2] 提醒永不归档优先').toContainText('永不归档');
    await expect(popup.getByTestId('rule-save-button'), '[E3] 允许保存两条').toHaveText('确认保存 2 条');
    await expect(popup.getByTestId('rule-save-button'), '[E3] 冲突不阻止保存').toBeEnabled();
    await ext.snap(popup, '冲突提示仍可保存');
  });
});
