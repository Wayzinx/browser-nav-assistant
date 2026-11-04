// 用例来源：docs/trace/cases-api.json；同步 → 排序响应 → 推荐 → 健康信息。
import { test, expect, samplePayload } from '../fixtures/api.mjs';

const PR = 'https://github.com/org/repo/pull/456';
const ISSUE = 'https://github.com/org/repo/issues/123';
const FETCH = 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API';
const ACTIONS = 'https://github.com/org/repo/actions';
const OLD_ISSUE = 'https://github.com/org/repo/issues/100';
const GOOGLE = 'https://www.google.com/search?q=chrome+extension+manifest+v3';

test('TC-E2E-FLOW-001 排序返回的页面驱动推荐，同步时间贯通健康信息', async ({ api }) => {
  const T = Date.now();
  const payload = samplePayload({ now: T });

  const sync1 = await test.step('S1：通过真实同步接口导入平移样例', async () => {
    const r = await api.post('/api/sync', payload);
    expect(r.status, '[E1] 同步返回 200').toBe(200);
    expect(r.body, '[E1] 样例同步计数完整').toMatchObject({ ok: true, received: 14, created: 10, updated: 4, rejected: 0, pageCount: 10 });
    expect(Number.isInteger(r.body.syncedAt), '[E1] syncedAt 为整数').toBe(true);
    expect(r.body.syncedAt, '[E1] syncedAt 为正数').toBeGreaterThan(0);
    return r.body;
  });

  const context = await test.step('S2：读取完整排序和前三条，从排序响应提取当前页及打开页', async () => {
    const r = await api.get('/api/pages/ranked', { params: { limit: 20, now: T } });
    expect(r.status, '[E2] 排序返回 200').toBe(200);
    expect(r.body.total, '[E2] total 与同步页数一致').toBe(sync1.pageCount);
    expect(r.body.total, '[E2] total 为 10').toBe(10);
    expect(r.body.pages, '[E2] 完整排序有 10 页').toHaveLength(10);
    expect(r.body.generatedAt, '[E2] 排序使用固定时间 T').toBe(T);
    for (const p of r.body.pages) {
      expect(Object.keys(p), `[E2] ${p.url} 页面字段完整`).toEqual(expect.arrayContaining(
        ['id', 'url', 'title', 'domain', 'visitCount', 'lastVisitedAt', 'score', 'reason', 'isOpen', 'sources', 'scoreDetail']));
    }
    const scores = r.body.pages.map(p => p.score);
    expect(scores, '[E2] 分数依次非递增').toEqual([...scores].sort((a, b) => b - a));

    const current = r.body.pages.find(p => p.url === PR);
    expect(current, '[E2] 排序响应包含当前 PR 页').toMatchObject({ url: PR, isOpen: true });
    const tabs = r.body.pages.filter(p => p.isOpen && p.url !== current.url);
    expect(tabs, '[E2] 另外三个打开页面来自本次排序响应').toHaveLength(3);
    const top3 = await api.get('/api/pages/ranked', { params: { limit: 3, now: T } });
    expect(top3.status, '[E3] 截断排序返回 200').toBe(200);
    expect(top3.body.total, '[E3] 截断前 total 仍为 10').toBe(10);
    expect(top3.body.pages, '[E3] limit=3 只返回三页').toHaveLength(3);
    expect(top3.body.pages.map(p => ({ id: p.id, url: p.url })), '[E3] 截断保留完整排序的前三条及其 id').toEqual(
      r.body.pages.slice(0, 3).map(p => ({ id: p.id, url: p.url })));
    expect(top3.body.pages.map(p => p.url), '[E3] 前三条的 URL 顺序确定').toEqual([ISSUE, PR, FETCH]);

    const issue = r.body.pages.find(p => p.url === ISSUE);
    expect(issue.lastVisitedAt, '[E4] issue 时间取自实际上传的历史').toBe(payload.history.find(h => h.url === issue.url).lastVisitTime);
    expect(current.lastVisitedAt, '[E4] 当前页时间等于同步响应时间').toBe(sync1.syncedAt);
    expect(current.sources, '[E5] PR 来源包含活动页及历史').toEqual(expect.arrayContaining(['active_tab', 'history']));
    expect(issue.sources, '[E5] issue 来源包含打开页及历史').toEqual(expect.arrayContaining(['open_tab', 'history']));
    const learn = r.body.pages.find(p => p.url === 'https://react.dev/learn');
    expect([...new Set(learn.sources)].sort(), '[E5] React learn 的来源集合仅有 history').toEqual(['history']);
    return { current, tabs, pages: r.body.pages };
  });

  await test.step('S3：将排序返回的当前页、打开页和访问时间传给推荐', async () => {
    const r = await api.post('/api/recommendations/next', {
      currentPage: { url: context.current.url, title: context.current.title },
      openTabs: context.tabs.map(p => ({ url: p.url, title: p.title })),
      recentHistory: context.pages.map(p => ({ url: p.url, title: p.title, lastVisitTime: p.lastVisitedAt })),
    }, { params: { now: T } });
    expect(r.status, '[E6] 推荐返回 200').toBe(200);
    const recs = r.body.recommendations;
    expect(recs.length, '[E6] 至少推荐一条').toBeGreaterThanOrEqual(1);
    expect(recs.length, '[E6] 最多推荐五条').toBeLessThanOrEqual(5);
    expect(recs[0], '[E6] 首位 Actions 来自同仓库策略且关联传入的当前页').toMatchObject({ url: ACTIONS, strategy: 'same_repo', score: 0.87, contextUrl: context.current.url });
    expect(recs[0].reason, '[E6] 首位理由提到 PR').toContain('PR');
    expect(recs[0].reason, '[E6] 首位理由提到 CI').toContain('CI');
    const urls = recs.map(p => p.url);
    for (const url of [context.current.url, ...context.tabs.map(p => p.url), `${ISSUE}?tab=comments`, OLD_ISSUE, GOOGLE]) {
      expect(urls, `[E7] 不推荐已打开、重复或待归档页面 ${url}`).not.toContain(url);
    }
    for (const rec of recs) {
      expect(rec.score, `[E7] ${rec.url} 达到推荐分数下限`).toBeGreaterThanOrEqual(0.3);
      expect(rec.reason, `[E7] ${rec.url} 带非空理由`).toMatch(/\S/);
    }
  });

  await test.step('S4：健康信息读回本次同步状态', async () => {
    const r = await api.get('/api/health');
    expect(r.status, '[E8] 健康检查返回 200').toBe(200);
    expect(r.body, '[E8] 页数及同步时间与 S1 一致，规则库为空').toMatchObject({ status: 'ok', pageCount: sync1.pageCount, lastSyncAt: sync1.syncedAt, ruleCount: 0 });
  });
});
