import { test, expect } from '../fixtures/extension.mjs';

test('TC-UI-RULE-002 仅解析不写库，重开列表仍为空', async ({ ext, api }) => {
  const before = await test.step('S1：记录解析前的规则数', async () => {
    const response = await api.get('/api/rules');
    expect(response.body.total, '[E1] 初始规则数为零').toBe(0);
    return response.body.total;
  });
  let popup = await test.step('S2：打开规则页签并解析示例句', async () => {
    const page = await ext.openPopup();
    await page.getByTestId('tab-rules').click();
    await page.getByTestId('rule-input').fill('把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档');
    await page.getByTestId('rule-parse-button').click();
    await expect(page.getByTestId('rule-card'), '[E1] 得到两张预览卡片').toHaveCount(2);
    await ext.snap(page, '仅解析未保存');
    return page;
  });
  await test.step('S3：不保存并核对规则和健康接口', async () => {
    const rules = await api.get('/api/rules');
    const health = await api.get('/api/health');
    expect(rules.status, '[E2] 规则接口成功').toBe(200);
    expect(rules.body, '[E2] 解析不写入规则').toMatchObject({ total: before, rules: [] });
    expect(health.body.ruleCount, '[E2] 健康接口规则数为零').toBe(0);
  });
  await test.step('S4：重开 popup 核对空列表', async () => {
    popup = await ext.reopenPopup();
    await popup.getByTestId('tab-rules').click();
    await expect(popup.getByTestId('rules-list-loading')).toBeHidden();
    await expect(popup.getByTestId('rules-list-empty'), '[E3] 空状态可见').toBeVisible();
    await expect(popup.getByTestId('rules-count'), '[E3] 规则数为零').toHaveText('0');
    await expect(popup.getByTestId('rules-item'), '[E3] 没有已保存规则').toHaveCount(0);
    await ext.snap(popup, '重开仍为空');
  });
});
