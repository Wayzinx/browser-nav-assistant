// 用例来源：docs/trace/cases-api.json；保护规则写入和删除均使排序快照失效。
import { test, expect, samplePayload } from '../fixtures/api.mjs';

const INTERNAL = 'https://docs.internal.com/ai-agent-design';
const TEXT = 'docs.internal.com 的页面永远不要归档';

test('TC-E2E-FLOW-003 保护规则使同一页面提分升位，删除后恢复排序和理由', async ({ api }) => {
  const T = Date.now();

  const baseline = await test.step('S1：同步样例并记录保护目标的原始排名及评分', async () => {
    const sync = await api.post('/api/sync', samplePayload({ now: T }));
    expect(sync.status, '[E1] 同步返回 200').toBe(200);
    expect(sync.body, '[E1] 样例同步计数正确').toMatchObject({ received: 14, created: 10, updated: 4, pageCount: 10 });
    const ranked = await api.get('/api/pages/ranked', { params: { now: T } });
    expect(ranked.status, '[E1] 基线排序返回 200').toBe(200);
    const target = ranked.body.pages.find(p => p.url === INTERNAL);
    expect(target, '[E1] 内部文档基线为 0.56、亲和域名分 0.10').toMatchObject({ url: INTERNAL, score: 0.56, scoreDetail: { domain: 0.10, domainSource: 'affinity' } });
    expect(target.id, '[E1] 目标具有非空服务端 id').toMatch(/\S/);
    for (const dimension of ['recency', 'frequency', 'open']) {
      expect(Number.isFinite(target.scoreDetail[dimension]), `[E1] 基线评分维度 ${dimension} 存在且为有限数字`).toBe(true);
    }
    expect(ranked.body.pages.findIndex(p => p.id === target.id) + 1, '[E1] 基线排名为第八').toBe(8);
    expect(target.reason, '[E1] 基线没有受保护域名理由').not.toContain('属于受保护域名');
    return { sync1: sync.body, target };
  });

  const protectedId = await test.step('S2：解析并原样保存保护规则，取正式 id', async () => {
    const parsed = await api.post('/api/rules/parse', { text: TEXT });
    expect(parsed.status, '[E2] 解析返回 200').toBe(200);
    expect(parsed.body.rules, '[E2] 解析出一条规则').toHaveLength(1);
    expect(parsed.body.rules[0], '[E2] 解析为内部域名永不归档').toMatchObject({ type: 'never_archive', domain: 'docs.internal.com' });
    const saved = await api.post('/api/rules', { rules: parsed.body.rules });
    expect(saved.status, '[E2] 保存返回 201').toBe(201);
    expect(saved.body.ruleCount, '[E2] 正式规则数为 1').toBe(1);
    expect(saved.body.rules, '[E2] 保存响应仅有一条规则').toHaveLength(1);
    expect(saved.body.rules[0].id, '[E2] 正式 protectedId 非空').toMatch(/\S/);
    return saved.body.rules[0].id;
  });

  await test.step('S3：按原页面 id 检查提分升位，并检查整理保护关联', async () => {
    const ranked = await api.get('/api/pages/ranked', { params: { now: T } });
    expect(ranked.status, '[E3] 保护生效后的排序返回 200').toBe(200);
    const target = ranked.body.pages.find(p => p.id === baseline.target.id);
    expect(target, '[E3] 同一 id/url 提分到 0.65，域名分来自保护规则').toMatchObject({ id: baseline.target.id, url: baseline.target.url, score: 0.65, scoreDetail: { domain: 1, domainSource: 'protected' } });
    expect(ranked.body.pages.findIndex(p => p.id === target.id) + 1, '[E3] 同一页面升到第七').toBe(7);
    expect(target.reason, '[E3] 排序理由说明受保护域名').toContain('属于受保护域名');
    for (const dimension of ['recency', 'frequency', 'open']) {
      expect(Number.isFinite(target.scoreDetail[dimension]), `[E3] 保护后的评分维度 ${dimension} 存在且为有限数字`).toBe(true);
    }
    expect({ recency: target.scoreDetail.recency, frequency: target.scoreDetail.frequency, open: target.scoreDetail.open }, '[E3] 其余三个评分维度不变').toEqual({
      recency: baseline.target.scoreDetail.recency, frequency: baseline.target.scoreDetail.frequency, open: baseline.target.scoreDetail.open,
    });
    const clean = await api.get('/api/pages/cleanup-suggestions', { params: { now: T } });
    expect(clean.status, '[E4] 整理建议返回 200').toBe(200);
    const keep = clean.body.suggestions.filter(s => s.action === 'keep');
    expect(keep, '[E4] 只有一条保护建议').toHaveLength(1);
    expect(keep[0], '[E4] 保护同一页面并引用正式 protectedId').toMatchObject({ url: baseline.target.url, ruleId: protectedId });
    expect(keep[0].reason, '[E4] 理由包含保护域名').toContain('被保护域名配置（docs.internal.com）');
    expect(clean.body.suggestions.filter(s => s.action === 'archive').map(s => s.url), '[E4] 目标不在归档集合').not.toContain(baseline.target.url);
  });

  await test.step('S4：按正式 id 删除规则，排序及健康信息恢复', async () => {
    const deleted = await api.del(`/api/rules/${protectedId}`);
    expect(deleted.status, '[E5] 删除返回 200').toBe(200);
    expect(deleted.body, '[E5] 正式保护规则已删除').toEqual({ deleted: protectedId, ruleCount: 0 });
    const ranked = await api.get('/api/pages/ranked', { params: { now: T } });
    expect(ranked.status, '[E5] 删除后的排序返回 200').toBe(200);
    const target = ranked.body.pages.find(p => p.id === baseline.target.id);
    expect(target, '[E5] 原 id 页面恢复 0.56 与 affinity 域名分').toMatchObject({ id: baseline.target.id, url: baseline.target.url, score: 0.56, scoreDetail: { domain: 0.10, domainSource: 'affinity' } });
    expect(ranked.body.pages.findIndex(p => p.id === target.id) + 1, '[E5] 排名恢复第八').toBe(8);
    expect(target.reason, '[E5] 排序理由完整恢复基线').toBe(baseline.target.reason);
    expect(target.reason, '[E5] 排序理由不再含受保护域名').not.toContain('属于受保护域名');
    const health = await api.get('/api/health');
    expect(health.status, '[E6] 健康检查返回 200').toBe(200);
    expect(health.body, '[E6] 删除规则不改变页数与同步时间').toMatchObject({ ruleCount: 0, pageCount: baseline.sync1.pageCount, lastSyncAt: baseline.sync1.syncedAt });
  });
});
