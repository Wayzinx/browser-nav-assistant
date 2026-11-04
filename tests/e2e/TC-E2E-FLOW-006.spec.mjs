// 用例来源：docs/trace/cases-api.json；后端 mode/cursor 兼容语义，不覆盖插件增量采集。
import { test, expect, samplePayload } from '../fixtures/api.mjs';

const PR = 'https://github.com/org/repo/pull/456';
const ISSUE = 'https://github.com/org/repo/issues/123';
const FETCH = 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API';
const INTERNAL = 'https://docs.internal.com/ai-agent-design';
const NEW_URL = 'https://example.com/incremental-new';
const OLD_ISSUE = 'https://github.com/org/repo/issues/100';
const GOOGLE = 'https://www.google.com/search?q=chrome+extension+manifest+v3';

test('TC-E2E-FLOW-006 增量游标取前次同步时间，窗口重放保持页面及打开快照', async ({ api, evidence }) => {
  const T = Date.now();
  const payload = { ...samplePayload({ now: T }), mode: 'full' };

  const baseline = await test.step('S1：全量同步样例并读取十页基线', async () => {
    const full = await api.post('/api/sync', payload);
    expect(full.status, '[E1] full 同步返回 200').toBe(200);
    expect(full.body, '[E1] full 模式计数正确').toMatchObject({ mode: 'full', received: 14, created: 10, updated: 4, pageCount: 10 });
    const ranked = await api.get('/api/pages/ranked', { params: { now: T } });
    expect(ranked.status, '[E1] 基线排序返回 200').toBe(200);
    expect(ranked.body.total, '[E1] 基线 total=10').toBe(10);
    expect(ranked.body.pages, '[E1] 基线有十页').toHaveLength(10);
    for (const p of ranked.body.pages) {
      expect(Object.keys(p), `[E1] ${p.url} 必需字段完整`).toEqual(expect.arrayContaining(
        ['id', 'url', 'title', 'domain', 'visitCount', 'lastVisitedAt', 'score', 'reason', 'isOpen', 'sources', 'scoreDetail']));
    }
    const scores = ranked.body.pages.map(p => p.score);
    expect(scores, '[E1] 基线分数非递增').toEqual([...scores].sort((a, b) => b - a));
    return { full: full.body, rank0: ranked.body };
  });

  const firstIncrement = await test.step('S2：用 full.syncedAt 作游标，上传重叠历史、新页和完整打开快照', async () => {
    const issue = baseline.rank0.pages.find(p => p.url === ISSUE);
    const requestBody = {
      mode: 'incremental', cursor: baseline.full.syncedAt, activeTab: null,
      openTabs: [ISSUE, FETCH].map(url => {
        const p = baseline.rank0.pages.find(page => page.url === url);
        return { url: p.url, title: p.title };
      }),
      history: [
        { url: issue.url, title: issue.title, lastVisitTime: payload.history.find(h => h.url === issue.url).lastVisitTime, visitCount: 8 },
        { url: NEW_URL, title: 'Incremental new', lastVisitTime: baseline.full.syncedAt, visitCount: 2 },
      ],
    };
    // api 夹具留存实际请求体，游标直接消费上一批响应，不在测试中另造时间。
    const r = await api.post('/api/sync', requestBody);
    expect(r.status, '[E2] 首批增量返回 200').toBe(200);
    expect(r.body, '[E2] 两条打开页和两条历史共四条，新增一页、更新三条').toMatchObject({ mode: 'incremental', received: 4, created: 1, updated: 3, rejected: 0, pageCount: 11 });
    evidence.note(`S2 增量 cursor 直接使用 full.syncedAt=${baseline.full.syncedAt}`);
    return { inc1: r.body, requestBody };
  });

  const replay = await test.step('S3：检查增量结果，再用 inc1.syncedAt 重放同一窗口', async () => {
    const ranked = await api.get('/api/pages/ranked', { params: { now: firstIncrement.inc1.syncedAt } });
    expect(ranked.status, '[E3] 首批增量后的排序返回 200').toBe(200);
    expect(ranked.body.total, '[E3] 首批增量后 total=11').toBe(11);
    expect(ranked.body.pages, '[E3] 首批增量保留全部十一页').toHaveLength(11);
    const originalUrls = new Set(baseline.rank0.pages.map(p => p.url));
    expect(ranked.body.pages.filter(p => originalUrls.has(p.url)).map(p => p.id).sort(), '[E3] 原十页 id 完整保留').toEqual(baseline.rank0.pages.map(p => p.id).sort());
    expect(ranked.body.pages.filter(p => !originalUrls.has(p.url)).map(p => p.url), '[E3] 新增 URL 只有 incremental-new').toEqual([NEW_URL]);
    expect(ranked.body.pages.find(p => p.url === ISSUE)?.visitCount, '[E3] 重叠 issue 的访问次数仍为八').toBe(8);
    expect(ranked.body.pages.find(p => p.url === NEW_URL), '[E3] 新页时间消费 full.syncedAt，访问次数为二').toMatchObject({ visitCount: 2, lastVisitedAt: baseline.full.syncedAt });
    const byUrl = Object.fromEntries(ranked.body.pages.map(p => [p.url, p]));
    expect(byUrl[INTERNAL].isOpen, '[E4] 内部文档已关闭').toBe(false);
    expect(byUrl[PR].isOpen, '[E4] 原活动 PR 已关闭').toBe(false);
    expect(byUrl[ISSUE].isOpen, '[E4] issue 仍打开').toBe(true);
    expect(byUrl[FETCH].isOpen, '[E4] Fetch API 仍打开').toBe(true);
    expect(ranked.body.pages.filter(p => p.isOpen).map(p => p.url).sort(), '[E4] 打开集合严格等于 S2 完整快照').toEqual(firstIncrement.requestBody.openTabs.map(p => p.url).sort());
    const r = await api.post('/api/sync', { ...firstIncrement.requestBody, cursor: firstIncrement.inc1.syncedAt });
    expect(r.status, '[E5] 窗口重放返回 200').toBe(200);
    expect(r.body, '[E5] 重放四条均为更新且无新增页').toMatchObject({ mode: 'incremental', received: 4, created: 0, updated: 4, pageCount: 11 });
    evidence.note(`S3 重放 cursor 直接使用 inc1.syncedAt=${firstIncrement.inc1.syncedAt}`);
    return { rank1: ranked.body, inc2: r.body };
  });

  await test.step('S4：最终排序、整理及健康信息共同读取最后一批增量状态', async () => {
    const ranked = await api.get('/api/pages/ranked', { params: { now: replay.inc2.syncedAt } });
    expect(ranked.status, '[E6] 最终排序返回 200').toBe(200);
    expect(ranked.body.total, '[E6] 最终 total=11').toBe(11);
    const identityAndVisits = pages => pages.map(({ id, url, visitCount }) => ({ id, url, visitCount }));
    expect(identityAndVisits(ranked.body.pages), '[E6] 重放前后逐页 id、URL 和访问次数相等').toEqual(identityAndVisits(replay.rank1.pages));
    expect(ranked.body.pages.filter(p => p.isOpen).map(p => p.url).sort(), '[E6] 重放保持完整两页打开快照').toEqual(firstIncrement.requestBody.openTabs.map(p => p.url).sort());
    const clean = await api.get('/api/pages/cleanup-suggestions', { params: { now: replay.inc2.syncedAt } });
    expect(clean.status, '[E6] 最终整理建议返回 200').toBe(200);
    const archiveUrls = clean.body.suggestions.filter(s => s.action === 'archive').map(s => s.url);
    expect(archiveUrls, '[E6] 增量新页不被归档').not.toContain(NEW_URL);
    expect(archiveUrls, '[E6] 未出现在增量窗口的旧页面仍保留归档建议').toEqual(expect.arrayContaining([GOOGLE, OLD_ISSUE]));
    const health = await api.get('/api/health');
    expect(health.status, '[E7] 健康检查返回 200').toBe(200);
    expect(health.body.pageCount, '[E7] 健康页数为十一').toBe(11);
    expect(health.body, '[E7] 健康状态对应最后一批增量响应').toMatchObject({ pageCount: replay.inc2.pageCount, lastSyncAt: replay.inc2.syncedAt });
  });
});
