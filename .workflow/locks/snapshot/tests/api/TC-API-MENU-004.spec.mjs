import { test, expect } from '../fixtures/api.mjs';

const URL = 'https://example.com/important-note';

test.use({ autoReset: false });

test('TC-API-MENU-004 空库省略 important 时默认创建重要的 manual 页面', async ({ api }) => {
  await test.step('S1：重置页面库并检查初始化响应', async () => {
    const reset = await api.reset();
    expect(reset.status, '[E6] reset 返回 200').toBe(200);
    expect(reset.body.ok, '[E6] reset.ok=true').toBe(true);
  });

  const T = await test.step('S2：同步空上下文并保存 syncedAt', async () => {
    const sync = await api.seed({ activeTab: null, openTabs: [], history: [] });
    expect(sync.status, '[E6] sync 返回 200').toBe(200);
    expect(sync.body, '[E6] 空库初始化成功且有 0 页').toMatchObject({ ok: true, pageCount: 0 });
    expect(sync.body.syncedAt, '[E6] syncedAt 为毫秒时间戳').toEqual(expect.any(Number));
    return sync.body.syncedAt;
  });

  await test.step('S3：只提交 URL，省略 title 和 important', async () => {
    const response = await api.post('/api/pages/important', { url: URL });
    expect(response.status, '[E1] important 返回 200').toBe(200);
    expect(response.body, '[E1] 默认标记为重要并创建页面').toMatchObject({
      accepted: true, rejected: 0, isImportant: true, created: true,
    });
    expect(response.body.url, '[E2] 响应 url 等于提交 URL').toBe(URL);
    expect(response.body.normalizedUrl, '[E2] 响应 normalizedUrl 等于提交 URL').toBe(URL);
  });

  await test.step('S4：读回唯一页面、重要分数及健康计数', async () => {
    const ranked = await api.get('/api/pages/ranked', { params: { now: T } });
    expect(ranked.status, '[E3] ranked 返回 200').toBe(200);
    expect(ranked.body.total, '[E3] ranked.total=1').toBe(1);
    expect(ranked.body.pages, '[E3] 唯一页面已入库').toHaveLength(1);
    const page = ranked.body.pages[0];
    expect(page, '[E3] 唯一页面 URL 正确且已标重要').toMatchObject({ normalizedUrl: URL, isImportant: true });
    expect(page.sources, '[E3] 新页面含 manual 来源').toContain('manual');
    expect(page.scoreDetail, '[E4] 重要标记提供域名分 1').toMatchObject({ domain: 1, domainSource: 'important' });
    expect(page.reason, '[E4] 排序理由包含重要标记说明').toContain('已被你标记为重要');
    const health = await api.get('/api/health');
    expect(health.status, '[E5] health 返回 200').toBe(200);
    expect(health.body.pageCount, '[E5] health.pageCount=1').toBe(1);
  });
});
