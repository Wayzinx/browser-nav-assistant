import { test, expect } from '../fixtures/api.mjs';

test('TC-API-PRIV-008 cookie 规则生效后同步 cookie URL 被拒收且不入库', async ({ api }) => {
  await test.step('S1：POST /api/__test__/reset', () => api.reset());

  await test.step('S2：POST /api/rules 保存 cookie 规则', async () => {
    const r = await api.post('/api/rules', {
      rules: [{
        rawText: '不要上传包含 cookie 的 URL', type: 'privacy_filter',
        keywords: ['cookie'], action: 'exclude_upload',
      }],
    });
    expect(r.status, '[E1] 保存规则返回 201').toBe(201);
    expect(r.body.ruleCount, '[E1] 保存后规则数为一').toBe(1);
  });

  await test.step('S3：POST /api/sync 提交 cookie URL', async () => {
    const r = await api.post('/api/sync', {
      history: [{
        url: 'https://example.com/?cookie=1', title: 't',
        lastVisitTime: Date.now() - 60 * 60 * 1000, visitCount: 1,
      }],
    });
    expect(r.status, '[E2] 同步返回 200').toBe(200);
    expect(r.body, '[E2] cookie URL 因隐私规则被拒收且不创建页面').toMatchObject({
      rejected: 1, rejectedByReason: { privacy: 1 }, created: 0,
    });
  });

  await test.step('S4：GET /api/pages/ranked', async () => {
    const r = await api.get('/api/pages/ranked');
    expect(r.status, '[E3] 排序接口返回 200').toBe(200);
    expect(r.body.total, '[E3] 排序总数为零').toBe(0);
    expect(r.body.pages, '[E3] 结果为空，不包含 cookie URL').toStrictEqual([]);
  });

  await test.step('S5：GET /api/health', async () => {
    const r = await api.get('/api/health');
    expect(r.status, '[E4] 健康检查返回 200').toBe(200);
    expect(r.body.pageCount, '[E4] 页面数仍为零').toBe(0);
  });
});
