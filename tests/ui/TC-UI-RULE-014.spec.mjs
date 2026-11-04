import { test, expect } from '../fixtures/extension.mjs';

test('TC-UI-RULE-014 已保存列表包含类型、摘要、原文、开关和删除', async ({ ext, api }) => {
  const rules = await test.step('S1：经真实接口准备两条规则并读取列表', async () => {
    const preview = await api.post('/api/rules/parse', { text: '把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档' }, { setup: true });
    expect(preview.status, '准备规则解析成功').toBe(200);
    const saved = await api.post('/api/rules', { rules: preview.body.rules }, { setup: true });
    expect(saved.status, '准备规则保存成功').toBe(201);
    const response = await api.get('/api/rules');
    expect(response.status, '[E1] 规则列表接口成功').toBe(200);
    expect(response.body.total, '[E1] 后端有两条规则').toBe(2);
    expect(response.body.rules, '[E1] 每条规则包含必需字段').toEqual([
      expect.objectContaining({ id: expect.stringMatching(/\S/), rawText: expect.any(String), type: 'archive_candidate', action: 'suggest_archive', enabled: true }),
      expect.objectContaining({ id: expect.stringMatching(/\S/), rawText: expect.any(String), type: 'never_archive', action: 'keep', enabled: true }),
    ]);
    return response.body.rules;
  });
  const popup = await test.step('S2：打开规则列表', async () => {
    const page = await ext.openPopup();
    await page.getByTestId('tab-rules').click();
    await expect(page.getByTestId('rules-list')).toBeVisible();
    await expect(page.getByTestId('rules-item'), '[E2] 列表显示两条').toHaveCount(2);
    await expect(page.getByTestId('rules-list-loading')).toBeHidden();
    await expect(page.getByTestId('rules-count'), '[E2] 规则计数为二').toHaveText('2');
    expect(await page.getByTestId('rules-item').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-rule-id')).sort()), '[E2] ID 集合与接口一致').toEqual(rules.map((r) => r.id).sort());
    await ext.snap(page, '已保存列表');
    return page;
  });
  await test.step('S3：逐条核对展示与操作控件', async () => {
    const items = popup.getByTestId('rules-item');
    const archive = items.filter({ has: popup.getByTestId('rules-item-type').filter({ hasText: /^建议归档$/ }) });
    const keep = items.filter({ has: popup.getByTestId('rules-item-type').filter({ hasText: /^永不归档$/ }) });
    await expect(archive, '[E3] 归档项类型').toHaveAttribute('data-type', 'archive_candidate');
    await expect(archive.getByTestId('rules-item-type'), '[E3] 归档类型标签').toHaveText('建议归档');
    await expect(archive.getByTestId('rules-item-raw'), '[E3] 归档原文').toHaveText('把 7 天没访问过的 GitHub issue 建议归档');
    await expect(archive.getByTestId('rules-item-summary'), '[E3] 归档域名摘要').toContainText('github.com');
    await expect(keep, '[E4] 保护项类型').toHaveAttribute('data-type', 'never_archive');
    await expect(keep.getByTestId('rules-item-type'), '[E4] 保护类型标签').toHaveText('永不归档');
    await expect(keep.getByTestId('rules-item-raw'), '[E4] 保护原文').toHaveText('docs.internal.com 的页面永远不要归档');
    await expect(keep.getByTestId('rules-item-summary'), '[E4] 保护域名摘要').toContainText('docs.internal.com');
    for (const item of [archive, keep]) {
      await expect(item.getByTestId('rules-item-toggle'), '[E5] 开关默认开启').toBeChecked();
      await expect(item.getByTestId('rules-item-toggle'), '[E5] 开关语义正确').toHaveAttribute('role', 'switch');
      await expect(item.getByTestId('rules-item-delete'), '[E5] 删除按钮可见').toBeVisible();
      await expect(item.getByTestId('rules-item-delete'), '[E5] 删除按钮可用').toBeEnabled();
    }
    await ext.snap(popup, '规则字段与操作');
  });
});
