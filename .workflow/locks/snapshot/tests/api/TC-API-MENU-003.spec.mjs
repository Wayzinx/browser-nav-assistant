import { test, expect } from '../fixtures/api.mjs';

const DOC = 'https://docs.internal.com/ai-agent-design';

test.use({ autoReset: false });

test('TC-API-MENU-003 显式标记文档重要并读回排序和保留理由', async ({ api }) => {
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

  await test.step('S3：核对文档初始重要状态和样例分数', async () => {
    const ranked = await api.get('/api/pages/ranked', { params: { now: T } });
    expect(ranked.status, '[E1] 初始 ranked 返回 200').toBe(200);
    const docs = ranked.body.pages.filter((page) => page.normalizedUrl === DOC);
    expect(docs, '[E1] 初始文档恰好一条').toHaveLength(1);
    expect(docs[0], '[E1] 文档未标重要，domain=0.10、score=0.56').toMatchObject({
      isImportant: false, scoreDetail: { domain: 0.10 }, score: 0.56,
    });
  });

  await test.step('S4：显式标记样例文档为重要', async () => {
    const response = await api.post('/api/pages/important', {
      url: DOC, title: 'AI Agent Design Guidelines', important: true,
    });
    expect(response.status, '[E2] important 返回 200').toBe(200);
    expect(response.body, '[E2] 已有文档成功标记重要').toMatchObject({
      accepted: true, rejected: 0, isImportant: true, created: false,
    });
  });

  await test.step('S5：读回重要状态、域名分和排序理由', async () => {
    const ranked = await api.get('/api/pages/ranked', { params: { now: T } });
    expect(ranked.status, '[E3] 操作后 ranked 返回 200').toBe(200);
    const docs = ranked.body.pages.filter((page) => page.normalizedUrl === DOC);
    expect(docs, '[E3] 操作后文档仍恰好一条').toHaveLength(1);
    expect(docs[0], '[E3] 重要状态和域名分来源生效').toMatchObject({
      isImportant: true, scoreDetail: { domain: 1, domainSource: 'important' },
    });
    expect(docs[0].reason, '[E4] 排序理由说明已标记重要').toContain('已被你标记为重要');
    expect(ranked.body.total, '[E6] ranked.total=10').toBe(10);
    expect(ranked.body.pages, '[E6] 读回完整十页').toHaveLength(10);
  });

  await test.step('S6：核对重要页面保留建议及健康计数', async () => {
    const cleanup = await api.get('/api/pages/cleanup-suggestions', { params: { now: T } });
    expect(cleanup.status, '[E5] cleanup 返回 200').toBe(200);
    const kept = cleanup.body.suggestions.filter((item) => item.url === DOC && item.action === 'keep');
    expect(kept, '[E5] 文档恰有一条 keep 建议').toHaveLength(1);
    expect(kept[0].reason, '[E5] 保留理由精确符合契约').toBe('你已标记为重要，不建议归档');
    const archived = cleanup.body.suggestions.filter((item) => item.url === DOC && item.action === 'archive');
    expect(archived, '[E5] 文档没有 archive 建议').toHaveLength(0);
    const health = await api.get('/api/health');
    expect(health.status, '[E6] health 返回 200').toBe(200);
    expect(health.body.pageCount, '[E6] health.pageCount=10').toBe(10);
  });
});
