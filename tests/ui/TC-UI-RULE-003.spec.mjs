import { test, expect } from '../fixtures/extension.mjs';

test('TC-UI-RULE-003 无动作文本显示原因和例句且不能保存', async ({ ext, api }) => {
  const popup = await test.step('S1：打开规则页签', async () => {
    const page = await ext.openPopup();
    await page.getByTestId('tab-rules').click();
    return page;
  });
  await test.step('S2：解析没有动作的文本', async () => {
    await popup.getByTestId('rule-input').fill('帮我整理一下');
    await popup.getByTestId('rule-parse-button').click();
    await expect(popup.getByTestId('rule-unparsed'), '[E1] 显示无法识别提示').toBeVisible();
    await expect(popup.getByTestId('rule-parse-loading')).toBeHidden();
    await ext.snap(popup, '无法识别提示');
  });
  await test.step('S3：核对原因、例句、保存状态与后端', async () => {
    await expect(popup.getByTestId('rule-unparsed'), '[E1] 说明缺少动作').toContainText('没有识别到动作');
    await expect(popup.getByTestId('rule-unparsed'), '[E1] 保留输入原文').toContainText('帮我整理一下');
    await expect(popup.getByTestId('rule-unparsed'), '[E2] 展示归档例句').toContainText('归档');
    await expect(popup.getByTestId('rule-card'), '[E3] 无预览卡片').toHaveCount(0);
    // 用例允许隐藏或禁用；读取实时交互状态，不用分支跳过断言。
    await expect.poll(async () => {
      const save = popup.getByTestId('rule-save-button');
      return (await save.isVisible()) && (await save.isEnabled());
    }, { message: '[E3] 无可用的保存按钮' }).toBe(false);
    const rules = await api.get('/api/rules');
    expect(rules.body.total, '[E4] 无规则写入').toBe(0);
    await ext.snap(popup, '无规则且不可保存');
  });
});
