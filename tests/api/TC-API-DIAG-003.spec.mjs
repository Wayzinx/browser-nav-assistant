// 来源：docs/trace/cases-api.json TC-API-DIAG-003（F-DIAG-09#AC1, AC2；C-BE-DIAG-01, C-BE-CORE-12, C-BE-CORE-14）
import { test, expect, samplePayload, HOUR } from '../fixtures/api.mjs';

const DIAG_A = 'https://example.com/diag-a';

test('TC-API-DIAG-003 lastSyncAt 跟随最近一次同步更新，reset 后 pageCount 归 0、lastSyncAt 回到 null', async ({ api }) => {
  await test.step('S1：GET /api/health，记录 lastSyncAt', async () => {
    const r = await api.get('/api/health');
    expect(r.body.lastSyncAt, '[E1] 从未同步时 lastSyncAt=null').toBeNull();
    expect(r.body.pageCount, '[E1] pageCount=0').toBe(0);
  });

  const t1 = await test.step('S2：POST /api/sync 导入平移后的 resource.json，记录 T1', async () => {
    const r = await api.post('/api/sync', samplePayload({ now: Date.now() }));
    expect(r.status, 'S2 同步返回 200').toBe(200);
    expect(r.body.syncedAt, 'S2 syncedAt 为数字').toEqual(expect.any(Number));
    return r.body.syncedAt;
  });

  await test.step('S3：GET /api/health', async () => {
    const r = await api.get('/api/health');
    expect(r.body.lastSyncAt, '[E2] lastSyncAt=T1').toBe(t1);
    expect(r.body.pageCount, '[E2] pageCount=10').toBe(10);
  });

  const t2 = await test.step('S4：POST /api/sync，history 只含 diag-a，记录 T2', async () => {
    const now = Date.now();
    const r = await api.post('/api/sync', {
      activeTab: null, openTabs: [],
      history: [{ url: DIAG_A, title: 'diag-a', lastVisitTime: now - HOUR, visitCount: 1 }],
    });
    expect(r.status, '[E3] 第 2 次同步返回 200').toBe(200);
    expect(r.body.created, '[E3] created=1').toBe(1);
    expect(r.body.syncedAt, '[E3] T2 ≥ T1').toBeGreaterThanOrEqual(t1);
    return r.body.syncedAt;
  });

  await test.step('S5：GET /api/health', async () => {
    const r = await api.get('/api/health');
    expect(r.body.lastSyncAt, '[E4] lastSyncAt=T2').toBe(t2);
    expect(r.body.pageCount, '[E4] pageCount=11').toBe(11);
  });

  await test.step('S6：POST /api/__test__/reset', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E5] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E5] body.ok=true').toBe(true);
  });

  await test.step('S7：GET /api/health', async () => {
    const r = await api.get('/api/health');
    expect(r.body, '[E6] reset 后数据清零').toMatchObject({ pageCount: 0, ruleCount: 0, status: 'ok' });
    expect(r.body.lastSyncAt, '[E6] lastSyncAt 回到 null').toBeNull();
  });
});
