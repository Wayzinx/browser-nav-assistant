import { test, expect } from '../fixtures/api.mjs';

test('TC-API-PRIV-005 无效 URL 和隐私拒收分别计数，不影响同批普通记录', async ({ api }) => {
  await test.step('S1：POST /api/__test__/reset', () => api.reset());

  await test.step('S2：POST /api/sync 提交无效、敏感和普通 URL', async () => {
    const lastVisitTime = Date.now() - 60 * 60 * 1000;
    const r = await api.post('/api/sync', {
      history: [
        { url: 'javascript:alert(1)', title: 'invalid', lastVisitTime, visitCount: 1 },
        { url: 'https://example.com/reset?token=abc', title: 'private', lastVisitTime, visitCount: 1 },
        { url: 'https://example.com/fine', title: 'normal', lastVisitTime, visitCount: 1 },
      ],
    });
    expect(r.status, '[E1] 单条坏记录不使整个请求失败').toBe(200);
    expect(r.body, '[E1] 三条记录拒收两条并创建一页').toMatchObject({ received: 3, rejected: 2, created: 1 });
    expect(r.body.rejectedByReason, '[E2] 无效 URL 和隐私拒收各一条').toStrictEqual({ invalid_url: 1, privacy: 1 });
  });

  await test.step('S3：GET /api/health', async () => {
    const r = await api.get('/api/health');
    expect(r.status, '[E3] 健康检查返回 200').toBe(200);
    expect(r.body.pageCount, '[E3] 同批普通记录成功入库').toBe(1);
  });
});
