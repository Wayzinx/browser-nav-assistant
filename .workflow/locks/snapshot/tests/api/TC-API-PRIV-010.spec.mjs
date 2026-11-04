import { test, expect } from '../fixtures/api.mjs';

test('TC-API-PRIV-010 关键词整体替换并转小写去重，session 拦截且 token 放行', async ({ api }) => {
  await test.step('S1：POST /api/__test__/reset', () => api.reset());

  await test.step('S2：PUT /api/config 提交大小写重复的关键词', async () => {
    const r = await api.put('/api/config', { privacySensitiveKeywords: ['Session', 'SESSION', 'password'] });
    expect(r.status, '[E1] 更新配置返回 200').toBe(200);
    expect(r.body.baseSensitiveKeywords, '[E1] 更新响应已完成小写化和去重').toStrictEqual(['session', 'password']);
  });

  await test.step('S3：GET /api/config 核对整体替换后的关键词', async () => {
    const r = await api.get('/api/config');
    expect(r.status, '[E2] 配置查询返回 200').toBe(200);
    expect(r.body.baseSensitiveKeywords, '[E2] 基础关键词严格为 session 和 password').toStrictEqual(['session', 'password']);
  });

  await test.step('S4：POST /api/sync 对照混合大小写 session 和已移除的 token', async () => {
    const lastVisitTime = Date.now() - 60 * 60 * 1000;
    const r = await api.post('/api/sync', {
      history: [
        { url: 'https://example.com/?SeSsIoN=1', title: 'session', lastVisitTime, visitCount: 1 },
        { url: 'https://example.com/?token=1', title: 'removed keyword', lastVisitTime, visitCount: 1 },
      ],
    });
    expect(r.status, '[E3] 同步返回 200').toBe(200);
    expect(r.body, '[E3] 拒收一条，创建一条，页面总数为一').toMatchObject({
      rejected: 1, rejectedByReason: { privacy: 1 }, created: 1, pageCount: 1,
    });
    const ranked = await api.get('/api/pages/ranked');
    expect(ranked.status, '[E3] 排序接口返回 200').toBe(200);
    expect(ranked.body.pages.map((page) => page.url), '[E3] 仅移除关键词的 token URL 入库，混合大小写 session URL 被拒收').toStrictEqual(['https://example.com/?token=1']);
  });
});
