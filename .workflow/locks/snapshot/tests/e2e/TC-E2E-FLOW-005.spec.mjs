// 用例来源：docs/trace/cases-api.json；仅证明后端隐私兜底及后端日志脱敏。
import fs from 'node:fs';
import { test, expect, DAY, HOUR } from '../fixtures/api.mjs';
import { SERVER_LOG_FILE } from '../fixtures/evidence.mjs';

const SENSITIVE_URL = 'https://example.com/reset?token=abc';
const SAFE_URL = 'https://example.com/old';

test('TC-E2E-FLOW-005 敏感历史被服务端拒收，读侧及后端日志不泄露', async ({ api, evidence }) => {
  const T = Date.now();
  const sensitivePayload = { activeTab: null, openTabs: [], history: [{ url: SENSITIVE_URL, title: 'Sensitive', lastVisitTime: T - 30 * DAY, visitCount: 1 }] };
  const safePayload = { activeTab: null, openTabs: [], history: [{ url: SAFE_URL, title: 'Old', lastVisitTime: T - 15 * DAY, visitCount: 1 }] };

  const denied = await test.step('S1：记录日志偏移，直传敏感历史并读取空排序', async () => {
    expect(SERVER_LOG_FILE, '[E5] 后端日志路径已由测试工程配置').toMatch(/\S/);
    const logStart = fs.statSync(SERVER_LOG_FILE).size;
    const sync = await api.post('/api/sync', sensitivePayload);
    const logEnd = fs.statSync(SERVER_LOG_FILE).size;
    expect(sync.status, '[E1] 敏感同步返回 200 并报告拒收').toBe(200);
    expect(sync.body, '[E1] 唯一敏感条目没有入库').toMatchObject({ received: 1, created: 0, updated: 0, rejected: 1, pageCount: 0 });
    expect(sync.body.rejectedByReason, '[E1] 拒收原因只有 privacy').toEqual({ invalid_url: 0, privacy: 1 });
    const ranked = await api.get('/api/pages/ranked', { params: { now: T } });
    expect(ranked.status, '[E1] 拒收后的排序返回 200').toBe(200);
    expect(ranked.body, '[E1] 拒收后排序仍为空').toMatchObject({ pages: [], total: 0 });
    return { sync, ranked, logStart, logEnd };
  });

  const safe = await test.step('S2：同步独立安全历史，从排序响应取实际页面及时间', async () => {
    const sync = await api.post('/api/sync', safePayload);
    expect(sync.status, '[E2] 安全历史同步返回 200').toBe(200);
    expect(sync.body, '[E2] 安全历史正常创建一页').toMatchObject({ received: 1, created: 1, rejected: 0, pageCount: 1 });
    const ranked = await api.get('/api/pages/ranked', { params: { now: T } });
    expect(ranked.status, '[E2] 安全历史排序返回 200').toBe(200);
    expect(ranked.body.total, '[E2] 读侧只有一页').toBe(1);
    expect(ranked.body.pages, '[E2] 返回唯一安全页面').toHaveLength(1);
    expect(ranked.body.pages[0], '[E2] URL 和访问时间等于实际上传安全历史').toMatchObject({ url: SAFE_URL, lastVisitedAt: safePayload.history[0].lastVisitTime });
    return { sync, ranked, page: ranked.body.pages[0] };
  });

  const cleanup = await test.step('S3：由读回时间计算十四天二十三小时和恰好十五天的边界', async () => {
    const nowA = safe.page.lastVisitedAt + 14 * DAY + 23 * HOUR;
    const nowB = safe.page.lastVisitedAt + 15 * DAY;
    const before = await api.get('/api/pages/cleanup-suggestions', { params: { now: nowA } });
    const at = await api.get('/api/pages/cleanup-suggestions', { params: { now: nowB } });
    expect(before.status, '[E3] 边界前整理建议返回 200').toBe(200);
    expect(at.status, '[E3] 边界处整理建议返回 200').toBe(200);
    expect(before.body.suggestions.filter(s => s.action === 'archive').map(s => s.url), '[E3] 十四天二十三小时尚无安全页归档').not.toContain(safe.page.url);
    expect(at.body.summary, '[E3] 恰好十五天只有一条归档').toEqual({ archive: 1, merge: 0, keep: 0 });
    expect(at.body.suggestions, '[E3] 恰好十五天返回唯一建议').toHaveLength(1);
    expect(at.body.suggestions[0], '[E3] 归档建议消费 S2 返回的 URL 和访问时间').toMatchObject({ action: 'archive', url: safe.page.url, ageDays: 15, lastVisitedAt: safe.page.lastVisitedAt });
    return { before, at };
  });

  await test.step('S4：核对健康信息、全部响应及敏感请求对应后端日志区间', async () => {
    const health = await api.get('/api/health');
    expect(health.status, '[E4] 健康检查返回 200').toBe(200);
    expect(health.body.pageCount, '[E4] 健康页数只有安全页一条').toBe(1);
    expect(health.body, '[E4] 健康信息关联安全同步，规则数为零').toMatchObject({ pageCount: safe.sync.body.pageCount, lastSyncAt: safe.sync.body.syncedAt, ruleCount: 0 });
    for (const response of [denied.ranked, safe.ranked, cleanup.before, cleanup.at]) {
      const serialized = JSON.stringify(response.body);
      expect(serialized, '[E4] 所有排序和整理响应均不含敏感 URL').not.toContain(SENSITIVE_URL);
      expect(serialized, '[E4] 所有排序和整理响应均不含区分大小写的敏感标题').not.toContain('Sensitive');
    }
    // 按字节区间读取服务端原始日志；缺失、空区间或请求不匹配都不能算脱敏通过。
    expect(denied.logEnd, '[E5] 敏感请求产生了实际后端日志').toBeGreaterThan(denied.logStart);
    const log = fs.readFileSync(SERVER_LOG_FILE).subarray(denied.logStart, denied.logEnd).toString('utf8');
    expect(log, '[E5] 日志区间包含本次敏感请求的 request id').toContain(denied.sync.reqId);
    expect(log, '[E5] 后端日志未暴露敏感路径和查询').not.toContain('reset?token=abc');
    expect(log, '[E5] 后端日志未暴露敏感查询值').not.toContain('token=abc');
    const responses = [denied.sync, denied.ranked, safe.sync, safe.ranked, cleanup.before, cleanup.at, health];
    expect(JSON.stringify(responses), '[E5] S1–S4 所有响应均不回显被拒收 URL').not.toContain(SENSITIVE_URL);
    evidence.note(`敏感请求后端日志字节区间 [${denied.logStart}, ${denied.logEnd})；requestId=${denied.sync.reqId}`);
  });
});
