import { test, expect } from '../fixtures/extension.mjs';

const TARGET = 'https://docs.internal.com/ai-agent-design';

test('TC-UI-RULE-018 确认删除保护规则后列表和整理建议立即更新', async ({ ext, api, evidence }) => {
  const saved = await test.step('S1：导入样例并保存两条规则，核对原有保留建议', async () => {
    await api.loadSample();
    const preview = await api.post('/api/rules/parse', { text: '把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档' }, { setup: true });
    expect(preview.status, '准备解析成功').toBe(200);
    const response = await api.post('/api/rules', { rules: preview.body.rules }, { setup: true });
    expect(response.status, '准备保存成功').toBe(201);
    const cleanup = await api.get('/api/pages/cleanup-suggestions');
    expect(cleanup.body.suggestions, '[E1] 删除前目标页面被保护').toContainEqual(expect.objectContaining({ action: 'keep', url: TARGET }));
    return response.body.rules;
  });
  const popup = await test.step('S2：打开规则列表', async () => {
    const page = await ext.openPopup();
    await page.getByTestId('tab-rules').click();
    await expect(page.getByTestId('rules-item')).toHaveCount(2);
    await ext.snap(page, '删除前两条');
    return page;
  });
  const keep = popup.getByTestId('rules-item').filter({ has: popup.getByTestId('rules-item-type').filter({ hasText: /^永不归档$/ }) });
  await test.step('S3：先出现行内确认，再执行删除', async () => {
    const id = saved.find((r) => r.type === 'never_archive').id;
    await expect(keep).toHaveAttribute('data-rule-id', id);
    await expect(keep).toHaveAttribute('data-type', 'never_archive');
    await keep.getByTestId('rules-item-delete').click();
    await expect(keep.getByTestId('rules-item-delete-confirm'), '[E2] 出现二次确认').toBeVisible();
    await expect(popup.getByTestId('rules-item'), '[E2] 确认前没有删除').toHaveCount(2);
    await ext.snap(popup, '行内删除确认');
    const [response] = await Promise.all([
      ext.context.waitForEvent('response', { predicate: (r) => r.url() === `${ext.baseURL}/api/rules/${id}` && r.request().method() === 'DELETE' }),
      keep.getByTestId('rules-item-delete-confirm').click(),
    ]);
    expect(response.status(), '[E3] 删除接口成功').toBe(200);
    const body = await response.json();
    expect(body, '[E3] 删除的是目标规则').toMatchObject({ deleted: id, ruleCount: 1 });
    evidence.note(`删除响应：${JSON.stringify(body)}`);
  });
  const suggestions = await test.step('S4：核对剩余规则及后端整理建议', async () => {
    await expect(popup.getByTestId('rules-item'), '[E3] 列表剩一条').toHaveCount(1);
    await expect(popup.getByTestId('rules-item'), '[E3] 剩余的是归档规则').toHaveAttribute('data-type', 'archive_candidate');
    await expect(popup.getByTestId('rules-count'), '[E3] 计数为一').toHaveText('1');
    const rules = await api.get('/api/rules');
    const health = await api.get('/api/health');
    const cleanup = await api.get('/api/pages/cleanup-suggestions');
    expect(rules.body.total, '[E4] 后端剩一条规则').toBe(1);
    expect(health.body.ruleCount, '[E4] 健康接口规则数为一').toBe(1);
    expect(cleanup.body.suggestions, '[E5] 后端不再保护目标页面').not.toContainEqual(expect.objectContaining({ action: 'keep', url: TARGET }));
    await ext.snap(popup, '确认后剩一条');
    return cleanup.body.suggestions;
  });
  await test.step('S5：等待整理页真实刷新再核对保留项', async () => {
    const [response] = await Promise.all([
      ext.context.waitForEvent('response', { predicate: (r) => new URL(r.url()).pathname === '/api/pages/cleanup-suggestions' && r.url().startsWith(`${ext.baseURL}/`) && r.request().method() === 'GET' }),
      popup.getByTestId('tab-cleanup').click(),
    ]);
    expect(response.status(), '[E5] 整理页真实刷新成功').toBe(200);
    expect((await response.json()).suggestions, '[E5] 刷新结果与删除后接口一致').toEqual(suggestions);
    await expect.poll(async () => (await ext.getStorage('cache')).cache?.cleanup?.cachedAt, { message: '等待本次整理响应写入缓存' }).toBeGreaterThanOrEqual(Math.floor(response.request().timing().startTime));
    await expect(popup.getByTestId('cleanup-loading')).toBeHidden();
    await expect(popup.getByTestId('cleanup-error')).toBeHidden();
    const items = popup.getByTestId('cleanup-group-keep').getByTestId('cleanup-item');
    await expect(items, '[E5] 保留项数量与新响应一致').toHaveCount(suggestions.filter((s) => s.action === 'keep').length);
    await expect(items.filter({ has: popup.getByTestId('cleanup-item-url').filter({ hasText: TARGET }) }), '[E5] UI 不再有目标页面的保留项').toHaveCount(0);
    await ext.snap(popup, '整理页不再保留目标');
  });
});
