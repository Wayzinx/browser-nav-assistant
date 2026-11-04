import { test, expect } from '../fixtures/extension.mjs';

test('TC-UI-RULE-024 停用状态重开仍保持，启用数一到零到一', async ({ ext, api }) => {
  let id;
  let popup = await test.step('S1：保存一条规则并核对初始启用数', async () => {
    const preview = await api.post('/api/rules/parse', { text: 'docs.internal.com 的页面永远不要归档' }, { setup: true });
    expect(preview.status, '准备解析成功').toBe(200);
    const saved = await api.post('/api/rules', { rules: preview.body.rules }, { setup: true });
    expect(saved.status, '准备保存成功').toBe(201);
    id = saved.body.rules[0].id;
    const health = await api.get('/api/health');
    expect(health.body, '[E1] 初始一条规则且已启用').toMatchObject({ ruleCount: 1, enabledRuleCount: 1 });
    const page = await ext.openPopup();
    await page.getByTestId('tab-rules').click();
    await expect(page.getByTestId('rules-item-toggle')).toBeChecked();
    await ext.snap(page, '初始启用一条');
    return page;
  });
  await test.step('S2：停用唯一规则并核对健康计数', async () => {
    const [response] = await Promise.all([
      ext.context.waitForEvent('response', { predicate: (r) => r.url() === `${ext.baseURL}/api/rules/${id}` && r.request().method() === 'PATCH' }),
      popup.getByTestId('rules-item-toggle').click(),
    ]);
    expect(response.status()).toBe(200);
    await expect(popup.getByTestId('rules-item-toggle')).not.toBeChecked();
    const health = await api.get('/api/health');
    expect(health.body, '[E2] 停用不减少总数，启用数归零').toMatchObject({ ruleCount: 1, enabledRuleCount: 0 });
    await ext.snap(popup, '停用后启用数零');
  });
  await test.step('S3：重开 popup 核对停用状态保留', async () => {
    popup = await ext.reopenPopup();
    await popup.getByTestId('tab-rules').click();
    await expect(popup.getByTestId('rules-list-loading')).toBeHidden();
    await expect(popup.getByTestId('rules-item'), '[E3] 唯一规则仍存在').toHaveCount(1);
    await expect(popup.getByTestId('rules-item'), '[E3] 规则身份不变').toHaveAttribute('data-rule-id', id);
    await expect(popup.getByTestId('rules-item-toggle'), '[E3] 重开仍为停用').not.toBeChecked();
    await ext.snap(popup, '重开仍停用');
  });
  await test.step('S4：重新启用并读回健康计数', async () => {
    const [response] = await Promise.all([
      ext.context.waitForEvent('response', { predicate: (r) => r.url() === `${ext.baseURL}/api/rules/${id}` && r.request().method() === 'PATCH' }),
      popup.getByTestId('rules-item-toggle').click(),
    ]);
    expect(response.status()).toBe(200);
    await expect(popup.getByTestId('rules-item-toggle')).toBeChecked();
    const health = await api.get('/api/health');
    expect(health.body.enabledRuleCount, '[E4] 启用规则数恢复为一').toBe(1);
    await ext.snap(popup, '启用数恢复一');
  });
});
