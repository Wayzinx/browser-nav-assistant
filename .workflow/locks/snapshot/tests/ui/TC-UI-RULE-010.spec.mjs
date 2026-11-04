import { test, expect } from '../fixtures/extension.mjs';

test('TC-UI-RULE-010 默认勾选两条并保存，列表与后端一致', async ({ ext, api, evidence }) => {
  const popup = await test.step('S1：解析示例句得到两条预览', async () => {
    const page = await ext.openPopup();
    await page.getByTestId('tab-rules').click();
    await page.getByTestId('rule-input').fill('把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档');
    await page.getByTestId('rule-parse-button').click();
    await expect(page.getByTestId('rule-card')).toHaveCount(2);
    await ext.snap(page, '保存前预览');
    return page;
  });
  await test.step('S2：核对默认勾选和保存条数', async () => {
    for (const index of [0, 1]) {
      await expect(popup.getByTestId('rule-card').nth(index).getByTestId('rule-card-checkbox'), '[E1] 默认勾选').toBeChecked();
    }
    await expect(popup.getByTestId('rule-save-button'), '[E1] 确认保存两条').toHaveText('确认保存 2 条');
    await expect(popup.getByTestId('rule-save-button'), '[E1] 保存按钮可用').toBeEnabled();
  });
  await test.step('S3：点击保存并观察真实 POST 响应', async () => {
    const [response] = await Promise.all([
      ext.context.waitForEvent('response', { predicate: (r) => r.url() === `${ext.baseURL}/api/rules` && r.request().method() === 'POST' }),
      popup.getByTestId('rule-save-button').click(),
    ]);
    expect(response.status(), '[E3] 保存接口返回 201').toBe(201);
    evidence.note(`保存响应：${JSON.stringify(await response.json())}`);
    await expect(popup.getByTestId('rule-save-result'), '[E2] 保存结果可见').toBeVisible();
    await expect(popup.getByTestId('rule-save-result'), '[E2] 成功保存两条').toContainText('2');
    await expect(popup.getByTestId('rule-save-result'), '[E2] 没有失败提示').not.toContainText('失败');
    await ext.snap(popup, '保存完成');
  });
  await test.step('S4：读回后端并核对列表与预览清空', async () => {
    const rules = await api.get('/api/rules');
    const health = await api.get('/api/health');
    expect(rules.body.total, '[E3] 后端保存两条').toBe(2);
    expect(rules.body.rules, '[E3] 两条规则类型和启用状态正确').toEqual([
      expect.objectContaining({ id: expect.stringMatching(/\S/), type: 'archive_candidate', enabled: true }),
      expect.objectContaining({ id: expect.stringMatching(/\S/), type: 'never_archive', enabled: true }),
    ]);
    const ids = rules.body.rules.map((r) => r.id).sort();
    expect(new Set(ids).size, '[E3] 正式 ID 互不相同').toBe(2);
    expect(health.body.ruleCount, '[E3] 健康接口有两条规则').toBe(2);
    const items = popup.getByTestId('rules-item');
    await expect(popup.getByTestId('rules-count'), '[E4] 列表计数为二').toHaveText('2');
    await expect(items, '[E4] 列表显示两条').toHaveCount(2);
    expect(await items.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-rule-id')).sort()), '[E4] UI ID 集合与后端相同').toEqual(ids);
    expect(await items.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-type')).sort()), '[E4] UI 类型集合正确').toEqual(['archive_candidate', 'never_archive']);
    await expect(popup.getByTestId('rule-card'), '[E5] 成功后清空预览').toHaveCount(0);
    await ext.snap(popup, '列表与后端一致');
  });
});
