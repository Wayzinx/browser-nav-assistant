// 用例来源：docs/trace/cases-api.json；历史幂等及完整打开快照跨排序、整理和推荐生效。
import { test, expect, samplePayload, DAY } from '../fixtures/api.mjs';

const PR = 'https://github.com/org/repo/pull/456';
const ISSUE = 'https://github.com/org/repo/issues/123';
const FETCH = 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API';
const INTERNAL = 'https://docs.internal.com/ai-agent-design';
const OLD_OPEN = 'https://example.com/open';
const OLD_ISSUE = 'https://github.com/org/repo/issues/100';
const GOOGLE = 'https://www.google.com/search?q=chrome+extension+manifest+v3';
const visits = pages => pages.map(({ id, url, visitCount }) => ({ id, url, visitCount })).sort((a, b) => a.url.localeCompare(b.url));
// D-07：忽略协议、www、尾斜杠和非语义参数，保留固定顺序的语义参数。
const duplicateKey = url => {
  const parsed = new URL(url);
  const semanticQuery = new URLSearchParams();
  for (const key of ['q', 'query', 'wd', 'keyword', 'search', 'v', 'id']) {
    for (const value of parsed.searchParams.getAll(key)) semanticQuery.append(key, value);
  }
  const query = semanticQuery.toString();
  return `${parsed.host.replace(/^www\./, '')}${parsed.pathname.replace(/\/+$/, '') || '/'}${query ? `?${query}` : ''}`;
};

test('TC-E2E-FLOW-004 重放不累加访问次数，关闭快照联动排序、整理和推荐', async ({ api }) => {
  const T = Date.now();
  const payload = samplePayload({ now: T });

  const rank0 = await test.step('S1：同步样例并保存原始页面状态', async () => {
    const sync = await api.post('/api/sync', payload);
    expect(sync.status, '[E1] 首次同步返回 200').toBe(200);
    expect(sync.body, '[E1] 首次同步计数正确').toMatchObject({ received: 14, created: 10, updated: 4, pageCount: 10 });
    const ranked = await api.get('/api/pages/ranked', { params: { now: T } });
    expect(ranked.status, '[E1] 基线排序返回 200').toBe(200);
    expect(ranked.body.total, '[E1] total=10').toBe(10);
    expect(ranked.body.pages, '[E1] 排序返回十页').toHaveLength(10);
    for (const p of ranked.body.pages) {
      expect(Object.keys(p), `[E1] ${p.url} 字段完整`).toEqual(expect.arrayContaining(
        ['id', 'url', 'title', 'domain', 'visitCount', 'lastVisitedAt', 'score', 'reason', 'isOpen', 'sources', 'scoreDetail']));
    }
    const scores = ranked.body.pages.map(p => p.score);
    expect(scores, '[E1] 分数非递增').toEqual([...scores].sort((a, b) => b - a));
    return ranked.body;
  });

  const rankReplay = await test.step('S2：原样重放样例，检查访问次数并消费返回页面请求推荐', async () => {
    const sync = await api.post('/api/sync', payload);
    expect(sync.status, '[E2] 重放同步返回 200').toBe(200);
    expect(sync.body, '[E2] 重放没有新增页面').toMatchObject({ created: 0, pageCount: 10 });
    const ranked = await api.get('/api/pages/ranked', { params: { now: T } });
    expect(ranked.status, '[E2] 重放后的排序返回 200').toBe(200);
    expect(ranked.body.pages.find(p => p.url === ISSUE)?.visitCount, '[E2] issue 仍为八次访问').toBe(8);
    expect(visits(ranked.body.pages), '[E2] 每个既有页面的 id、URL 和访问次数保持一致').toEqual(visits(rank0.pages));
    const current = ranked.body.pages.find(p => p.url === PR);
    expect(current, '[E3] 当前页来自重放后的排序').toMatchObject({ url: PR });
    const rec = await api.post('/api/recommendations/next', {
      currentPage: { url: current.url, title: current.title },
      openTabs: ranked.body.pages.filter(p => p.isOpen && p.url !== current.url).map(p => ({ url: p.url, title: p.title })),
      recentHistory: [],
    }, { params: { now: T } });
    expect(rec.status, '[E3] 重放后的推荐返回 200').toBe(200);
    expect(rec.body.recommendations[0], '[E3] Actions 首位且上下文关联重放后的 PR').toMatchObject({ url: 'https://github.com/org/repo/actions', strategy: 'same_repo', score: 0.87, contextUrl: current.url });
    expect(rec.body.recommendations[0].reason, '[E3] 推荐理由包含 PR').toContain('PR');
    expect(rec.body.recommendations[0].reason, '[E3] 推荐理由包含 CI').toContain('CI');
    return ranked.body;
  });

  const third = await test.step('S3：替换为两页打开快照，追加未打开的二十天旧页面', async () => {
    const openTabs = [ISSUE, FETCH].map(url => {
      const p = rankReplay.pages.find(page => page.url === url);
      return { url: p.url, title: p.title };
    });
    const oldHistory = { url: OLD_OPEN, title: 'Old open', lastVisitTime: T - 20 * DAY, visitCount: 1 };
    const requestBody = { activeTab: null, openTabs, history: [...payload.history, oldHistory] };
    const sync = await api.post('/api/sync', requestBody);
    expect(sync.status, '[E4] 第三次同步返回 200').toBe(200);
    expect(sync.body, '[E4] 只增加一页，总页数十一').toMatchObject({ created: 1, pageCount: 11 });
    return { sync3: sync.body, requestBody, oldHistory };
  });

  const rank3 = await test.step('S4：比较页面身份、打开状态及整理建议', async () => {
    const ranked = await api.get('/api/pages/ranked', { params: { now: T } });
    expect(ranked.status, '[E4] 第三次同步后的排序返回 200').toBe(200);
    expect(ranked.body.total, '[E4] 排序 total=11').toBe(11);
    expect(ranked.body.pages, '[E4] 返回全部十一页').toHaveLength(11);
    expect(ranked.body.pages.filter(p => p.url !== third.oldHistory.url).map(p => p.id).sort(), '[E4] 原十页 id 集合保持一致').toEqual(rankReplay.pages.map(p => p.id).sort());
    expect(ranked.body.pages.find(p => p.url === ISSUE)?.visitCount, '[E4] 第三次同步仍未累加 issue 访问数').toBe(8);
    const byUrl = Object.fromEntries(ranked.body.pages.map(p => [p.url, p]));
    expect(byUrl[INTERNAL].isOpen, '[E5] 内部文档已关闭').toBe(false);
    expect(byUrl[PR].isOpen, '[E5] PR 已关闭').toBe(false);
    expect(byUrl[ISSUE].isOpen, '[E5] issue 仍打开').toBe(true);
    expect(byUrl[FETCH].isOpen, '[E5] Fetch API 仍打开').toBe(true);
    expect(ranked.body.pages.filter(p => p.isOpen).map(p => p.url).sort(), '[E5] 打开集合严格等于第三次完整快照').toEqual(third.requestBody.openTabs.map(p => p.url).sort());
    const before = rankReplay.pages.find(p => p.url === INTERNAL);
    expect(before.score - byUrl[INTERNAL].score, '[E6] 关闭使内部文档分数减少 0.20').toBeCloseTo(0.20, 10);
    expect(byUrl[INTERNAL].scoreDetail.open, '[E6] 关闭后打开分为零').toBe(0);
    expect(Math.floor((T - byUrl[INTERNAL].lastVisitedAt) / DAY), '[E6] 内部文档未达到十五个整天').toBeLessThan(15);
    const clean = await api.get('/api/pages/cleanup-suggestions', { params: { now: T } });
    expect(clean.status, '[E6] 整理建议返回 200').toBe(200);
    const archived = clean.body.suggestions.filter(s => s.action === 'archive');
    expect(archived.map(s => s.url), '[E6] 内部文档关闭但不满足归档天数').not.toContain(INTERNAL);
    expect(byUrl[OLD_OPEN], '[E7] 新增页确实来自第三次请求，且未打开').toMatchObject({ url: third.oldHistory.url, title: third.oldHistory.title, lastVisitedAt: third.oldHistory.lastVisitTime, isOpen: false });
    expect(archived.find(s => s.url === byUrl[OLD_OPEN].url), '[E7] 新增旧页面进入二十天归档建议').toMatchObject({ action: 'archive', ageDays: 20 });
    expect(archived.map(s => s.url), '[E7] 原先两条旧页面仍建议归档').toEqual(expect.arrayContaining([GOOGLE, OLD_ISSUE]));
    return ranked.body;
  });

  await test.step('S5：新快照驱动推荐过滤，健康信息读回最后一次同步', async () => {
    const current = rank3.pages.find(p => p.url === PR);
    const tabs = rank3.pages.filter(p => p.isOpen);
    const rec = await api.post('/api/recommendations/next', {
      currentPage: { url: current.url, title: current.title },
      openTabs: tabs.map(p => ({ url: p.url, title: p.title })), recentHistory: [],
    }, { params: { now: T } });
    expect(rec.status, '[E8] 新快照推荐返回 200').toBe(200);
    expect(rec.body.recommendations[0], '[E8] 首条仍为同仓库 Actions，关联 rank3 的 PR').toMatchObject({ url: 'https://github.com/org/repo/actions', strategy: 'same_repo', contextUrl: current.url });
    expect(rec.body.recommendations.map(p => p.url), '[E7] 新增的待归档旧页不被推荐').not.toContain(third.oldHistory.url);
    const keys = rec.body.recommendations.map(p => duplicateKey(p.url));
    for (const tab of tabs) {
      expect(keys, `[E8] 不推荐新快照打开页及其 query/hash 变体 ${tab.url}`).not.toContain(duplicateKey(tab.url));
    }
    const health = await api.get('/api/health');
    expect(health.status, '[E8] 健康检查返回 200').toBe(200);
    expect(health.body.pageCount, '[E8] 健康页数等于十一').toBe(11);
    expect(health.body, '[E8] 健康信息对应第三次同步').toMatchObject({ pageCount: third.sync3.pageCount, lastSyncAt: third.sync3.syncedAt });
  });
});
