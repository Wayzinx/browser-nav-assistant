import { test, expect } from '../fixtures/extension.mjs';

test('TC-UI-RULE-020 删除最后一条需要确认，确认后进入空状态', async ({ ext, api }) => {
  const deletes = [];
  ext.context.on('request', (r) => { if (r.url().startsWith(`${ext.baseURL}/api/rules/`) && r.method() === 'DELETE') deletes.push(r.url()); });
  let popup = await test.step('S1：保存一条规则并打开列表', async () => {
    const preview = await api.post('/api/rules/parse', { text: 'docs.internal.com 的页面永远不要归档' }, { setup: true });
    expect(preview.status, '准备解析成功').toBe(200);
    const saved = await api.post('/api/rules', { rules: preview.body.rules }, { setup: true });
    expect(saved.status, '准备保存成功').toBe(201);
    const page = await ext.openPopup();
    await page.getByTestId('tab-rules').click();
    await expect(page.getByTestId('rules-item')).toHaveCount(1);
    await ext.snap(page, '最后一条');
    return page;
  });
  await test.step('S2：只点删除不确认，重开仍存在', async () => {
    await popup.getByTestId('rules-item').getByTestId('rules-item-delete').click();
    await expect(popup.getByTestId('rules-item-delete-confirm')).toBeVisible();
    await ext.snap(popup, '未确认删除');
    popup = await ext.reopenPopup();
    await popup.getByTestId('tab-rules').click();
    await expect(popup.getByTestId('rules-item'), '[E1] 未确认规则仍在').toHaveCount(1);
    const rules = await api.get('/api/rules');
    expect(rules.body.total, '[E1] 后端仍有一条').toBe(1);
    expect(deletes, '[E1] 未确认不发删除请求').toEqual([]);
    await ext.snap(popup, '未确认重开仍在');
  });
  await test.step('S3：确认删除最后一条', async () => {
    await popup.getByTestId('rules-item').getByTestId('rules-item-delete').click();
    await popup.getByTestId('rules-item').getByTestId('rules-item-delete-confirm').click();
    await expect(popup.getByTestId('rules-item')).toHaveCount(0);
    await expect(popup.getByTestId('rules-list-empty'), '[E2] 最后一条删除后显示空状态').toBeVisible();
    await expect(popup.getByTestId('rules-count'), '[E2] 计数变为零').toHaveText('0');
    await ext.snap(popup, '确认后空列表');
  });
  await test.step('S4：读回规则和健康接口', async () => {
    const rules = await api.get('/api/rules');
    const health = await api.get('/api/health');
    expect(rules.body, '[E3] 规则列表为空').toMatchObject({ total: 0, rules: [] });
    expect(health.body.ruleCount, '[E3] 健康接口规则数为零').toBe(0);
  });
});
