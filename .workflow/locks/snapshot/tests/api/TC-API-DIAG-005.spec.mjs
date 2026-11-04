// 来源：docs/trace/cases-api.json TC-API-DIAG-005（F-DIAG-09#AC1；C-BE-DIAG-01, C-BE-CORE-15）
// uptime 为秒级整数，存在 ±1 秒取整误差，所以 E2 用「差值 ≤ 1」。
// S2 的 1200 ms 等待是用例规定的测试数据（跨过一个整秒边界），不是在等待 UI 状态，因此用定时器而不是 expect.poll。
import { test, expect } from '../fixtures/api.mjs';

const WAIT_MS = 1200;

test('TC-API-DIAG-005 uptime 以整秒计：与 startedAt 推算的秒数相差不超过 1，间隔 1.2 秒后至少增加 1', async ({ api }) => {
  const first = await test.step('S1：GET /api/health，记录 U1、ST、N1', async () => {
    const r = await api.get('/api/health');
    const n1 = Date.now();
    expect(r.status, 'S1 health 返回 200').toBe(200);
    const { uptime: u1, startedAt: st } = r.body;
    expect(Number.isInteger(u1), '[E1] U1 为整数').toBe(true);
    expect(u1, '[E1] U1 ≥ 0').toBeGreaterThanOrEqual(0);
    expect(st, 'S1 startedAt 为数字').toEqual(expect.any(Number));
    expect(Math.abs(u1 - Math.floor((n1 - st) / 1000)), '[E2] |U1 − floor((N1 − ST)/1000)| ≤ 1').toBeLessThanOrEqual(1);
    return { u1, st };
  });

  await test.step('S2：等待 1200 毫秒', async () => {
    await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
  });

  await test.step('S3：GET /api/health，记录 U2', async () => {
    const r = await api.get('/api/health');
    const u2 = r.body.uptime;
    expect(Number.isInteger(u2), '[E3] U2 为整数').toBe(true);
    expect(u2, '[E3] U2 ≥ U1 + 1').toBeGreaterThanOrEqual(first.u1 + 1);
    expect(r.body.startedAt, '[E4] startedAt 不变（reset 不改变启动时间）').toBe(first.st);
  });
});
