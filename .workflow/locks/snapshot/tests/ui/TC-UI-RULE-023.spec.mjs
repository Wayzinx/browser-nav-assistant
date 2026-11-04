import { test, expect } from '../fixtures/extension.mjs';

test('TC-UI-RULE-023 TOGGLE_RULE 不存在的 ID 不改变已有启用状态', async ({ ext, api }) => {
  const popup = await test.step('S1：准备一条启用的保护规则并打开 popup', async () => {
    const preview = await api.post('/api/rules/parse', { text: 'docs.internal.com 的页面永远不要归档' }, { setup: true });
    expect(preview.status, '准备解析成功').toBe(200);
    const saved = await api.post('/api/rules', { rules: preview.body.rules }, { setup: true });
    expect(saved.status, '准备保存成功').toBe(201);
    const page = await ext.openPopup();
    await ext.snap(page, '切换消息前');
    return page;
  });
  await test.step('S2：发送不存在 ID 的停用消息', async () => {
    const response = await popup.evaluate(async () => {
      const result = await chrome.runtime.sendMessage({ type: 'TOGGLE_RULE', payload: { id: 'rule_not_exist', enabled: false }, requestId: 'toggle-missing-rule' });
      console.log('TOGGLE_RULE 响应', JSON.stringify(result));
      return result;
    });
    expect(response, '[E1] 不存在的 ID 返回 NOT_FOUND').toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    await ext.snap(popup, '不存在规则切换完成');
  });
  await test.step('S3：读回规则及启用规则计数', async () => {
    const rules = await api.get('/api/rules');
    const health = await api.get('/api/health');
    expect(rules.body.total, '[E2] 规则总数仍为一').toBe(1);
    expect(rules.body.rules, '[E2] 已有规则仍然启用').toEqual([expect.objectContaining({ enabled: true })]);
    expect(health.body.enabledRuleCount, '[E3] 启用规则数仍为一').toBe(1);
  });
});
