import { test, expect } from '../fixtures/api.mjs';

test('TC-API-PRIV-012 空关键词列表不拦截 password，重置恢复默认关键词', async ({ api }) => {
  await test.step('S1：POST /api/__test__/reset', () => api.reset());

  await test.step('S2：PUT /api/config 清空关键词列表', async () => {
    const r = await api.put('/api/config', { privacySensitiveKeywords: [] });
    expect(r.status, '[E1] 空数组作为合法下限返回 200').toBe(200);
    expect(r.body.privacySensitiveKeywords, '[E1] 有效关键词严格为空数组').toStrictEqual([]);
  });

  await test.step('S3：POST /api/sync 提交含 password 的历史', async () => {
    const r = await api.post('/api/sync', {
      history: [{
        url: 'https://example.com/?password=1', title: 't',
        lastVisitTime: Date.now() - 60 * 60 * 1000, visitCount: 1,
      }],
    });
    expect(r.status, '[E2] 同步返回 200').toBe(200);
    expect(r.body, '[E2] 关键词为空时不拒收 password URL，并创建一页').toMatchObject({ rejected: 0, created: 1 });
  });

  await test.step('S4：POST /api/__test__/reset 恢复默认配置', async () => {
    const r = await api.post('/api/__test__/reset');
    expect(r.status, '[E3] 重置返回 200').toBe(200);
    expect(r.body.ok, '[E3] 重置成功').toBe(true);
  });

  await test.step('S5：GET /api/config 核对恢复的默认关键词', async () => {
    const r = await api.get('/api/config');
    expect(r.status, '[E4] 配置查询返回 200').toBe(200);
    expect(r.body.privacySensitiveKeywords, '[E4] 重置后严格恢复四个默认关键词').toStrictEqual(['password', 'token', 'bank', 'secret']);
  });
});
