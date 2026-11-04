// 来源：docs/trace/cases-api.json TC-API-DIAG-008（F-DIAG-01#AC2, AC3, F-DIAG-09#AC1；C-BE-DIAG-01）
// 不可达地址用 http://127.0.0.1:9（无服务端口），不 route、不 mock。
// S1 走 api 夹具发绝对地址：连接被拒绝时 Playwright 直接抛错（没有 HTTP 状态码），把异常 message 转成值再断言，不用 try/catch。
import { test, expect } from '../fixtures/api.mjs';

const UNREACHABLE = 'http://127.0.0.1:9/api/health';

test('TC-API-DIAG-008 地址指向没有服务的端口时请求被拒绝（ECONNREFUSED）；改回测试后端地址后 health 立即恢复 200', async ({ api, evidence }) => {
  await test.step('S1：GET http://127.0.0.1:9/api/health，捕获异常', async () => {
    evidence.note(`S1 请求不可达地址 ${UNREACHABLE}，期望 ECONNREFUSED`);
    // 成功拿到响应时得到 HTTP <status>，断言会失败；被拒绝时得到异常 message
    const outcome = await api.get(UNREACHABLE).then((r) => `HTTP ${r.status}`, (err) => String(err && err.message));
    evidence.note(`S1 结果：${outcome.slice(0, 300)}`);
    expect(outcome, '[E1] 没有 HTTP 状态码，异常 message 包含 ECONNREFUSED').toMatch(/ECONNREFUSED/);
    expect(outcome, '[E1] 没有拿到 HTTP 响应').not.toMatch(/^HTTP \d+/);
  });

  await test.step('S2：GET 测试后端 /api/health', async () => {
    const r = await api.get('/api/health');
    expect(r.status, '[E2] 返回 200').toBe(200);
    expect(r.body, '[E2] status="ok"、version="1.0.0"').toMatchObject({ status: 'ok', version: '1.0.0' });
    expect(r.body, '[E3] pageCount=0、ruleCount=0').toMatchObject({ pageCount: 0, ruleCount: 0 });
  });
});
