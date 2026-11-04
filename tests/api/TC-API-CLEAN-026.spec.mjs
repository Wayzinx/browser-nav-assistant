import { test, expect, samplePayload } from '../fixtures/api.mjs';

const ISSUE = 'https://github.com/org/repo/issues/100';
const MISSING = 'https://example.com/not-exist';

test('TC-API-CLEAN-026 归档和撤销的非法输入返回错误且没有副作用', async ({ api }) => {
  const now = Date.now();
  await test.step('S1：同步平移后的样例', () => api.seed(samplePayload({ now })));
  await test.step('S2：归档 urls 为空数组', async () => {
    const r = await api.post('/api/pages/archive', { urls: [] });
    expect(r.status, '[E1] 空数组返回 400').toBe(400);
    expect(r.body.error.code, '[E1] 错误码为 VALIDATION_FAILED').toBe('VALIDATION_FAILED');
    expect(r.body.error.details.fields, '[E1] 标记 urls 字段').toContain('urls');
    expect(r.body.error.message, '[E1] 错误说明非空').toMatch(/\S/);
  });
  await test.step('S3：归档 urls 为字符串', async () => {
    const r = await api.post('/api/pages/archive', { urls: ISSUE });
    expect(r.status, '[E1] 非数组返回 400').toBe(400);
    expect(r.body.error.code, '[E1] 错误码为 VALIDATION_FAILED').toBe('VALIDATION_FAILED');
    expect(r.body.error.details.fields, '[E1] 标记 urls 字段').toContain('urls');
    expect(r.body.error.message, '[E1] 错误说明非空').toMatch(/\S/);
  });
  await test.step('S4：归档不存在的 URL', async () => {
    const r = await api.post('/api/pages/archive', { urls: [MISSING] });
    expect(r.status, '[E2] 全部不存在返回 404').toBe(404);
    expect(r.body.error.code, '[E2] 错误码为 NOT_FOUND').toBe('NOT_FOUND');
    expect(r.body.error.message, '[E2] 错误说明非空').toMatch(/\S/);
  });
  await test.step('S5：撤销不存在的 URL 的归档', async () => {
    const r = await api.post('/api/pages/unarchive', { urls: [MISSING] });
    expect(r.status, '[E2] 不存在的页面返回 404').toBe(404);
    expect(r.body.error.code, '[E2] 错误码为 NOT_FOUND').toBe('NOT_FOUND');
    expect(r.body.error.message, '[E2] 错误说明非空').toMatch(/\S/);
  });
  await test.step('S6：回读整理建议和排序结果', async () => {
    const cleanup = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
    const ranked = await api.get('/api/pages/ranked', { params: { limit: 500 } });
    expect(cleanup.status, '[E3] 整理建议返回 200').toBe(200);
    expect(ranked.status, '[E3] 排序返回 200').toBe(200);
    expect(cleanup.body.summary, '[E3] 整理建议不变').toEqual({ archive: 2, merge: 1, keep: 0 });
    expect(ranked.body.total, '[E3] 仍有十个未归档页面').toBe(10);
  });
});
