import { test, expect } from '../fixtures/api.mjs';

const NOTE = 'https://example.com/note';
const ACTIVE = 'https://github.com/org/repo/pull/456';
const OPEN = [
  ACTIVE,
  'https://github.com/org/repo/issues/123',
  'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API',
  'https://docs.internal.com/ai-agent-design',
].sort();
const openSnapshot = (pages) => pages.map(({ normalizedUrl, isOpen, isActive }) =>
  ({ normalizedUrl, isOpen, isActive })).sort((a, b) => a.normalizedUrl.localeCompare(b.normalizedUrl));

// 每条用例显式重置并检查响应，避免夹具额外执行一次未断言的 reset。
test.use({ autoReset: false });

test('TC-API-MENU-001 新增手动分析页面并保留已有打开快照', async ({ api }) => {
  await test.step('S1：重置页面库并检查初始化响应', async () => {
    const reset = await api.reset();
    expect(reset.status, '[E7] reset 返回 200').toBe(200);
    expect(reset.body.ok, '[E7] reset.ok=true').toBe(true);
  });

  const T = await test.step('S2：导入平移后的样例并保存 syncedAt', async () => {
    const { res } = await api.loadSample();
    expect(res.status, '[E7] sync 返回 200').toBe(200);
    expect(res.body, '[E7] 样例初始化成功且有 10 页').toMatchObject({ ok: true, pageCount: 10 });
    expect(res.body.syncedAt, '[E7] syncedAt 为毫秒时间戳').toEqual(expect.any(Number));
    return res.body.syncedAt;
  });

  const before = await test.step('S3：保存原有十页的打开状态', async () => {
    const ranked = await api.get('/api/pages/ranked', { params: { now: T } });
    expect(ranked.status, '[E5] 初始 ranked 返回 200').toBe(200);
    expect(ranked.body.total, '[E5] 初始页面总数为 10').toBe(10);
    expect(ranked.body.pages, '[E5] 保存完整十页快照').toHaveLength(10);
    return openSnapshot(ranked.body.pages);
  });

  await test.step('S4：手动添加 Note 页面', async () => {
    const response = await api.post('/api/pages/manual', { url: NOTE, title: 'Note' });
    expect(response.status, '[E1] manual 返回 200').toBe(200);
    expect(response.body, '[E2] 接收并新建一页，页面数为 11').toMatchObject({
      accepted: true, rejected: 0, created: true, pageCount: 11,
    });
  });

  await test.step('S5：读回新增页面、原有快照及健康计数', async () => {
    const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: T } });
    expect(ranked.status, '[E3] 最终 ranked 返回 200').toBe(200);
    expect(ranked.body.total, '[E3] 最终 total=11').toBe(11);
    expect(ranked.body.pages, '[E3] 返回完整 11 页').toHaveLength(11);
    const added = ranked.body.pages.filter((page) => page.normalizedUrl === NOTE);
    expect(added, '[E3] Note 恰好一条').toHaveLength(1);
    expect(added[0].title, '[E3] 新页面标题为 Note').toBe('Note');
    expect(added[0].sources, '[E4] 新页面含 manual 来源').toContain('manual');
    expect(added[0], '[E4] 新页面没有打开或激活').toMatchObject({ isOpen: false, isActive: false });
    const originalPages = ranked.body.pages.filter((page) => page.normalizedUrl !== NOTE);
    expect(openSnapshot(originalPages), '[E5] 原有十页的打开与激活状态逐页不变').toStrictEqual(before);
    const openUrls = ranked.body.pages.filter((page) => page.isOpen).map((page) => page.url).sort();
    expect(openUrls, '[E5] 打开的集合恰为四个样例 URL').toStrictEqual(OPEN);
    const activeUrls = ranked.body.pages.filter((page) => page.isActive).map((page) => page.url);
    expect(activeUrls, '[E5] 仅 pull/456 激活').toStrictEqual([ACTIVE]);
    const health = await api.get('/api/health');
    expect(health.status, '[E6] health 返回 200').toBe(200);
    expect(health.body.pageCount, '[E6] health.pageCount=11').toBe(11);
  });
});
