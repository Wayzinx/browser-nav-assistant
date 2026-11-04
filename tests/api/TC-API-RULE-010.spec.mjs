import { test, expect } from '../fixtures/api.mjs';

// features: F-RULE-04
// codePoints: C-BE-RULE-01

test("TC-API-RULE-010 分号把两条规则拆开并保留各自子句原文", async ({ api }) => {
  await test.step('S1：通过真实 HTTP 重置本例状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });

  const r = await test.step('S2：解析分号连接的两条规则', () => api.post('/api/rules/parse', { text: '7 天没访问的 issue 归档；github.com 永远不要归档' }));
  expect(r.status, '[E2] 解析返回 200').toBe(200);
  expect(r.body.rules, '[E2] 分成两条规则').toHaveLength(2);
  expect(r.body.rules[0], '[E3] 第一条保留独立子句与天数').toMatchObject({ rawText: '7 天没访问的 issue 归档', type: 'archive_candidate', urlPattern: '/issues/', inactiveDays: 7 });
  expect(r.body.rules[1], '[E4] 第二条保留独立否定子句').toMatchObject({ rawText: 'github.com 永远不要归档', type: 'never_archive', domain: 'github.com', action: 'keep' });
  expect(r.body.unparsed, '[E5] 没有遗失子句').toEqual([]);
});
