import { test, expect } from '../fixtures/extension.mjs';

test('TC-UI-RULE-011 勾选数二到一到零到一，仅保存归档规则', async ({ ext, api }) => {
  const popup = await test.step('S1：解析示例句', async () => {
    const page = await ext.openPopup();
    await page.getByTestId('tab-rules').click();
    await page.getByTestId('rule-input').fill('把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档');
    await page.getByTestId('rule-parse-button').click();
    await expect(page.getByTestId('rule-card')).toHaveCount(2);
    await ext.snap(page, '默认两条');
    return page;
  });
  const cards = popup.getByTestId('rule-card');
  await test.step('S2：取消第二条', async () => {
    await expect(cards.nth(1)).toHaveAttribute('data-type', 'never_archive');
    await cards.nth(1).getByTestId('rule-card-checkbox').uncheck();
    await expect(popup.getByTestId('rule-save-button'), '[E1] 只选择一条').toHaveText('确认保存 1 条');
    await expect(popup.getByTestId('rule-save-button'), '[E1] 一条可以保存').toBeEnabled();
    await ext.snap(popup, '选择一条');
  });
  await test.step('S3：全部取消', async () => {
    await cards.nth(0).getByTestId('rule-card-checkbox').uncheck();
    await expect(popup.getByTestId('rule-save-button'), '[E2] 选择零条').toHaveText('确认保存 0 条');
    await expect(popup.getByTestId('rule-save-button'), '[E2] 零条不能保存').toBeDisabled();
    await ext.snap(popup, '零条不可保存');
  });
  await test.step('S4：重新勾选第一条并保存', async () => {
    await cards.nth(0).getByTestId('rule-card-checkbox').check();
    await expect(popup.getByTestId('rule-save-button'), '[E3] 恢复选择一条').toHaveText('确认保存 1 条');
    await popup.getByTestId('rule-save-button').click();
    await expect(popup.getByTestId('rule-save-result'), '[E3] 保存一条成功').toContainText('1');
    await ext.snap(popup, '保存一条');
  });
  await test.step('S5：读回后端与列表', async () => {
    const rules = await api.get('/api/rules');
    expect(rules.body.total, '[E4] 后端只有一条').toBe(1);
    expect(rules.body.rules, '[E4] 只保存 GitHub 归档规则').toEqual([
      expect.objectContaining({ type: 'archive_candidate', domain: 'github.com' }),
    ]);
    await expect(popup.getByTestId('rules-item'), '[E5] 列表只有一条').toHaveCount(1);
    await expect(popup.getByTestId('rules-item'), '[E5] 类型是归档规则').toHaveAttribute('data-type', 'archive_candidate');
    await expect(popup.getByTestId('rules-count'), '[E5] 列表计数为一').toHaveText('1');
    await ext.snap(popup, '只剩归档规则');
  });
});
