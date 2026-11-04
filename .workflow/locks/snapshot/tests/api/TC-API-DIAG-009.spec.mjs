// 来源：docs/trace/cases-api.json TC-API-DIAG-009（F-DIAG-01#AC1；C-BE-DIAG-01）
// 1500 ms 取自 ui-contract 消息 CHECK_CONNECTION 的 timeoutMs 默认值。
import { test, expect, samplePayload } from '../fixtures/api.mjs';

const TIMEOUT_MS = 1500;
const ROUNDS = 5;

test('TC-API-DIAG-009 导入样例后连续 5 次 GET /api/health，每次耗时 < 1500 毫秒且 version=1.0.0', async ({ api, evidence }) => {
  await test.step('S1：POST /api/sync 导入平移后的 resource.json', async () => {
    const r = await api.post('/api/sync', samplePayload({ now: Date.now() }));
    expect(r.status, '[E1] 同步返回 200').toBe(200);
    expect(r.body.pageCount, '[E1] pageCount=10').toBe(10);
  });

  await test.step('S2：连续 5 次 GET /api/health 并记录耗时', async () => {
    const costs = [];
    for (let i = 0; i < ROUNDS; i++) {
      const t0 = Date.now();
      const r = await api.get('/api/health');
      const ms = Date.now() - t0;
      costs.push(ms);
      expect(r.status, `[E2] 第 ${i + 1} 次返回 200`).toBe(200);
      expect(r.body, `[E2] 第 ${i + 1} 次 version="1.0.0"、pageCount=10`).toMatchObject({ version: '1.0.0', pageCount: 10 });
      expect(ms, `[E3] 第 ${i + 1} 次耗时 < ${TIMEOUT_MS} ms`).toBeLessThan(TIMEOUT_MS);
    }
    evidence.metric('health.maxMs', Math.max(...costs), 'ms');
  });
});
