// 用例来源：docs/trace/cases-api.json；完整验收链，规则预览原样保存，按正式 id 删除。
import { test, expect, samplePayload } from '../fixtures/api.mjs';

const PR = 'https://github.com/org/repo/pull/456';
const INTERNAL = 'https://docs.internal.com/ai-agent-design';
const OLD_ISSUE = 'https://github.com/org/repo/issues/100';
const ARCHIVE_TEXT = '把 7 天没访问过的 GitHub issue 建议归档';
const PROTECT_TEXT = 'docs.internal.com 的页面永远不要归档';
const RULE_TEXT = `${ARCHIVE_TEXT}，但 ${PROTECT_TEXT}`;
const ruleFields = rule => Object.fromEntries(['type', 'domain', 'urlPattern', 'inactiveDays', 'action', 'rawText'].map(key => [key, rule[key]]));
const suggestionFields = body => body.suggestions.map(({ action, url, urls, keepUrl, ageDays, reason, ruleId }) => ({ action, url, urls, keepUrl, ageDays, reason, ruleId }));

test('TC-E2E-FLOW-002 同步、排序、推荐、规则生效和删除恢复的完整验收链', async ({ api }) => {
  const T = Date.now();
  const payload = samplePayload({ now: T });

  const baseline = await test.step('S1：导入样例并读取空规则基线', async () => {
    const sync = await api.post('/api/sync', payload);
    expect(sync.status, '[E1] 同步返回 200').toBe(200);
    expect(sync.body, '[E1] 样例同步创建十页并合并四条').toMatchObject({ received: 14, created: 10, updated: 4, pageCount: 10 });
    expect(Number.isInteger(sync.body.syncedAt), '[E1] 同步时间为整数').toBe(true);
    expect(sync.body.syncedAt, '[E1] 同步时间为正数').toBeGreaterThan(0);
    const rules = await api.get('/api/rules');
    expect(rules.status, '[E1] 基线规则列表返回 200').toBe(200);
    expect(rules.body, '[E1] 基线规则库为空').toEqual({ rules: [], total: 0 });
    return { sync1: sync.body, rules: rules.body };
  });

  const clean0 = await test.step('S2：消费排序响应请求推荐，记录整理建议基线', async () => {
    const ranked = await api.get('/api/pages/ranked', { params: { limit: 20, now: T } });
    expect(ranked.status, '[E2] 排序返回 200').toBe(200);
    expect(ranked.body.total, '[E2] 排序页数等于同步页数').toBe(baseline.sync1.pageCount);
    expect(ranked.body.total, '[E2] 排序 total 为 10').toBe(10);
    expect(ranked.body.pages, '[E2] 排序返回十页').toHaveLength(10);
    expect(ranked.body.generatedAt, '[E2] 排序使用固定时间 T').toBe(T);
    for (const p of ranked.body.pages) {
      expect(Object.keys(p), `[E2] ${p.url} 包含全部必需字段`).toEqual(expect.arrayContaining(
        ['url', 'title', 'domain', 'visitCount', 'lastVisitedAt', 'score', 'reason', 'isOpen', 'sources', 'scoreDetail']));
    }
    const scores = ranked.body.pages.map(p => p.score);
    expect(scores, '[E2] 排序分数非递增').toEqual([...scores].sort((a, b) => b - a));
    const current = ranked.body.pages.find(p => p.url === PR);
    expect(current, '[E2] 当前页取自返回的 PR 对象').toMatchObject({ url: PR });
    const tabs = ranked.body.pages.filter(p => p.isOpen && p.url !== current.url);
    expect(tabs, '[E2] 其余打开快照为三页').toHaveLength(3);
    const rec = await api.post('/api/recommendations/next', {
      currentPage: { url: current.url, title: current.title },
      openTabs: tabs.map(p => ({ url: p.url, title: p.title })),
      recentHistory: ranked.body.pages.map(p => ({ url: p.url, title: p.title, lastVisitTime: p.lastVisitedAt })),
    }, { params: { now: T } });
    expect(rec.status, '[E3] 推荐返回 200').toBe(200);
    expect(rec.body.recommendations.length, '[E3] 至少一条推荐').toBeGreaterThanOrEqual(1);
    expect(rec.body.recommendations.length, '[E3] 最多五条推荐').toBeLessThanOrEqual(5);
    expect(rec.body.recommendations[0], '[E3] Actions 首位且 contextUrl 使用排序响应的 PR').toMatchObject({ url: 'https://github.com/org/repo/actions', strategy: 'same_repo', score: 0.87, contextUrl: current.url });
    expect(rec.body.recommendations[0].reason, '[E3] 理由包含 PR').toContain('PR');
    expect(rec.body.recommendations[0].reason, '[E3] 理由包含 CI').toContain('CI');
    const clean = await api.get('/api/pages/cleanup-suggestions', { params: { now: T } });
    expect(clean.status, '[E4] 整理建议返回 200').toBe(200);
    expect(clean.body.summary, '[E4] 基线为两条归档、一组合并、零条保护').toEqual({ archive: 2, merge: 1, keep: 0 });
    expect(clean.body.suggestions, '[E4] 基线实际返回三条建议').toHaveLength(3);
    expect(clean.body.suggestions.filter(s => s.action === 'archive'), '[E4] 实际归档项有两条').toHaveLength(2);
    expect(clean.body.suggestions.filter(s => s.action === 'merge'), '[E4] 实际合并项有一条').toHaveLength(1);
    for (const s of clean.body.suggestions.filter(s => s.action === 'archive')) {
      expect(Object.keys(s), '[E4] 归档建议字段完整').toEqual(expect.arrayContaining(['url', 'title', 'reason', 'ageDays']));
    }
    for (const s of clean.body.suggestions.filter(s => s.action === 'merge')) {
      expect(Object.keys(s), '[E4] 合并建议字段完整').toEqual(expect.arrayContaining(['urls', 'keepUrl', 'reason']));
    }
    return clean.body;
  });

  const parsed = await test.step('S3：解析双规则，验证预览未入库', async () => {
    const r = await api.post('/api/rules/parse', { text: RULE_TEXT });
    expect(r.status, '[E5] 解析返回 200').toBe(200);
    expect(r.body.rules, '[E5] 按子句顺序解析出两条规则').toHaveLength(2);
    expect(r.body.unparsed, '[E5] 没有未解析片段').toEqual([]);
    expect(r.body.rules[0], '[E5] 第一条为 GitHub issue 七天归档规则').toMatchObject({ type: 'archive_candidate', domain: 'github.com', urlPattern: '/issues/', inactiveDays: 7, action: 'suggest_archive', rawText: ARCHIVE_TEXT });
    expect(r.body.rules[1], '[E5] 第二条为内部文档保护规则').toMatchObject({ type: 'never_archive', domain: 'docs.internal.com', action: 'keep', rawText: PROTECT_TEXT });
    const list = await api.get('/api/rules');
    expect(list.status, '[E6] 预览后的列表返回 200').toBe(200);
    expect(list.body.total, '[E6] 规则数量仍等于零条基线').toBe(baseline.rules.total);
    expect(list.body, '[E6] parse 没有写入规则').toEqual({ rules: [], total: 0 });
    return r.body;
  });

  const saved = await test.step('S4：将完整预览规则原样保存并提取正式 id', async () => {
    const r = await api.post('/api/rules', { rules: parsed.rules });
    expect(r.status, '[E7] 保存返回 201').toBe(201);
    expect(r.body.ruleCount, '[E7] 保存后规则数为 2').toBe(2);
    expect(r.body.rules, '[E7] 返回两条正式规则').toHaveLength(2);
    for (const rule of r.body.rules) {
      expect(rule.id, '[E7] 正式 id 为非空字符串').toMatch(/\S/);
      expect(rule.enabled, '[E7] 保存的规则已启用').toBe(true);
    }
    expect(new Set(r.body.rules.map(rule => rule.id)).size, '[E7] 两条正式 id 互不相同').toBe(2);
    expect(r.body.rules.map(ruleFields), '[E7] 保存保留预览的全部业务字段').toEqual(parsed.rules.map(ruleFields));
    return {
      rules: r.body.rules,
      archiveId: r.body.rules.find(rule => rule.type === 'archive_candidate').id,
      neverId: r.body.rules.find(rule => rule.type === 'never_archive').id,
    };
  });

  await test.step('S5：列表与健康信息读回正式规则及同步状态', async () => {
    const list = await api.get('/api/rules');
    expect(list.status, '[E8] 规则列表返回 200').toBe(200);
    expect(list.body.total, '[E8] 规则列表 total=2').toBe(2);
    expect(list.body.rules, '[E8] 规则列表返回两条').toHaveLength(2);
    for (const rule of list.body.rules) {
      expect(Object.keys(rule), '[E8] 列表规则字段完整').toEqual(expect.arrayContaining(['id', 'rawText', 'type', 'action', 'enabled']));
    }
    expect(list.body.rules.map(rule => rule.id).sort(), '[E8] 读回 id 集合与保存响应一致').toEqual(saved.rules.map(rule => rule.id).sort());
    const health = await api.get('/api/health');
    expect(health.status, '[E8] 健康检查返回 200').toBe(200);
    expect(health.body, '[E8] 两条规则生效且保留同步时间').toMatchObject({ pageCount: 10, ruleCount: 2, lastSyncAt: baseline.sync1.syncedAt });
  });

  await test.step('S6：整理建议引用保存响应的正式规则 id', async () => {
    const r = await api.get('/api/pages/cleanup-suggestions', { params: { now: T } });
    expect(r.status, '[E9] 规则生效后的整理建议返回 200').toBe(200);
    expect(r.body.summary, '[E9] 双规则产生一条保护建议').toEqual({ archive: 2, merge: 1, keep: 1 });
    const keep = r.body.suggestions.filter(s => s.action === 'keep');
    expect(keep, '[E9] 仅有一条 keep').toHaveLength(1);
    expect(keep[0], '[E9] 保护内部文档并引用正式 neverId').toMatchObject({ url: INTERNAL, ruleId: saved.neverId });
    expect(keep[0].reason, '[E9] 保护理由包含命中域名').toContain('被保护域名配置（docs.internal.com）');
    expect(r.body.suggestions.filter(s => s.action === 'archive').map(s => s.url), '[E9] 内部文档未被归档').not.toContain(INTERNAL);
    const old = r.body.suggestions.find(s => s.action === 'archive' && s.url === OLD_ISSUE);
    expect(old, '[E10] 旧 issue 引用正式归档规则').toMatchObject({ ruleId: saved.archiveId, reason: `超过 7 天未访问（已 24 天），且不在当前打开的 tab 中；命中规则「${ARCHIVE_TEXT}」` });
  });

  await test.step('S7：删除正式保护规则，读回剩余规则及整理建议', async () => {
    const deleted = await api.del(`/api/rules/${saved.neverId}`);
    expect(deleted.status, '[E11] 删除保护规则返回 200').toBe(200);
    expect(deleted.body, '[E11] 删除响应引用 neverId，剩余一条规则').toEqual({ deleted: saved.neverId, ruleCount: 1 });
    const list = await api.get('/api/rules');
    expect(list.status, '[E11] 删除后列表返回 200').toBe(200);
    expect(list.body.total, '[E11] 列表剩余一条').toBe(1);
    expect(list.body.rules.map(rule => rule.id), '[E11] 只剩 archiveId').toEqual([saved.archiveId]);
    const health = await api.get('/api/health');
    expect(health.status, '[E11] 健康检查返回 200').toBe(200);
    expect(health.body.ruleCount, '[E11] 健康信息剩余一条规则').toBe(1);
    const clean = await api.get('/api/pages/cleanup-suggestions', { params: { now: T } });
    expect(clean.status, '[E11] 删除后整理建议返回 200').toBe(200);
    expect(clean.body.suggestions.filter(s => s.action === 'keep').map(s => s.url), '[E11] 内部文档的 keep 消失').not.toContain(INTERNAL);
    expect(clean.body.suggestions.find(s => s.action === 'archive' && s.url === OLD_ISSUE)?.ruleId, '[E11] 七天归档规则仍生效').toBe(saved.archiveId);
  });

  await test.step('S8：删除正式归档规则并验证所有整理建议恢复基线', async () => {
    const deleted = await api.del(`/api/rules/${saved.archiveId}`);
    expect(deleted.status, '[E12] 删除归档规则返回 200').toBe(200);
    expect(deleted.body, '[E12] 正式归档规则已删除且规则数归零').toEqual({ deleted: saved.archiveId, ruleCount: 0 });
    const list = await api.get('/api/rules');
    expect(list.status, '[E12] 空规则列表返回 200').toBe(200);
    expect(list.body, '[E12] 规则列表恢复为空').toEqual({ rules: [], total: 0 });
    const health = await api.get('/api/health');
    expect(health.status, '[E12] 健康检查返回 200').toBe(200);
    expect(health.body, '[E12] 页数、同步时间保持一致且规则数归零').toMatchObject({ ruleCount: 0, pageCount: baseline.sync1.pageCount, lastSyncAt: baseline.sync1.syncedAt });
    const clean = await api.get('/api/pages/cleanup-suggestions', { params: { now: T } });
    expect(clean.status, '[E13] 恢复后的整理建议返回 200').toBe(200);
    expect(clean.body.summary, '[E13] 整理计数恢复原始基线').toEqual(clean0.summary);
    expect(suggestionFields(clean.body), '[E13] 所有建议的业务字段恢复原始基线').toEqual(suggestionFields(clean0));
    expect(clean.body.suggestions.find(s => s.action === 'archive' && s.url === OLD_ISSUE), '[E13] 旧 issue 恢复默认十四天理由且无命中规则').toMatchObject({ ruleId: null, reason: '超过 14 天未访问（已 24 天），且不在当前打开的 tab 中' });
  });
});
