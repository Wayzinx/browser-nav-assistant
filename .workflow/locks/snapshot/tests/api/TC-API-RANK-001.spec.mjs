// 用例：TC-API-RANK-001（docs/trace/cases-api.json）；F-RANK-01 AC1；接口 GET /api/pages/ranked
// 期望顺序与分数取自 PRD 13.3；读请求统一带 ?now=T 固定时间。
import { test, expect, samplePayload, shiftedTime } from '../fixtures/api.mjs';

const ISSUE = 'https://github.com/org/repo/issues/123';
const PR = 'https://github.com/org/repo/pull/456';
const FETCH = 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API';
const GOOGLE = 'https://www.google.com/search?q=chrome+extension+manifest+v3';
const ORDER = [
  ISSUE, PR, FETCH,
  'https://react.dev/reference/react/useState',
  'https://github.com/org/repo/issues/123?tab=comments',
  'https://github.com/org/repo/actions',
  'https://react.dev/learn',
  'https://docs.internal.com/ai-agent-design',
  'https://github.com/org/repo/issues/100',
  GOOGLE,
];
const SCORES = [1, 0.94, 0.83, 0.69, 0.68, 0.68, 0.57, 0.56, 0.23, 0.11];

test('TC-API-RANK-001 导入样例后 ranked 返回 10 条、按 score 降序且字段完整', async ({ api }) => {
  const T = Date.now();

  const syncedAt = await test.step('S1：POST /api/sync 导入平移后的样例，记录 syncedAt', async () => {
    const r = await api.seed(samplePayload({ now: T }));
    return r.body.syncedAt;
  });

  const r = await test.step('S2：GET /api/pages/ranked?now=T', () => api.get('/api/pages/ranked', { params: { now: T } }));

  expect(r.status, '[E1] ranked 返回 200').toBe(200);
  expect(r.body.total, '[E1] total=10').toBe(10);
  expect(r.body.pages, '[E1] pages 共 10 条').toHaveLength(10);
  expect(r.body.generatedAt, '[E1] generatedAt 等于 ?now=T').toBe(T);

  const pages = r.body.pages;
  expect(pages.map((p) => p.url), '[E2] url 顺序与 PRD 13.3 一致（同分按 lastVisitedAt 倒序）').toEqual(ORDER);

  const scores = pages.map((p) => p.score);
  expect(scores, '[E3] score 依次为 PRD 13.3 的值').toEqual(SCORES);
  expect(scores, '[E3] 整体非严格降序').toEqual([...scores].sort((a, b) => b - a));

  for (const p of pages) {
    expect(Object.keys(p), `[E4] ${p.url} 含全部必需字段`).toEqual(expect.arrayContaining(
      ['url', 'title', 'domain', 'visitCount', 'lastVisitedAt', 'score', 'reason', 'isOpen', 'sources', 'scoreDetail']));
    expect(typeof p.reason, `[E4] ${p.url} reason 为字符串`).toBe('string');
    expect(p.reason.trim().length, `[E4] ${p.url} reason 非空`).toBeGreaterThan(0);
    expect(typeof p.isOpen, `[E4] ${p.url} isOpen 为布尔`).toBe('boolean');
    expect(Array.isArray(p.sources), `[E4] ${p.url} sources 为数组`).toBe(true);
    expect(Object.keys(p.scoreDetail), `[E4] ${p.url} scoreDetail 含五个字段`).toEqual(expect.arrayContaining(
      ['recency', 'frequency', 'open', 'domain', 'domainSource']));
  }

  const byUrl = Object.fromEntries(pages.map((p) => [p.url, p]));
  expect(byUrl[ISSUE], '[E5] issues/123 visitCount=8 且打开中').toMatchObject({ visitCount: 8, isOpen: true });
  expect(byUrl[ISSUE].sources, '[E5] issues/123 来源含 open_tab 与 history').toEqual(expect.arrayContaining(['open_tab', 'history']));
  expect(byUrl[PR], '[E5] pull/456 为活动页、打开中、visitCount=5').toMatchObject({ isActive: true, isOpen: true, visitCount: 5 });
  expect(byUrl[PR].sources, '[E5] pull/456 来源含 active_tab').toContain('active_tab');
  expect(byUrl[PR].lastVisitedAt, '[E5] pull/456 lastVisitedAt 等于 S1 的 syncedAt').toBe(syncedAt);
  expect(byUrl[GOOGLE], '[E5] Google 搜索页未打开、visitCount=1').toMatchObject({ isOpen: false, visitCount: 1 });

  expect(byUrl[ISSUE].lastVisitedAt, '[E6] issues/123 lastVisitedAt 等于平移后的时间').toBe(shiftedTime(ISSUE, T));
  expect(byUrl[ISSUE].domain, '[E6] issues/123 domain=github.com').toBe('github.com');
  expect(byUrl[FETCH].domain, '[E6] Fetch_API domain=developer.mozilla.org').toBe('developer.mozilla.org');
});
