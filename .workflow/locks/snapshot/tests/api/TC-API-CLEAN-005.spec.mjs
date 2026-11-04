import { test, expect, samplePayload, shiftedTime } from '../fixtures/api.mjs';

const GOOGLE = 'https://www.google.com/search?q=chrome+extension+manifest+v3';
const ISSUE = 'https://github.com/org/repo/issues/100';
const DOC = 'https://docs.internal.com/ai-agent-design';

test('TC-API-CLEAN-005 默认归档阈值和样例理由精确匹配', async ({ api }) => {
  const now = Date.now();
  await test.step('S1：POST /api/sync 导入平移后的样例', () => api.seed(samplePayload({ now })));
  await test.step('S2：GET /api/pages/cleanup-suggestions 核对归档项', async () => {
    const r = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
    expect(r.status, '[E1] 整理建议返回 200').toBe(200);
    const archives = r.body.suggestions.filter(s => s.action === 'archive');
    expect(archives.map(s => s.url).sort(), '[E1] 恰好归档 Google 和旧 issue').toEqual([GOOGLE, ISSUE].sort());
    expect(archives.find(s => s.url === GOOGLE), '[E2] Google 为 35 天且时间正确').toMatchObject({
      ageDays: 35, reason: '超过 14 天未访问（已 35 天），且不在当前打开的 tab 中',
      lastVisitedAt: shiftedTime(GOOGLE, now),
    });
    expect(archives.find(s => s.url === ISSUE), '[E3] 旧 issue 为 24 天且时间正确').toMatchObject({
      ageDays: 24, reason: '超过 14 天未访问（已 24 天），且不在当前打开的 tab 中',
      lastVisitedAt: shiftedTime(ISSUE, now),
    });
    expect(archives.map(s => s.ruleId), '[E4] 默认判定不引用规则').toEqual([null, null]);
    expect(archives.map(s => s.url), '[E4] 打开中的文档不归档').not.toContain(DOC);
  });
});
