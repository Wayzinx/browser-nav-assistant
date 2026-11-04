import { test, expect, samplePayload } from '../fixtures/api.mjs';

test('TC-API-CLEAN-003 非法 now 返回统一错误且无副作用', async ({ api }) => {
  const now = Date.now();
  await test.step('S1：POST /api/sync 导入平移后的样例', () => api.seed(samplePayload({ now })));
  await test.step('S2：依次请求非数字、零、负数和小数 now', async () => {
    for (const invalidNow of ['abc', '0', '-5', '1.5']) {
      const r = await api.get('/api/pages/cleanup-suggestions', { params: { now: invalidNow } });
      expect(r.status, `[E1] now=${invalidNow} 返回 400`).toBe(400);
      expect(r.body.error.code, '[E1] 错误码为 VALIDATION_FAILED').toBe('VALIDATION_FAILED');
      expect(r.body.error.message, '[E1] 错误说明为非空字符串').toMatch(/\S/);
      expect(r.body.error.details.fields, '[E2] 标记 now 字段').toContain('now');
    }
  });
  await test.step('S3：使用合法 now 再次请求整理建议', async () => {
    const r = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
    expect(r.status, '[E3] 合法请求返回 200').toBe(200);
    expect(r.body.summary, '[E3] 非法请求没有改变建议').toEqual({ archive: 2, merge: 1, keep: 0 });
  });
  await test.step('S4：GET /api/health 核对页面数', async () => {
    const r = await api.get('/api/health');
    expect(r.status, '[E4] 健康检查返回 200').toBe(200);
    expect(r.body.pageCount, '[E4] 仍有 10 个页面').toBe(10);
  });
});
