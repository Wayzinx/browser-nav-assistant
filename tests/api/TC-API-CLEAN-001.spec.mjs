import { test, expect, samplePayload } from '../fixtures/api.mjs';

test('TC-API-CLEAN-001 样例整理建议的汇总、顺序和字段完整', async ({ api }) => {
  const now = Date.now();
  await test.step('S1：POST /api/sync 导入平移后的样例', async () => {
    const r = await api.post('/api/sync', samplePayload({ now }));
    expect(r.status, '[E1] 同步返回 200').toBe(200);
    expect(r.body, '[E1] 新建并保存 10 个页面').toMatchObject({ created: 10, pageCount: 10 });
  });

  await test.step('S2：GET /api/pages/cleanup-suggestions 固定时间读取建议', async () => {
    const r = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
    expect(r.status, '[E2] 整理建议返回 200').toBe(200);
    expect(r.body.summary, '[E2] 样例汇总为 2/1/0').toEqual({ archive: 2, merge: 1, keep: 0 });
    expect(r.body.suggestions, '[E2] 共 3 条建议').toHaveLength(3);
    expect(r.body.suggestions.map(s => s.action), '[E3] 先归档后合并').toEqual(['archive', 'archive', 'merge']);
    const archives = r.body.suggestions.filter(s => s.action === 'archive');
    expect(archives.map(s => s.ageDays), '[E3] 归档按未访问天数降序').toEqual([35, 24]);
    for (const item of archives) {
      expect(item, '[E4] 归档项具备契约字段且无规则').toMatchObject({
        key: expect.stringMatching(/^archive:/), url: expect.any(String), title: expect.any(String),
        reason: expect.stringMatching(/\S/), ageDays: expect.any(Number),
        lastVisitedAt: expect.any(Number), ruleId: null,
      });
      expect(Number.isInteger(item.ageDays), '[E4] ageDays 为整数').toBe(true);
    }
    const merge = r.body.suggestions.find(s => s.action === 'merge');
    expect(merge, '[E5] 合并项具备契约字段').toMatchObject({
      key: expect.stringMatching(/^merge:/), urls: expect.any(Array), titles: expect.any(Array),
      keepUrl: expect.any(String), reason: expect.stringMatching(/\S/),
    });
    expect(merge.urls, '[E5] 合并组包含两个 URL').toHaveLength(2);
    expect(merge.titles, '[E5] 合并组包含两个标题').toHaveLength(2);
    expect(r.body.thresholdDays, '[E6] 默认阈值 14 天').toBe(14);
    expect(r.body.generatedAt, '[E6] 使用指定时间生成建议').toBe(now);
  });
});
