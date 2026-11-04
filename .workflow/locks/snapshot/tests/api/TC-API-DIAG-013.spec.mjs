// 来源：docs/trace/cases-api.json TC-API-DIAG-013（F-DIAG-10#AC1, AC2；C-BE-DIAG-02, C-BE-CORE-02）
import { test, expect } from '../fixtures/api.mjs';

const WEIGHTS = { recency: 0.4, frequency: 0.3, open: 0.2, domain: 0.1 };

test('TC-API-DIAG-013 阈值取边界值 1 / 365 时 GET /api/config 如实返回，0 / 366 被拒绝且配置保持上一次的有效值', async ({ api }) => {
  await test.step('S1：PUT /api/config { cleanupThresholdDays: 1 }', async () => {
    const r = await api.put('/api/config', { cleanupThresholdDays: 1 });
    expect(r.status, '[E1] 下边界 1 写入返回 200').toBe(200);
  });

  await test.step('S2：GET /api/config', async () => {
    const r = await api.get('/api/config');
    expect(r.body, '[E1] cleanupThresholdDays=1、maxHistoryItems=100').toMatchObject({ cleanupThresholdDays: 1, maxHistoryItems: 100 });
  });

  await test.step('S3：PUT /api/config { cleanupThresholdDays: 365, maxHistoryItems: 500 }', async () => {
    const r = await api.put('/api/config', { cleanupThresholdDays: 365, maxHistoryItems: 500 });
    expect(r.status, 'S3 上边界写入返回 200').toBe(200);
  });

  await test.step('S4：GET /api/config', async () => {
    const r = await api.get('/api/config');
    expect(r.body, '[E2] cleanupThresholdDays=365、maxHistoryItems=500').toMatchObject({ cleanupThresholdDays: 365, maxHistoryItems: 500 });
  });

  await test.step('S5：PUT /api/config { cleanupThresholdDays: 0 }', async () => {
    const r = await api.put('/api/config', { cleanupThresholdDays: 0 });
    expect(r.status, '[E3] 0 被拒绝，返回 400').toBe(400);
    expect(r.body.error.code, '[E3] error.code=VALIDATION_FAILED').toBe('VALIDATION_FAILED');
    expect(r.body.error.details.fields, '[E3] details.fields 包含 cleanupThresholdDays').toContain('cleanupThresholdDays');
  });

  await test.step('S6：PUT /api/config { cleanupThresholdDays: 366 }', async () => {
    const r = await api.put('/api/config', { cleanupThresholdDays: 366 });
    expect(r.status, '[E3] 366 被拒绝，返回 400').toBe(400);
    expect(r.body.error.code, '[E3] error.code=VALIDATION_FAILED').toBe('VALIDATION_FAILED');
    expect(r.body.error.details.fields, '[E3] details.fields 包含 cleanupThresholdDays').toContain('cleanupThresholdDays');
  });

  await test.step('S7：GET /api/config', async () => {
    const r = await api.get('/api/config');
    expect(r.body, '[E4] 失败的写入没有改变配置').toMatchObject({ cleanupThresholdDays: 365, maxHistoryItems: 500 });
    expect(r.body.weights, '[E5] weights 不受影响').toEqual(WEIGHTS);
    expect(r.body.recencyHalfLifeDays, '[E5] recencyHalfLifeDays=7').toBe(7);
  });
});
