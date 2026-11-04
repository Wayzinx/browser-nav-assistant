import { test, expect, samplePayload } from '../fixtures/api.mjs';

const KEEP = 'https://github.com/org/repo/issues/123';
const COMMENTS = `${KEEP}?tab=comments`;

test('TC-API-CLEAN-027 非法合并被拒绝且重复组仍完整', async ({ api }) => {
  const now = Date.now();
  await test.step('S1：同步平移后的样例', () => api.seed(samplePayload({ now })));
  await test.step('S2：keepUrl 不属于 urls', async () => {
    const r = await api.post('/api/pages/merge', { urls: [KEEP, COMMENTS], keepUrl: 'https://github.com/org/repo/issues/999' });
    expect(r.status, '[E1] 返回 400').toBe(400);
    expect(r.body.error.code, '[E1] 错误码为 VALIDATION_FAILED').toBe('VALIDATION_FAILED');
    expect(r.body.error.message, '[E1] 错误说明非空').toMatch(/\S/);
  });
  await test.step('S3：urls 少于两条', async () => {
    const r = await api.post('/api/pages/merge', { urls: [KEEP], keepUrl: KEEP });
    expect(r.status, '[E1] 返回 400').toBe(400);
    expect(r.body.error.code, '[E1] 错误码为 VALIDATION_FAILED').toBe('VALIDATION_FAILED');
    expect(r.body.error.message, '[E1] 错误说明非空').toMatch(/\S/);
  });
  await test.step('S4：keepUrl 属于组但页面不存在', async () => {
    const r = await api.post('/api/pages/merge', { urls: ['https://example.com/x', 'https://example.com/x?tab=1'], keepUrl: 'https://example.com/x' });
    expect(r.status, '[E2] 返回 404').toBe(404);
    expect(r.body.error.code, '[E2] 错误码为 NOT_FOUND').toBe('NOT_FOUND');
    expect(r.body.error.message, '[E2] 错误说明非空').toMatch(/\S/);
  });
  await test.step('S5：回读排序结果确认没有页面被归档', async () => {
    const r = await api.get('/api/pages/ranked', { params: { limit: 500 } });
    expect(r.status, '[E3] 返回 200').toBe(200);
    expect(r.body.pages.map(p => p.url), '[E3] 原重复组的两个页面都仍存在').toEqual(expect.arrayContaining([KEEP, COMMENTS]));
    expect(r.body.total, '[E3] 页面总数仍为十').toBe(10);
  });
});
