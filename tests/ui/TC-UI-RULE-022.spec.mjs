import { test, expect } from '../fixtures/extension.mjs';

const TARGET = 'https://docs.internal.com/ai-agent-design';

async function openCleanup(popup, ext) {
  const [response] = await Promise.all([
    ext.context.waitForEvent('response', { predicate: (r) => r.url().startsWith(`${ext.baseURL}/`) && new URL(r.url()).pathname === '/api/pages/cleanup-suggestions' && r.request().method() === 'GET' }),
    popup.getByTestId('tab-cleanup').click(),
  ]);
  expect(response.status(), '整理页真实网络刷新成功').toBe(200);
  const body = await response.json();
  await expect.poll(async () => (await ext.getStorage('cache')).cache?.cleanup?.cachedAt, { message: '等待新整理响应写入缓存' }).toBeGreaterThanOrEqual(Math.floor(response.request().timing().startTime));
  await expect(popup.getByTestId('cleanup-loading')).toBeHidden();
  await expect(popup.getByTestId('cleanup-error')).toBeHidden();
  await expect(popup.getByTestId('cleanup-group-keep').getByTestId('cleanup-item')).toHaveCount(body.suggestions.filter((s) => s.action === 'keep').length);
  return body.suggestions;
}

test('TC-UI-RULE-022 停用保护规则移除保留建议，启用后恢复', async ({ ext, api, evidence }) => {
  let id;
  const popup = await test.step('S1：导入样例、保存保护规则并打开列表', async () => {
    await api.loadSample();
    const preview = await api.post('/api/rules/parse', { text: 'docs.internal.com 的页面永远不要归档' }, { setup: true });
    expect(preview.status, '准备解析成功').toBe(200);
    const saved = await api.post('/api/rules', { rules: preview.body.rules }, { setup: true });
    expect(saved.status, '准备保存成功').toBe(201);
    id = saved.body.rules[0].id;
    const page = await ext.openPopup();
    await page.getByTestId('tab-rules').click();
    await expect(page.getByTestId('rules-item')).toHaveCount(1);
    await expect(page.getByTestId('rules-item')).toHaveAttribute('data-rule-id', id);
    await expect(page.getByTestId('rules-item-toggle')).toBeChecked();
    await ext.snap(page, '保护规则已开启');
    return page;
  });
  await test.step('S2：关闭开关并核对后端不再保留目标页面', async () => {
    const [response] = await Promise.all([
      ext.context.waitForEvent('response', { predicate: (r) => r.url() === `${ext.baseURL}/api/rules/${id}` && r.request().method() === 'PATCH' }),
      popup.getByTestId('rules-item-toggle').click(),
    ]);
    expect(response.status(), '[E1] 停用接口成功').toBe(200);
    const changed = await response.json();
    expect(changed, '[E1] PATCH 返回停用的目标规则').toMatchObject({ id, enabled: false });
    evidence.note(`停用响应：${JSON.stringify(changed)}`);
    await expect(popup.getByTestId('rules-item-toggle'), '[E1] UI 开关关闭').not.toBeChecked();
    const rules = await api.get('/api/rules');
    expect(rules.body.rules.find((r) => r.id === id), '[E1] 读回规则已经停用').toMatchObject({ enabled: false });
    const cleanup = await api.get('/api/pages/cleanup-suggestions');
    expect(cleanup.body.suggestions, '[E2] 后端不再保留目标页面').not.toContainEqual(expect.objectContaining({ action: 'keep', url: TARGET }));
    await ext.snap(popup, '保护规则已停用');
  });
  await test.step('S3：刷新整理页核对目标页面没有保留项', async () => {
    const fresh = await openCleanup(popup, ext);
    expect(fresh, '[E2] UI 真实请求不再返回目标保留项').not.toContainEqual(expect.objectContaining({ action: 'keep', url: TARGET }));
    const items = popup.getByTestId('cleanup-group-keep').getByTestId('cleanup-item');
    await expect(items.filter({ has: popup.getByTestId('cleanup-item-url').filter({ hasText: TARGET }) }), '[E2] UI 不包含目标保留项').toHaveCount(0);
    await ext.snap(popup, '停用后整理结果');
  });
  await test.step('S4：返回规则页并重新启用', async () => {
    await popup.getByTestId('tab-rules').click();
    await expect(popup.getByTestId('rules-item-toggle')).not.toBeChecked();
    const [response] = await Promise.all([
      ext.context.waitForEvent('response', { predicate: (r) => r.url() === `${ext.baseURL}/api/rules/${id}` && r.request().method() === 'PATCH' }),
      popup.getByTestId('rules-item-toggle').click(),
    ]);
    expect(response.status(), '[E3] 启用接口成功').toBe(200);
    const changed = await response.json();
    expect(changed, '[E3] PATCH 返回启用的目标规则').toMatchObject({ id, enabled: true });
    evidence.note(`启用响应：${JSON.stringify(changed)}`);
    await expect(popup.getByTestId('rules-item-toggle'), '[E3] UI 开关开启').toBeChecked();
    const rules = await api.get('/api/rules');
    expect(rules.body.rules.find((r) => r.id === id), '[E3] 读回规则已经启用').toMatchObject({ enabled: true });
    const cleanup = await api.get('/api/pages/cleanup-suggestions');
    expect(cleanup.body.suggestions, '[E4] 后端恢复目标页面保留项').toContainEqual(expect.objectContaining({ action: 'keep', url: TARGET }));
    await ext.snap(popup, '保护规则重新启用');
  });
  await test.step('S5：刷新整理页核对保留项和规则标签恢复', async () => {
    const fresh = await openCleanup(popup, ext);
    expect(fresh, '[E4] UI 真实请求已恢复目标保留项').toContainEqual(expect.objectContaining({ action: 'keep', url: TARGET }));
    const item = popup.getByTestId('cleanup-group-keep').getByTestId('cleanup-item').filter({ has: popup.getByTestId('cleanup-item-url').filter({ hasText: TARGET }) });
    await expect(item, '[E4] 恰好一个目标保留项').toHaveCount(1);
    await expect(item, '[E4] 建议动作为保留').toHaveAttribute('data-action', 'keep');
    await expect(item.getByTestId('cleanup-item-url'), '[E4] URL 对应目标页面').toContainText(TARGET);
    await expect(item.getByTestId('cleanup-item-rule-tag'), '[E4] 显示命中规则标签').toBeVisible();
    await ext.snap(popup, '启用后保留项恢复');
  });
});
