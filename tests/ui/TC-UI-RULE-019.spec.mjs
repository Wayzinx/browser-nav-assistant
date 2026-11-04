import { test, expect } from '../fixtures/extension.mjs';

test('TC-UI-RULE-019 DELETE_RULE 不存在的 ID 返回 NOT_FOUND 且不删已有规则', async ({ ext, api }) => {
  const popup = await test.step('S1：保存一条保护规则并打开 popup', async () => {
    const preview = await api.post('/api/rules/parse', { text: 'docs.internal.com 的页面永远不要归档' }, { setup: true });
    expect(preview.status, '准备解析成功').toBe(200);
    const saved = await api.post('/api/rules', { rules: preview.body.rules }, { setup: true });
    expect(saved.status, '准备保存成功').toBe(201);
    const page = await ext.openPopup();
    await ext.snap(page, '删除消息前');
    return page;
  });
  await test.step('S2：发送不存在 ID 的删除消息', async () => {
    const response = await popup.evaluate(async () => {
      const result = await chrome.runtime.sendMessage({ type: 'DELETE_RULE', payload: { id: 'rule_not_exist' }, requestId: 'delete-missing-rule' });
      console.log('DELETE_RULE 响应', JSON.stringify(result));
      return result;
    });
    expect(response, '[E1] 不存在的规则返回 NOT_FOUND').toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(response.error.message, '[E1] 错误说明含目标 ID').toContain('rule_not_exist');
  });
  await test.step('S3：核对后端和列表没有变化', async () => {
    const rules = await api.get('/api/rules');
    expect(rules.body.total, '[E2] 已有规则数仍为一').toBe(1);
    await popup.getByTestId('tab-rules').click();
    await expect(popup.getByTestId('rules-list-loading')).toBeHidden();
    await expect(popup.getByTestId('rules-item'), '[E3] 列表仍有一条').toHaveCount(1);
    await expect(popup.getByTestId('rules-item'), '[E3] 保护规则未被删除').toHaveAttribute('data-type', 'never_archive');
    await ext.snap(popup, '错误删除未改列表');
  });
});
