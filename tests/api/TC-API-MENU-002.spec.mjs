import { test, expect } from '../fixtures/api.mjs';

const DOC = 'https://docs.internal.com/ai-agent-design';
const VARIANT = 'https://DOCS.INTERNAL.com/ai-agent-design/?utm_source=menu#mark';

test.use({ autoReset: false });

test('TC-API-MENU-002 规范化重复手动添加复用页面身份并合并来源', async ({ api }) => {
  await test.step('S1：重置页面库并检查初始化响应', async () => {
    const reset = await api.reset();
    expect(reset.status, '[E6] reset 返回 200').toBe(200);
    expect(reset.body.ok, '[E6] reset.ok=true').toBe(true);
  });

  const T = await test.step('S2：导入平移后的样例并保存 syncedAt', async () => {
    const { res } = await api.loadSample();
    expect(res.status, '[E6] sync 返回 200').toBe(200);
    expect(res.body, '[E6] 样例初始化成功且有 10 页').toMatchObject({ ok: true, pageCount: 10 });
    expect(res.body.syncedAt, '[E6] syncedAt 为毫秒时间戳').toEqual(expect.any(Number));
    return res.body.syncedAt;
  });

  const originalId = await test.step('S3：保存文档页面的后端 ID 和打开状态', async () => {
    const ranked = await api.get('/api/pages/ranked', { params: { now: T } });
    expect(ranked.status, '[E2] 初始 ranked 返回 200').toBe(200);
    const docs = ranked.body.pages.filter((page) => page.normalizedUrl === DOC);
    expect(docs, '[E2] 初始文档页面恰好一条').toHaveLength(1);
    expect(docs[0].id, '[E2] 保存后端返回的非空 ID').toMatch(/\S/);
    expect(docs[0], '[E4] 初始文档打开但未激活').toMatchObject({ isOpen: true, isActive: false });
    return docs[0].id;
  });

  await test.step('S4：添加含大写域名、尾斜杠、跟踪参数和 hash 的 URL', async () => {
    const response = await api.post('/api/pages/manual', { url: VARIANT, title: 'Menu note' });
    expect(response.status, '[E1] 首次 manual 返回 200').toBe(200);
    expect(response.body, '[E1] 首次添加复用已有页面且仍为 10 页').toMatchObject({
      accepted: true, rejected: 0, created: false, pageCount: 10,
    });
  });

  await test.step('S5：再次添加规范 URL', async () => {
    const response = await api.post('/api/pages/manual', { url: DOC, title: 'Menu note' });
    expect(response.status, '[E1] 再次 manual 返回 200').toBe(200);
    expect(response.body, '[E1] 再次添加仍复用已有页面').toMatchObject({
      accepted: true, rejected: 0, created: false, pageCount: 10,
    });
  });

  await test.step('S6：读回唯一页面、合并来源、打开状态及计数', async () => {
    const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: T } });
    expect(ranked.status, '[E2] 最终 ranked 返回 200').toBe(200);
    const docs = ranked.body.pages.filter((page) => page.normalizedUrl === DOC);
    expect(docs, '[E2] 规范化后的文档恰好一条').toHaveLength(1);
    expect(docs[0].id, '[E2] 页面 ID 保持不变').toBe(originalId);
    expect(docs[0].sources, '[E3] 合并 open_tab、history 与 manual 来源').toEqual(
      expect.arrayContaining(['open_tab', 'history', 'manual']));
    expect(docs[0].sources.filter((source) => source === 'manual'), '[E3] manual 来源只出现一次').toHaveLength(1);
    expect(docs[0], '[E4] 标题更新，文档仍打开但未激活').toMatchObject({
      title: 'Menu note', isOpen: true, isActive: false,
    });
    expect(ranked.body.pages.filter((page) => page.isOpen), '[E4] 全库仍有四个打开页面').toHaveLength(4);
    expect(ranked.body.total, '[E5] ranked.total=10').toBe(10);
    expect(ranked.body.pages, '[E5] 读回完整十页').toHaveLength(10);
    const health = await api.get('/api/health');
    expect(health.status, '[E5] health 返回 200').toBe(200);
    expect(health.body.pageCount, '[E5] health.pageCount=10').toBe(10);
  });
});
