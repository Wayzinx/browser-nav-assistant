import { test, expect } from '../fixtures/extension.mjs';

test('TC-UI-RULE-025 离线切换失败不改后端，恢复后开关仍开启', async ({ ext, api, evidence }) => {
  let id;
  let popup = await test.step('S1：保存一条启用规则并在线加载', async () => {
    const preview = await api.post('/api/rules/parse', { text: 'docs.internal.com 的页面永远不要归档' }, { setup: true });
    expect(preview.status, '准备解析成功').toBe(200);
    const saved = await api.post('/api/rules', { rules: preview.body.rules }, { setup: true });
    expect(saved.status, '准备保存成功').toBe(201);
    id = saved.body.rules[0].id;
    const page = await ext.openPopup();
    await page.getByTestId('tab-rules').click();
    await expect(page.getByTestId('rules-item')).toHaveCount(1);
    await expect(page.getByTestId('rules-item')).toHaveAttribute('data-rule-id', id);
    await expect(page.getByTestId('rules-item-toggle')).toBeChecked();
    await ext.snap(page, '在线开关开启');
    return page;
  });
  await test.step('S2：切换不可达后端，操作开关并等待真实失败', async () => {
    await ext.useUnreachableBackend();
    const [failed] = await Promise.all([
      ext.context.waitForEvent('requestfailed', { timeout: 12000, predicate: (r) => r.url() === `http://127.0.0.1:9/api/rules/${id}` && r.method() === 'PATCH' }),
      popup.getByTestId('rules-item-toggle').click(),
    ]);
    evidence.note(`启停连接失败：${failed.failure()?.errorText}`);
    await expect(popup.getByTestId('connection-status')).toHaveAttribute('data-state', 'offline', { timeout: 12000 });
    await ext.snap(popup, '离线切换失败');
  });
  await test.step('S3：用真实后端读回规则仍启用', async () => {
    const rules = await api.get('/api/rules');
    expect(rules.body.total, '[E1] 后端仍有一条规则').toBe(1);
    expect(rules.body.rules, '[E1] 目标规则仍启用').toEqual([expect.objectContaining({ id, enabled: true })]);
  });
  await test.step('S4：恢复地址并重开核对开关', async () => {
    await ext.setApiBase(ext.baseURL);
    popup = await ext.reopenPopup();
    await popup.getByTestId('tab-rules').click();
    await expect(popup.getByTestId('connection-status')).toHaveAttribute('data-state', 'online', { timeout: 12000 });
    await expect(popup.getByTestId('rules-list-loading')).toBeHidden();
    await expect(popup.getByTestId('rules-item')).toHaveAttribute('data-rule-id', id);
    await expect(popup.getByTestId('rules-item-toggle'), '[E2] 恢复后开关显示开启').toBeChecked();
    await expect(popup.getByTestId('rules-item-toggle'), '[E2] 恢复后的启停开关可用').toBeEnabled();
    await ext.snap(popup, '恢复后仍开启');
  });
});
