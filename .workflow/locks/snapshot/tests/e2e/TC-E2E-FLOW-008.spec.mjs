// 用例来源：docs/trace/cases-api.json；自定义隐私关键词随正式规则的保存和删除生效。
import { test, expect, HOUR } from '../fixtures/api.mjs';

const COOKIE_URL = 'https://example.com/?cookie=1';
const TEXT = '不要上传包含 cookie 的 URL';

test('TC-E2E-FLOW-008 隐私规则保存后拒收，按正式 id 删除后原历史恢复接收', async ({ api }) => {
  const T = Date.now();
  const payload = { activeTab: null, openTabs: [], history: [{ url: COOKIE_URL, title: 'Cookie guide', lastVisitTime: T - HOUR, visitCount: 2 }] };

  const baseline = await test.step('S1：读取默认关键词并解析自定义 cookie 隐私规则', async () => {
    const config = await api.get('/api/config');
    expect(config.status, '[E1] 默认配置返回 200').toBe(200);
    expect(config.body, '[E1] 默认整理、历史条数及隐私开关正确').toMatchObject({ cleanupThresholdDays: 14, maxHistoryItems: 100, enablePrivacyFilter: true });
    expect(config.body.privacySensitiveKeywords, '[E1] 默认关键词及顺序准确').toEqual(['password', 'token', 'bank', 'secret']);
    expect(config.body.privacySensitiveKeywords, '[E1] 默认不含 cookie').not.toContain('cookie');
    const parsed = await api.post('/api/rules/parse', { text: TEXT });
    expect(parsed.status, '[E1] 解析返回 200').toBe(200);
    expect(parsed.body.rules, '[E1] 解析出一条隐私规则').toHaveLength(1);
    expect(parsed.body.rules[0], '[E1] 关键词 cookie 对应禁止上传动作').toMatchObject({ type: 'privacy_filter', keywords: ['cookie'], action: 'exclude_upload' });
    return { base: config.body, parsed: parsed.body };
  });

  const saved = await test.step('S2：原样保存预览，读回合并后的有效关键词', async () => {
    const r = await api.post('/api/rules', { rules: baseline.parsed.rules });
    expect(r.status, '[E2] 保存返回 201').toBe(201);
    expect(r.body.ruleCount, '[E2] 规则数为一').toBe(1);
    expect(r.body.rules, '[E2] 返回一条正式规则').toHaveLength(1);
    expect(r.body.rules[0].id, '[E2] 正式 privacyId 非空').toMatch(/\S/);
    const effective = await api.get('/api/config');
    expect(effective.status, '[E2] 保存后的配置返回 200').toBe(200);
    expect([...new Set(effective.body.privacySensitiveKeywords)].sort(), '[E2] 有效关键词集合等于默认集合并入 cookie').toEqual([...new Set([...baseline.base.privacySensitiveKeywords, 'cookie'])].sort());
    expect(effective.body.baseSensitiveKeywords, '[E2] 基础关键词保留已核实的默认配置，不混入规则关键词').toEqual(baseline.base.privacySensitiveKeywords);
    return { privacyId: r.body.rules[0].id, effective: effective.body };
  });

  await test.step('S3：确认 cookie 已生效，直传对应历史并读回拒收状态', async () => {
    expect(saved.effective.privacySensitiveKeywords, '[E3] 同步前确认有效关键词含 cookie').toContain('cookie');
    const denied = await api.post('/api/sync', payload);
    expect(denied.status, '[E3] 受隐私规则影响的同步返回 200').toBe(200);
    expect(denied.body, '[E3] 唯一条目被拒收，未创建或更新页面').toMatchObject({ received: 1, created: 0, updated: 0, rejected: 1, rejectedByReason: { privacy: 1 }, pageCount: 0 });
    const ranked = await api.get('/api/pages/ranked', { params: { now: T } });
    expect(ranked.status, '[E3] 拒收后的排序返回 200').toBe(200);
    expect(ranked.body, '[E3] 被拒收 URL 未进入排序').toMatchObject({ pages: [], total: 0 });
    const health = await api.get('/api/health');
    expect(health.status, '[E3] 健康检查返回 200').toBe(200);
    expect(health.body, '[E3] 健康信息保留规则、空页面库及拒收同步时间').toMatchObject({ ruleCount: 1, pageCount: 0, lastSyncAt: denied.body.syncedAt });
  });

  const restored = await test.step('S4：按保存返回的 privacyId 删除，读回恢复后的配置', async () => {
    const deleted = await api.del(`/api/rules/${saved.privacyId}`);
    expect(deleted.status, '[E4] 删除返回 200').toBe(200);
    expect(deleted.body, '[E4] 删除的正是正式隐私规则，规则数归零').toEqual({ deleted: saved.privacyId, ruleCount: 0 });
    const config = await api.get('/api/config');
    expect(config.status, '[E4] 恢复后的配置返回 200').toBe(200);
    expect([...new Set(config.body.privacySensitiveKeywords)].sort(), '[E4] 有效关键词集合恢复默认').toEqual([...new Set(baseline.base.privacySensitiveKeywords)].sort());
    expect(config.body.privacySensitiveKeywords, '[E4] cookie 已从有效关键词中移除').not.toContain('cookie');
    const health = await api.get('/api/health');
    expect(health.status, '[E4] 健康检查返回 200').toBe(200);
    expect(health.body.ruleCount, '[E4] 健康信息规则数归零').toBe(0);
    return config.body;
  });

  await test.step('S5：确认配置恢复，原样重发被拒历史并读回已接收页面', async () => {
    expect([...new Set(restored.privacySensitiveKeywords)].sort(), '[E5] 重发前确认关键词仍等于基线').toEqual([...new Set(baseline.base.privacySensitiveKeywords)].sort());
    const accepted = await api.post('/api/sync', payload);
    expect(accepted.status, '[E5] 同一历史重新同步返回 200').toBe(200);
    expect(accepted.body, '[E5] 删除规则后成功创建一页且无拒收').toMatchObject({ created: 1, rejected: 0, pageCount: 1 });
    const ranked = await api.get('/api/pages/ranked', { params: { now: T } });
    expect(ranked.status, '[E5] 接收后的排序返回 200').toBe(200);
    expect(ranked.body.total, '[E5] 接收后 total=1').toBe(1);
    expect(ranked.body.pages, '[E5] 唯一条历史已可查询').toHaveLength(1);
    expect(ranked.body.pages[0], '[E5] URL、次数及时间都来自 S3 原样请求').toMatchObject({ url: COOKIE_URL, visitCount: 2, lastVisitedAt: payload.history[0].lastVisitTime });
    const health = await api.get('/api/health');
    expect(health.status, '[E6] 最终健康检查返回 200').toBe(200);
    expect(health.body.pageCount, '[E6] 最终页数为一').toBe(1);
    expect(health.body, '[E6] 最终状态对应本次接收同步，规则数仍为零').toMatchObject({ pageCount: accepted.body.pageCount, ruleCount: 0, lastSyncAt: accepted.body.syncedAt });
  });
});
