import { test, expect } from '../fixtures/extension.mjs';

test('TC-UI-RULE-017 离线仍展示先前加载的规则缓存', async ({ ext, api }) => {
  let popup;
  const ids = await test.step('S1：保存两条并在线加载形成真实缓存', async () => {
    const preview = await api.post('/api/rules/parse', { text: '把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档' }, { setup: true });
    expect(preview.status, '准备解析成功').toBe(200);
    const saved = await api.post('/api/rules', { rules: preview.body.rules }, { setup: true });
    expect(saved.status, '准备保存成功').toBe(201);
    popup = await ext.openPopup();
    await popup.getByTestId('tab-rules').click();
    await expect(popup.getByTestId('rules-item')).toHaveCount(2);
    await expect(popup.getByTestId('rules-count'), '[E1] 在线时计数为二').toHaveText('2');
    const expectedIds = saved.body.rules.map((r) => r.id).sort();
    await expect.poll(async () => (await ext.getStorage('cache')).cache?.rules, { message: '等待真实规则缓存写入' }).toMatchObject({ data: expect.anything(), cachedAt: expect.any(Number) });
    const displayedIds = await popup.getByTestId('rules-item').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-rule-id')).sort());
    expect(displayedIds, '[E1] 在线列表对应已保存规则').toEqual(expectedIds);
    await ext.snap(popup, '在线缓存两条');
    return displayedIds;
  });
  await test.step('S2：关闭后切换离线并重开', async () => {
    await popup.close();
    await ext.useUnreachableBackend();
    popup = await ext.reopenPopup();
    await popup.getByTestId('tab-rules').click();
    await expect(popup.getByTestId('connection-status')).toHaveAttribute('data-state', 'offline', { timeout: 12000 });
    await expect(popup.getByTestId('rules-list-loading')).toBeHidden({ timeout: 12000 });
  });
  await test.step('S3：核对缓存规则、计数与离线禁用', async () => {
    await expect(popup.getByTestId('rules-item'), '[E2] 离线仍显示两条').toHaveCount(2);
    expect(await popup.getByTestId('rules-item').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-rule-id')).sort()), '[E2] 离线 ID 集合不变').toEqual(ids);
    await expect(popup.getByTestId('rules-count'), '[E2] 离线计数为二').toHaveText('2');
    await expect(popup.getByTestId('rules-list-error'), '[E2] 有缓存不显示列表错误').toBeHidden();
    await expect(popup.getByTestId('rule-parse-button'), '[E3] 离线不可解析').toBeDisabled();
    await expect(popup.getByTestId('rule-offline-hint'), '[E3] 说明后端未连接').toContainText('后端未连接');
    await ext.snap(popup, '离线显示真实缓存');
  });
});
