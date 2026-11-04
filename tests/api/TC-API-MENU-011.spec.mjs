import { test, expect } from '../fixtures/api.mjs';

const DOC = 'https://docs.internal.com/ai-agent-design';

test.use({ autoReset: false });

test('TC-API-MENU-011 重复标记 true 保持页面 ID 且不新增重复记录', async ({ api }) => {
  await test.step('S1：重置页面库并检查初始化响应', async () => {
    const reset = await api.reset();
    expect(reset.status, '[E5] reset 返回 200').toBe(200);
    expect(reset.body.ok, '[E5] reset.ok=true').toBe(true);
  });

  const T = await test.step('S2：导入平移后的样例并保存 syncedAt', async () => {
    const { res } = await api.loadSample();
    expect(res.status, '[E5] sync 返回 200').toBe(200);
    expect(res.body, '[E5] 样例初始化成功且有 10 页').toMatchObject({ ok: true, pageCount: 10 });
    expect(res.body.syncedAt, '[E5] syncedAt 为毫秒时间戳').toEqual(expect.any(Number));
    return res.body.syncedAt;
  });

  const originalId = await test.step('S3：保存文档页面的后端生成 ID', async () => {
    const ranked = await api.get('/api/pages/ranked', { params: { now: T } });
    expect(ranked.status, '[E2] 初始 ranked 返回 200').toBe(200);
    const docs = ranked.body.pages.filter((page) => page.normalizedUrl === DOC);
    expect(docs, '[E2] 初始目标页面恰好一条').toHaveLength(1);
    expect(docs[0].id, '[E2] 保存后端返回的非空 ID').toMatch(/\S/);
    return docs[0].id;
  });

  await test.step('S4：连续两次对同一文档标记 important=true', async () => {
    for (const attempt of [1, 2]) {
      const response = await api.post('/api/pages/important', { url: DOC, important: true });
      expect(response.status, `[E1] 第 ${attempt} 次 important 返回 200`).toBe(200);
      expect(response.body, `[E1] 第 ${attempt} 次均接收、复用原页面并保持重要`).toMatchObject({
        accepted: true, rejected: 0, created: false, isImportant: true,
      });
    }
  });

  await test.step('S5：读回唯一页面、重要状态和健康计数', async () => {
    const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: T } });
    expect(ranked.status, '[E2] 最终 ranked 返回 200').toBe(200);
    const docs = ranked.body.pages.filter((page) => page.normalizedUrl === DOC);
    expect(docs, '[E2] 重复标记后仍只有一个目标页面').toHaveLength(1);
    expect(docs[0].id, '[E2] 页面 ID 等于首次读回的 ID').toBe(originalId);
    expect(docs[0], '[E3] 页面保持重要，域名分为 1 且来源为 important').toMatchObject({
      isImportant: true, scoreDetail: { domain: 1, domainSource: 'important' },
    });
    expect(docs[0].reason, '[E3] 理由包含重要标记说明').toContain('已被你标记为重要');
    expect(ranked.body.total, '[E4] ranked.total=10').toBe(10);
    expect(ranked.body.pages, '[E4] 读回完整十页').toHaveLength(10);
    const health = await api.get('/api/health');
    expect(health.status, '[E4] health 返回 200').toBe(200);
    expect(health.body.pageCount, '[E4] health.pageCount=10').toBe(10);
  });
});
