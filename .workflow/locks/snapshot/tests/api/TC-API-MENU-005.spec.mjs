import { test, expect } from '../fixtures/api.mjs';

const DOC = 'https://docs.internal.com/ai-agent-design';

test.use({ autoReset: false });

test('TC-API-MENU-005 取消重要标记后恢复亲和域名分并移除重要理由', async ({ api }) => {
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

  await test.step('S3：先标记重要并读回中间状态', async () => {
    const response = await api.post('/api/pages/important', { url: DOC, important: true });
    expect(response.status, '[E1] 首次 important 返回 200').toBe(200);
    expect(response.body.isImportant, '[E1] 首次响应已标记重要').toBe(true);
    const ranked = await api.get('/api/pages/ranked', { params: { now: T } });
    expect(ranked.status, '[E1] 中间 ranked 返回 200').toBe(200);
    const docs = ranked.body.pages.filter((page) => page.normalizedUrl === DOC);
    expect(docs, '[E1] 中间状态文档恰好一条').toHaveLength(1);
    expect(docs[0].scoreDetail.domainSource, '[E1] 中间域名分来源为 important').toBe('important');
    expect(docs[0].reason, '[E1] 中间理由包含重要标记说明').toContain('已被你标记为重要');
  });

  await test.step('S4：显式取消重要标记', async () => {
    const response = await api.post('/api/pages/important', { url: DOC, important: false });
    expect(response.status, '[E2] 取消 important 返回 200').toBe(200);
    expect(response.body, '[E2] 接收取消操作且未新建页面').toMatchObject({
      accepted: true, rejected: 0, created: false, isImportant: false,
    });
  });

  await test.step('S5：读回亲和域名分、排序理由及页面计数', async () => {
    const ranked = await api.get('/api/pages/ranked', { params: { now: T } });
    expect(ranked.status, '[E3] 最终 ranked 返回 200').toBe(200);
    const docs = ranked.body.pages.filter((page) => page.normalizedUrl === DOC);
    expect(docs, '[E3] 最终文档恰好一条').toHaveLength(1);
    expect(docs[0], '[E3] 取消后恢复 affinity 域名分 0.10').toMatchObject({
      isImportant: false, scoreDetail: { domain: 0.10, domainSource: 'affinity' },
    });
    expect(docs[0].reason, '[E4] 最终排序理由仍为字符串').toEqual(expect.any(String));
    expect(docs[0].reason, '[E4] 最终理由移除重要标记说明').not.toContain('已被你标记为重要');
    expect(ranked.body.total, '[E5] ranked.total=10').toBe(10);
    expect(ranked.body.pages, '[E5] 读回完整十页').toHaveLength(10);
    const health = await api.get('/api/health');
    expect(health.status, '[E5] health 返回 200').toBe(200);
    expect(health.body.pageCount, '[E5] health.pageCount=10').toBe(10);
  });
});
