import { test, expect } from '../fixtures/api.mjs';

const KEYWORDS = ['password', 'token', 'bank', 'secret', 'session'];

test('TC-API-PRIV-009 PUT 新增 session 关键词后查询一致且同步被过滤', async ({ api }) => {
  await test.step('S1：POST /api/__test__/reset', () => api.reset());

  await test.step('S2：PUT /api/config 设置含 session 的五个关键词', async () => {
    const r = await api.put('/api/config', { privacySensitiveKeywords: KEYWORDS });
    expect(r.status, '[E1] 更新配置返回 200').toBe(200);
    expect(r.body.privacySensitiveKeywords, '[E1] 有效关键词包含 session').toContain('session');
    expect(r.body.cleanupThresholdDays, '[E1] 未修改的清理阈值仍为默认 14').toBe(14);
  });

  await test.step('S3：GET /api/config 读取已保存配置', async () => {
    const r = await api.get('/api/config');
    expect(r.status, '[E2] 配置查询返回 200').toBe(200);
    expect(r.body.baseSensitiveKeywords, '[E2] 基础关键词严格等于提交的五项').toStrictEqual(KEYWORDS);
    expect(r.body.privacySensitiveKeywords, '[E2] 查询的有效关键词包含 session').toContain('session');
  });

  await test.step('S4：POST /api/sync 提交 session URL', async () => {
    const r = await api.post('/api/sync', {
      history: [{
        url: 'https://example.com/?session=1', title: 't',
        lastVisitTime: Date.now() - 60 * 60 * 1000, visitCount: 1,
      }],
    });
    expect(r.status, '[E3] 同步返回 200').toBe(200);
    expect(r.body, '[E3] 新配置已生效，session URL 被拒收且不入库').toMatchObject({
      rejected: 1, rejectedByReason: { privacy: 1 }, created: 0,
    });
  });
});
