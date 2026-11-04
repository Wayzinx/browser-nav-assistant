import { test, expect, samplePayload } from '../fixtures/api.mjs';

const ISSUE = 'https://github.com/org/repo/issues/100';

test('TC-API-CLEAN-024 撤销归档后重新参与排序和整理建议', async ({ api }) => {
  const now = Date.now();
  await test.step('S1：同步平移后的样例', () => api.seed(samplePayload({ now })));
  await test.step('S2：归档 issues/100', async () => {
    const r = await api.post('/api/pages/archive', { urls: [ISSUE] });
    expect(r.status, '[E1] 返回 200').toBe(200);
    expect(r.body.affected, '[E1] 归档一页').toBe(1);
  });
  await test.step('S3：撤销 issues/100 的归档', async () => {
    const r = await api.post('/api/pages/unarchive', { urls: [ISSUE] });
    expect(r.status, '[E2] 撤销返回 200').toBe(200);
    expect(r.body, '[E2] 恰好恢复一页').toMatchObject({ ok: true, affected: 1, notFound: 0 });
  });
  await test.step('S4：读取恢复后的排序结果', async () => {
    const r = await api.get('/api/pages/ranked', { params: { limit: 500 } });
    expect(r.status, '[E3] 返回 200').toBe(200);
    expect(r.body.pages.map(p => p.url), '[E3] issues/100 重新出现').toContain(ISSUE);
    expect(r.body.total, '[E3] 未归档页数恢复到十').toBe(10);
  });
  await test.step('S5：读取恢复后的整理建议', async () => {
    const r = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
    expect(r.status, '[E4] 返回 200').toBe(200);
    expect(r.body.suggestions.find(s => s.action === 'archive' && s.url === ISSUE), '[E4] 旧 issue 恢复为 24 天归档候选').toMatchObject({ ageDays: 24 });
    expect(r.body.summary.archive, '[E4] 归档建议恢复为两条').toBe(2);
  });
});
