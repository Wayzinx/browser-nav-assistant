import { test, expect } from '../fixtures/api.mjs';

test('TC-API-PRIV-006 关闭过滤后接收敏感 URL，重新开启后再次拒收', async ({ api }) => {
  await test.step('S1：POST /api/__test__/reset', () => api.reset());

  await test.step('S2：PUT /api/config 关闭隐私过滤', async () => {
    const r = await api.put('/api/config', { enablePrivacyFilter: false });
    expect(r.status, '[E1] 修改配置返回 200').toBe(200);
    expect(r.body.enablePrivacyFilter, '[E1] 隐私过滤已关闭').toBe(false);
  });

  await test.step('S3：POST /api/sync 提交含 token 的历史', async () => {
    const r = await api.post('/api/sync', {
      history: [{
        url: 'https://example.com/reset?token=abc', title: 't',
        lastVisitTime: Date.now() - 60 * 60 * 1000, visitCount: 1,
      }],
    });
    expect(r.status, '[E2] 关闭过滤后的同步返回 200').toBe(200);
    expect(r.body, '[E2] 敏感记录被接收并创建页面').toMatchObject({
      rejected: 0, created: 1, rejectedByReason: { privacy: 0 },
    });
  });

  await test.step('S4：PUT /api/config 重新开启隐私过滤', async () => {
    const r = await api.put('/api/config', { enablePrivacyFilter: true });
    expect(r.status, '[E3] 修改配置返回 200').toBe(200);
    expect(r.body.enablePrivacyFilter, '[E3] 隐私过滤已重新开启').toBe(true);
  });

  await test.step('S5：POST /api/sync 提交新的 password URL', async () => {
    const r = await api.post('/api/sync', {
      history: [{
        url: 'https://example.com/?password=1', title: 't',
        lastVisitTime: Date.now() - 60 * 60 * 1000, visitCount: 1,
      }],
    });
    expect(r.status, '[E4] 重新开启后的同步返回 200').toBe(200);
    expect(r.body, '[E4] 新敏感记录再次被拒收且不创建页面').toMatchObject({
      rejected: 1, rejectedByReason: { privacy: 1 }, created: 0,
    });
  });

  await test.step('S6：GET /api/health', async () => {
    const r = await api.get('/api/health');
    expect(r.status, '[E5] 健康检查返回 200').toBe(200);
    expect(r.body.pageCount, '[E5] 页面数仍为关闭过滤时创建的一页').toBe(1);
  });
});
