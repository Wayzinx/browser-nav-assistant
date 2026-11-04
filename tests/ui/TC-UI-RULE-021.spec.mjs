import { test, expect } from '../fixtures/extension.mjs';

test('TC-UI-RULE-021 中途断网删除失败，UI 和后端均保留两条', async ({ ext, api, evidence }) => {
  let popup;
  let keepId;
  const ids = await test.step('S1：保存并在线加载两条规则', async () => {
    const preview = await api.post('/api/rules/parse', { text: '把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档' }, { setup: true });
    expect(preview.status, '准备解析成功').toBe(200);
    const saved = await api.post('/api/rules', { rules: preview.body.rules }, { setup: true });
    expect(saved.status, '准备保存成功').toBe(201);
    keepId = saved.body.rules.find((r) => r.type === 'never_archive').id;
    popup = await ext.openPopup();
    await popup.getByTestId('tab-rules').click();
    await expect(popup.getByTestId('rules-item')).toHaveCount(2);
    const displayedIds = await popup.getByTestId('rules-item').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-rule-id')).sort());
    expect(displayedIds, '在线列表对应准备的正式规则').toEqual(saved.body.rules.map((r) => r.id).sort());
    await ext.snap(popup, '断网前两条规则');
    return displayedIds;
  });
  await test.step('S2：不刷新切换不可达后端', async () => {
    await ext.useUnreachableBackend();
  });
  await test.step('S3：确认删除并等待对应 DELETE 真实失败', async () => {
    const item = popup.getByTestId('rules-item').filter({ has: popup.getByTestId('rules-item-type').filter({ hasText: /^永不归档$/ }) });
    await expect(item).toHaveAttribute('data-rule-id', keepId);
    await item.getByTestId('rules-item-delete').click();
    const [failed] = await Promise.all([
      ext.context.waitForEvent('requestfailed', { timeout: 12000, predicate: (r) => r.url() === `http://127.0.0.1:9/api/rules/${keepId}` && r.method() === 'DELETE' }),
      item.getByTestId('rules-item-delete-confirm').click(),
    ]);
    evidence.note(`删除连接失败：${failed.failure()?.errorText}`);
    await expect(popup.getByTestId('connection-status')).toHaveAttribute('data-state', 'offline', { timeout: 12000 });
    await expect(popup.getByTestId('rules-list-loading')).toBeHidden();
    await expect(popup.getByTestId('rules-item'), '[E1] 删除失败后仍有两条').toHaveCount(2);
    expect(await popup.getByTestId('rules-item').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-rule-id')).sort()), '[E1] ID 集合不变').toEqual(ids);
    await ext.snap(popup, '删除失败列表保持');
  });
  await test.step('S4：查询真实后端确认未删规则', async () => {
    const rules = await api.get('/api/rules');
    expect(rules.body.total, '[E2] 后端规则数仍为二').toBe(2);
    expect(rules.body.rules.map((r) => r.id).sort(), '[E2] 后端规则身份不变').toEqual(ids);
  });
});
