import { test, expect } from '../fixtures/api.mjs';

test('TC-API-PRIV-015 配置阈值合法边界通过，越界拒绝且保留最后合法配置', async ({ api }) => {
  await test.step('S1：POST /api/__test__/reset', () => api.reset());

  await test.step('S2：PUT /api/config 设置清理阈值下限 1', async () => {
    const r = await api.put('/api/config', { cleanupThresholdDays: 1 });
    expect(r.status, '[E1] 清理阈值下限返回 200').toBe(200);
    expect(r.body.cleanupThresholdDays, '[E1] 清理阈值为 1').toBe(1);
  });

  await test.step('S3：PUT /api/config 设置三个阈值的合法上限', async () => {
    const r = await api.put('/api/config', { cleanupThresholdDays: 365, maxHistoryItems: 500, historyLookbackDays: 90 });
    expect(r.status, '[E2] 三个合法上限返回 200').toBe(200);
    expect(r.body, '[E2] 返回已保存的三个上限值').toMatchObject({
      cleanupThresholdDays: 365, maxHistoryItems: 500, historyLookbackDays: 90,
    });
  });

  await test.step('S4：PUT /api/config 提交低于下限的清理阈值 0', async () => {
    const r = await api.put('/api/config', { cleanupThresholdDays: 0 });
    expect(r.status, '[E3] 清理阈值 0 返回 400').toBe(400);
    expect(r.body.error.code, '[E3] 下限越界错误码为 VALIDATION_FAILED').toBe('VALIDATION_FAILED');
    expect(r.body.error.details.fields, '[E3] 下限越界标明清理阈值字段').toContain('cleanupThresholdDays');
  });

  await test.step('S5：PUT /api/config 提交高于上限的清理阈值 366', async () => {
    const r = await api.put('/api/config', { cleanupThresholdDays: 366 });
    expect(r.status, '[E3] 清理阈值 366 返回 400').toBe(400);
    expect(r.body.error.code, '[E3] 上限越界错误码为 VALIDATION_FAILED').toBe('VALIDATION_FAILED');
    expect(r.body.error.details.fields, '[E3] 上限越界标明清理阈值字段').toContain('cleanupThresholdDays');
  });

  await test.step('S6：PUT /api/config 提交历史条数 501', async () => {
    const r = await api.put('/api/config', { maxHistoryItems: 501 });
    expect(r.status, '[E4] 历史条数越界返回 400').toBe(400);
    expect(r.body.error.code, '[E4] 历史条数越界错误码为 VALIDATION_FAILED').toBe('VALIDATION_FAILED');
    expect(r.body.error.details.fields, '[E4] 标明历史条数字段').toContain('maxHistoryItems');
  });

  await test.step('S7：PUT /api/config 提交历史回溯天数 91', async () => {
    const r = await api.put('/api/config', { historyLookbackDays: 91 });
    expect(r.status, '[E4] 历史回溯天数越界返回 400').toBe(400);
    expect(r.body.error.code, '[E4] 历史回溯天数越界错误码为 VALIDATION_FAILED').toBe('VALIDATION_FAILED');
    expect(r.body.error.details.fields, '[E4] 标明历史回溯天数字段').toContain('historyLookbackDays');
  });

  await test.step('S8：GET /api/config 验证越界请求没有副作用', async () => {
    const r = await api.get('/api/config');
    expect(r.status, '[E5] 配置查询返回 200').toBe(200);
    expect(r.body, '[E5] 三个阈值保持最后一次合法设置').toMatchObject({
      cleanupThresholdDays: 365, maxHistoryItems: 500, historyLookbackDays: 90,
    });
  });
});
