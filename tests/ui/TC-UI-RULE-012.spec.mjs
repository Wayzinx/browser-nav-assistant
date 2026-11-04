import { test, expect } from '../fixtures/extension.mjs';

test('TC-UI-RULE-012 SAVE_RULES 拒绝非法类型且不改变规则数', async ({ ext, api }) => {
  const before = await test.step('S1：记录初始规则数', async () => {
    const response = await api.get('/api/rules');
    expect(response.body.total, '[E1] 初始没有规则').toBe(0);
    return response.body.total;
  });
  const popup = await test.step('S2：经消息发送非法规则类型', async () => {
    const page = await ext.openPopup();
    const response = await page.evaluate(async () => {
      const result = await chrome.runtime.sendMessage({
        type: 'SAVE_RULES', requestId: 'invalid-rule-type',
        payload: { rules: [{ rawText: '未知类型规则', type: 'unknown_type', domain: 'github.com', action: 'keep' }] },
      });
      console.log('SAVE_RULES 响应', JSON.stringify(result));
      return result;
    });
    expect(response, '[E2] 非法类型返回校验失败').toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(response.error.message, '[E2] 错误说明非空').toMatch(/\S/);
    await ext.snap(page, '非法类型消息完成');
    return page;
  });
  await test.step('S3：核对后端与空列表', async () => {
    const rules = await api.get('/api/rules');
    const health = await api.get('/api/health');
    expect(rules.body.total, '[E3] 规则数保持初值').toBe(before);
    expect(health.body.ruleCount, '[E3] 健康接口规则数为零').toBe(0);
    await popup.getByTestId('tab-rules').click();
    await expect(popup.getByTestId('rules-list-loading')).toBeHidden();
    await expect(popup.getByTestId('rules-list-empty'), '[E4] 显示空列表').toBeVisible();
    await expect(popup.getByTestId('rules-count'), '[E4] 列表计数为零').toHaveText('0');
    await ext.snap(popup, '非法保存未写库');
  });
});
