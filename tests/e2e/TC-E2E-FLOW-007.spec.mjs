// 用例来源：docs/trace/cases-api.json；所有读时间均由同一条返回历史计算，避免真实时钟漂移。
import { test, expect, DAY, HOUR } from '../fixtures/api.mjs';

const OLD_URL = 'https://example.com/old';
const CONTEXT_URL = 'https://example.com/context';
const ARCHIVE_REASON = '超过 14 天未访问（已 15 天），且不在当前打开的 tab 中';

test('TC-E2E-FLOW-007 十五个整天的归档边界同时改变整理建议及推荐过滤', async ({ api }) => {
  const T = Date.now();
  const L = T - 16 * DAY;
  const payload = { activeTab: null, openTabs: [], history: [{ url: OLD_URL, title: '', visitCount: 8, lastVisitTime: L }] };

  const baseline = await test.step('S1：同步唯一旧页面，读回服务端 id、URL 和访问时间', async () => {
    const sync = await api.post('/api/sync', payload);
    expect(sync.status, '[E1] 同步返回 200').toBe(200);
    expect(sync.body, '[E1] 创建一页且无拒收').toMatchObject({ created: 1, rejected: 0, pageCount: 1 });
    const ranked = await api.get('/api/pages/ranked', { params: { now: T } });
    expect(ranked.status, '[E1] 排序返回 200').toBe(200);
    expect(ranked.body.total, '[E1] 排序 total=1').toBe(1);
    expect(ranked.body.pages, '[E1] 返回唯一旧页').toHaveLength(1);
    expect(ranked.body.pages[0], '[E1] 空标题降级为 URL，访问时间等于上传的 L').toMatchObject({ url: OLD_URL, title: OLD_URL, lastVisitedAt: L });
    expect(ranked.body.pages[0].id, '[E1] 服务端生成的页面 id 非空').toMatch(/\S/);
    return { sync1: sync.body, old: ranked.body.pages[0] };
  });

  const boundary = await test.step('S2：在同一页面的七个整数天边界时点查询整理建议', async () => {
    const beforeOffsets = [14 * DAY - 1, 14 * DAY, 14 * DAY + 1, 14 * DAY + 23 * HOUR, 15 * DAY - 1];
    const before = [];
    for (const offset of beforeOffsets) {
      const now = baseline.old.lastVisitedAt + offset;
      const r = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
      expect(r.status, `[E2] 边界前 offset=${offset} 返回 200`).toBe(200);
      expect(r.body.generatedAt, `[E2] 边界前 offset=${offset} 使用请求的 now`).toBe(now);
      expect(r.body.summary.archive, `[E2] 边界前 offset=${offset} 无归档`).toBe(0);
      expect(r.body.suggestions.filter(s => s.action === 'archive' && s.url === baseline.old.url), `[E2] 边界前 offset=${offset} 旧页不在归档集合`).toEqual([]);
      before.push({ now, response: r.body });
    }
    for (const offset of [15 * DAY, 15 * DAY + 1]) {
      const now = baseline.old.lastVisitedAt + offset;
      const r = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
      expect(r.status, `[E2] 边界后 offset=${offset} 返回 200`).toBe(200);
      expect(r.body.generatedAt, `[E2] 边界后 offset=${offset} 使用请求的 now`).toBe(now);
      expect(r.body.summary, `[E3] 边界后 offset=${offset} 只有一条归档`).toEqual({ archive: 1, merge: 0, keep: 0 });
      expect(r.body.suggestions, `[E3] 边界后 offset=${offset} 唯一建议为归档`).toHaveLength(1);
      expect(r.body.suggestions[0], `[E3] 边界后 offset=${offset} 归档同一旧页，时间与理由准确`).toMatchObject({
        action: 'archive', url: baseline.old.url, lastVisitedAt: baseline.old.lastVisitedAt, ageDays: 15, ruleId: null, reason: ARCHIVE_REASON,
      });
    }
    return { nowBefore: before[before.length - 1].now, beforeLast: before[before.length - 1].response };
  });

  const recommendationBody = await test.step('S3：十五天前一毫秒，同域名旧页仍可推荐', async () => {
    expect(boundary.beforeLast.suggestions.filter(s => s.action === 'archive' && s.url === baseline.old.url), '[E4] 本次推荐时间对应尚未归档的同一旧页').toEqual([]);
    const body = { currentPage: { url: CONTEXT_URL, title: 'Context' }, openTabs: [], recentHistory: [] };
    const r = await api.post('/api/recommendations/next', body, { params: { now: boundary.nowBefore } });
    expect(r.status, '[E4] 边界前推荐返回 200').toBe(200);
    expect(r.body.recommendations.map(p => p.url), '[E4] 推荐包含且仅包含同一旧页').toEqual([baseline.old.url]);
    expect(r.body.recommendations[0].contextUrl, '[E4] 推荐关联传入的同域上下文').toBe(CONTEXT_URL);
    expect(r.body.recommendations[0].score, '[E4] 旧页仍达到推荐分数下限').toBeGreaterThanOrEqual(0.3);
    return body;
  });

  await test.step('S4：恰好十五天排除推荐，十五天后一毫秒仍建议归档且页面未删除', async () => {
    const nowAt = baseline.old.lastVisitedAt + 15 * DAY;
    const rec = await api.post('/api/recommendations/next', recommendationBody, { params: { now: nowAt } });
    expect(rec.status, '[E5] 恰好十五天的推荐返回 200').toBe(200);
    expect(rec.body.recommendations, '[E5] 同一旧页因进入待归档集合而被排除').toEqual([]);
    const clean = await api.get('/api/pages/cleanup-suggestions', { params: { now: nowAt + 1 } });
    expect(clean.status, '[E5] 十五天后一毫秒整理返回 200').toBe(200);
    expect(clean.body.suggestions.filter(s => s.action === 'archive'), '[E5] 仍为同一条归档建议').toHaveLength(1);
    expect(clean.body.suggestions.find(s => s.action === 'archive'), '[E5] 同一旧页的整天数仍为十五').toMatchObject({ url: baseline.old.url, ageDays: 15 });
    const health = await api.get('/api/health');
    expect(health.status, '[E6] 健康检查返回 200').toBe(200);
    expect(health.body.pageCount, '[E6] 页面仍有一条，建议未真正删除数据').toBe(1);
    expect(health.body, '[E6] 页数及同步时间仍对应 S1，规则数为零').toMatchObject({ pageCount: baseline.sync1.pageCount, ruleCount: 0, lastSyncAt: baseline.sync1.syncedAt });
  });
});
