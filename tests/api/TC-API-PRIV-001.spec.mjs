import { test, expect } from '../fixtures/api.mjs';

test('TC-API-PRIV-001 直接同步含 token 的历史被拒收且不入库', async ({ api }) => {
  await test.step('S1：POST /api/__test__/reset', () => api.reset());

  await test.step('S2：POST /api/sync 提交一条含 token 的历史', async () => {
    const r = await api.post('/api/sync', {
      history: [{
        url: 'https://example.com/reset?token=abc',
        title: 't',
        lastVisitTime: Date.now() - 60 * 60 * 1000,
        visitCount: 1,
      }],
    });
    expect(r.status, '[E1] 同步返回 200').toBe(200);
    expect(r.body, '[E1] 收到一条，拒收一条，没有创建或更新').toMatchObject({
      ok: true, received: 1, rejected: 1, created: 0, updated: 0,
    });
    expect(r.body.rejectedByReason, '[E2] 拒收原因仅为隐私').toStrictEqual({ invalid_url: 0, privacy: 1 });
    expect(r.body.pageCount, '[E2] 没有页面入库').toBe(0);
    expect(JSON.stringify(r.body), '[E3] 响应不回显敏感 URL').not.toContain('reset?token=abc');
  });

  await test.step('S3：GET /api/pages/ranked', async () => {
    const r = await api.get('/api/pages/ranked');
    expect(r.status, '[E4] 排序接口返回 200').toBe(200);
    expect(r.body.total, '[E4] 排序总数为零').toBe(0);
    expect(r.body.pages, '[E4] 排序结果为空，不包含敏感 URL').toStrictEqual([]);
  });

  await test.step('S4：GET /api/health', async () => {
    const r = await api.get('/api/health');
    expect(r.status, '[E5] 健康检查返回 200').toBe(200);
    expect(r.body.pageCount, '[E5] 页面总数仍为零').toBe(0);
  });
});
