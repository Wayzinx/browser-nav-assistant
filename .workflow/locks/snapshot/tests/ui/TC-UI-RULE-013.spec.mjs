import { test, expect } from '../fixtures/extension.mjs';

test('TC-UI-RULE-013 中途断网保存失败保留预览且不写库', async ({ ext, api, evidence }) => {
  const popup = await test.step('S1：在线解析两条规则', async () => {
    const page = await ext.openPopup();
    await page.getByTestId('tab-rules').click();
    await page.getByTestId('rule-input').fill('把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档');
    await page.getByTestId('rule-parse-button').click();
    await expect(page.getByTestId('rule-card')).toHaveCount(2);
    await ext.snap(page, '在线预览');
    return page;
  });
  await test.step('S2：不刷新切换不可达后端', async () => {
    await ext.useUnreachableBackend();
  });
  await test.step('S3：保存失败后核对错误和预览', async () => {
    const [failed] = await Promise.all([
      ext.context.waitForEvent('requestfailed', { timeout: 12000, predicate: (r) => r.url() === 'http://127.0.0.1:9/api/rules' && r.method() === 'POST' }),
      popup.getByTestId('rule-save-button').click(),
    ]);
    evidence.note(`保存连接失败：${failed.failure()?.errorText}`);
    await expect(popup.getByTestId('connection-status')).toHaveAttribute('data-state', 'offline', { timeout: 12000 });
    await expect(popup.getByTestId('rule-save-result'), '[E1] 显示保存结果').toBeVisible({ timeout: 12000 });
    await expect(popup.getByTestId('rule-save-result'), '[E1] 错误至少两个字符').toHaveText(/\S[\s\S]*\S/);
    await expect(popup.getByTestId('rule-save-result'), '[E1] 不能误报已保存').not.toContainText('已保存');
    await expect(popup.getByTestId('rule-card'), '[E2] 失败保留两张预览').toHaveCount(2);
    await ext.snap(popup, '保存失败保留预览');
  });
  await test.step('S4：通过仍在线的真实后端核对没有规则', async () => {
    const response = await api.get('/api/rules');
    expect(response.body.total, '[E3] 后端未保存规则').toBe(0);
  });
});
