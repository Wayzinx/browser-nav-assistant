import { test, expect } from '../fixtures/api.mjs';

test('TC-API-PRIV-016 删除 cookie 规则后关键词移除，cookie URL 可以入库', async ({ api }) => {
  await test.step('S1：POST /api/__test__/reset', () => api.reset());

  const ruleId = await test.step('S2：POST /api/rules 保存 cookie 规则并取得正式 ID', async () => {
    const r = await api.post('/api/rules', {
      rules: [{
        rawText: '不要上传包含 cookie 的 URL', type: 'privacy_filter',
        keywords: ['cookie'], action: 'exclude_upload',
      }],
    });
    expect(r.status, '[E1] 保存规则返回 201').toBe(201);
    expect(r.body.rules, '[E1] 返回本次保存的一条规则').toHaveLength(1);
    expect(r.body.rules[0].id, '[E1] 正式规则 ID 为非空字符串').toMatch(/\S/);
    return r.body.rules[0].id;
  });

  await test.step('S3：DELETE /api/rules/ 加上保存响应中的正式 ID', async () => {
    const r = await api.del(`/api/rules/${encodeURIComponent(ruleId)}`);
    expect(r.status, '[E2] 删除规则返回 200').toBe(200);
    expect(r.body.deleted, '[E2] 删除的是 S2 返回的规则 ID').toBe(ruleId);
    expect(r.body.ruleCount, '[E2] 删除后规则数为零').toBe(0);
  });

  await test.step('S4：GET /api/config 核对 cookie 关键词已移除', async () => {
    const r = await api.get('/api/config');
    expect(r.status, '[E3] 配置查询返回 200').toBe(200);
    expect(r.body.privacySensitiveKeywords, '[E3] 有效关键词严格恢复默认四项，不含 cookie').toStrictEqual(['password', 'token', 'bank', 'secret']);
  });

  await test.step('S5：POST /api/sync 提交 cookie URL', async () => {
    const r = await api.post('/api/sync', {
      history: [{
        url: 'https://example.com/?cookie=1', title: 't',
        lastVisitTime: Date.now() - 60 * 60 * 1000, visitCount: 1,
      }],
    });
    expect(r.status, '[E4] 删除规则后的同步返回 200').toBe(200);
    expect(r.body, '[E4] cookie URL 不再被拒收，创建一页').toMatchObject({ rejected: 0, created: 1 });
  });
});
