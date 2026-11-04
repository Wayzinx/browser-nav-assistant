// 来源：docs/trace/cases-api.json TC-API-DIAG-002（F-DIAG-09#AC2；C-BE-DIAG-01, C-BE-CORE-12）
import { test, expect, samplePayload } from '../fixtures/api.mjs';

const RULES = [
  { rawText: '把 7 天没访问过的 GitHub issue 建议归档', type: 'archive_candidate', domain: 'github.com', urlPattern: '/issues/', inactiveDays: 7, action: 'suggest_archive' },
  { rawText: 'docs.internal.com 的页面永远不要归档', type: 'never_archive', domain: 'docs.internal.com', action: 'keep' },
];

test('TC-API-DIAG-002 导入 resource.json 样例并保存 2 条规则后：pageCount=10、ruleCount=2、lastSyncAt 等于导入的 syncedAt', async ({ api }) => {
  const syncedAt = await test.step('S1：POST /api/sync 导入平移后的 resource.json，记录 syncedAt', async () => {
    const r = await api.post('/api/sync', samplePayload({ now: Date.now() }));
    expect(r.status, '[E1] 同步返回 200').toBe(200);
    expect(r.body, '[E1] created=10、pageCount=10').toMatchObject({ created: 10, pageCount: 10 });
    expect(r.body.syncedAt, '[E1] syncedAt 为数字').toEqual(expect.any(Number));
    return r.body.syncedAt;
  });

  await test.step('S2：POST /api/rules 保存规则①②', async () => {
    const r = await api.post('/api/rules', { rules: RULES });
    expect(r.status, '[E2] 保存规则返回 201').toBe(201);
    expect(r.body.ruleCount, '[E2] ruleCount=2').toBe(2);
    expect(r.body.rules, '[E2] 返回 2 条规则').toHaveLength(2);
    const ids = r.body.rules.map((x) => x.id);
    for (const id of ids) expect(id, '[E2] 规则 id 非空').toMatch(/\S/);
    expect(new Set(ids).size, '[E2] 规则 id 互不相同').toBe(2);
  });

  await test.step('S3：GET /api/health', async () => {
    const r = await api.get('/api/health');
    expect(r.status, '[E3] health 返回 200').toBe(200);
    expect(r.body, '[E3] pageCount=10、ruleCount=2、enabledRuleCount=2').toMatchObject({ pageCount: 10, ruleCount: 2, enabledRuleCount: 2 });
    expect(r.body.lastSyncAt, '[E4] lastSyncAt 严格等于 S1 的 syncedAt').toBe(syncedAt);
    expect(r.body, '[E5] status="ok"、version="1.0.0"').toMatchObject({ status: 'ok', version: '1.0.0' });
  });
});
