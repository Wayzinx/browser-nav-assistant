import { test, expect } from '../fixtures/extension.mjs';

const TEXT = '把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档';

test('TC-UI-RULE-001 示例句解析展示两张完整卡片及 JSON', async ({ ext }) => {
  const popup = await test.step('S1：打开规则页签', async () => {
    const page = await ext.openPopup();
    await page.getByTestId('tab-rules').click();
    await expect(page.getByTestId('panel-rules')).toBeVisible();
    await ext.snap(page, '规则输入');
    return page;
  });
  const cards = popup.getByTestId('rule-preview-list').getByTestId('rule-card');
  await test.step('S2：输入示例句并解析', async () => {
    await popup.getByTestId('rule-input').fill(TEXT);
    await popup.getByTestId('rule-parse-button').click();
    await expect(cards, '[E1] 解析得到两张卡片').toHaveCount(2);
    await expect(popup.getByTestId('rule-parse-loading')).toBeHidden();
    await expect(popup.getByTestId('rule-preview-list')).toBeVisible();
    await expect(popup.getByTestId('rule-parse-error'), '[E1] 解析没有错误').toBeHidden();
    await ext.snap(popup, '解析完成');
  });
  await test.step('S3：核对两张卡片的字段、原文与置信度', async () => {
    await expect(cards.nth(0), '[E2] 第一条类型').toHaveAttribute('data-type', 'archive_candidate');
    await expect(cards.nth(0).getByTestId('rule-card-type'), '[E2] 类型标签').toHaveText('建议归档');
    await expect(cards.nth(0).getByTestId('rule-card-fields'), '[E2] 域名、路径、天数').toContainText('github.com');
    await expect(cards.nth(0).getByTestId('rule-card-fields'), '[E2] issue 路径').toContainText('/issues/');
    await expect(cards.nth(0).getByTestId('rule-card-fields'), '[E2] 七天').toContainText('7 天');
    await expect(cards.nth(0).getByTestId('rule-card-raw'), '[E2] 子句原文').toHaveText('把 7 天没访问过的 GitHub issue 建议归档');
    await expect(cards.nth(1), '[E3] 第二条类型').toHaveAttribute('data-type', 'never_archive');
    await expect(cards.nth(1).getByTestId('rule-card-type'), '[E3] 类型标签').toHaveText('永不归档');
    await expect(cards.nth(1).getByTestId('rule-card-fields'), '[E3] 保护域名').toContainText('docs.internal.com');
    await expect(cards.nth(1).getByTestId('rule-card-raw'), '[E3] 子句原文').toHaveText('docs.internal.com 的页面永远不要归档');
    for (const index of [0, 1]) {
      await expect(cards.nth(index).getByTestId('rule-card-confidence'), '[E4] 置信度可见').toBeVisible();
      await expect(cards.nth(index).getByTestId('rule-card-confidence'), '[E4] 高置信度').toHaveText('高');
    }
  });
  await test.step('S4：展开 JSON 并核对结构化结果', async () => {
    await cards.nth(0).getByTestId('rule-card-json-toggle').click();
    const json = cards.nth(0).getByTestId('rule-card-json');
    await expect(json, '[E5] JSON 可见').toBeVisible();
    expect(JSON.parse(await json.textContent()), '[E5] JSON 中的规则要素完整').toMatchObject({
      type: 'archive_candidate', domain: 'github.com', urlPattern: '/issues/', inactiveDays: 7, action: 'suggest_archive',
    });
    await ext.snap(popup, '展开JSON');
  });
});
