// 来源：docs/trace/cases-api.json TC-API-DIAG-001（F-DIAG-09#AC1, F-DIAG-01#AC1；C-BE-DIAG-01, C-BE-CORE-15, C-BE-CORE-14）
// 夹具已自动 reset；S1 再显式调用一次 reset 作为被测步骤。
import { test, expect } from '../fixtures/api.mjs';

test('TC-API-DIAG-001 后端数据为空时 GET /api/health 返回 200、version=1.0.0、页面数和规则数为 0', async ({ api }) => {
  await test.step('S1：POST /api/__test__/reset', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] body.ok=true').toBe(true);
  });

  await test.step('S2：GET /api/health', async () => {
    const before = Date.now();
    const r = await api.get('/api/health');
    expect(r.status, '[E2] health 返回 200').toBe(200);
    expect(r.headers['content-type'], '[E2] content-type 包含 application/json').toContain('application/json');
    expect(r.body.status, '[E3] status="ok"').toBe('ok');
    expect(r.body.version, '[E3] version="1.0.0"').toBe('1.0.0');
    expect(Number.isInteger(r.body.uptime), '[E4] uptime 为整数').toBe(true);
    expect(r.body.uptime, '[E4] uptime ≥ 0').toBeGreaterThanOrEqual(0);
    expect(r.body, '[E5] 空数据时页面数和规则数都为 0').toMatchObject({ pageCount: 0, ruleCount: 0, enabledRuleCount: 0 });
    expect(r.body.lastSyncAt, '[E6] lastSyncAt=null').toBeNull();
    expect(r.body.persistence, '[E6] 未配置 SNAPSHOT_FILE 时 persistence="memory"').toBe('memory');
    expect(r.body.startedAt, '[E6] startedAt 为数字').toEqual(expect.any(Number));
    expect(r.body.startedAt, '[E6] startedAt ≤ 请求发出时的 Date.now()').toBeLessThanOrEqual(before);
  });
});
