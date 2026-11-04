// 来源：docs/trace/cases-api.json TC-API-DIAG-007（F-DIAG-01#AC1, F-DIAG-09#AC1；C-BE-CORE-03, C-BE-DIAG-01）
import { test, expect } from '../fixtures/api.mjs';

const EXT_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const EVIL_ORIGIN = 'https://evil.example.com';
const REQ_ID = 'diag-007-req';

test('TC-API-DIAG-007 health 的 CORS 与请求 ID：chrome-extension 来源被放行并回传 x-request-id，其他来源不返回 Allow-Origin', async ({ api }) => {
  await test.step('S1：GET /api/health，Origin=chrome-extension、x-request-id=diag-007-req', async () => {
    const r = await api.get('/api/health', { headers: { origin: EXT_ORIGIN, 'x-request-id': REQ_ID } });
    expect(r.status, '[E1] 返回 200').toBe(200);
    expect(r.headers['access-control-allow-origin'], '[E1] Allow-Origin 回显插件来源').toBe(EXT_ORIGIN);
    expect(r.headers['x-request-id'], '[E2] x-request-id 原样回传').toBe(REQ_ID);
    expect(r.body.version, '[E2] version="1.0.0"').toBe('1.0.0');
  });

  await test.step('S2：OPTIONS /api/health 预检', async () => {
    const r = await api.call('OPTIONS', '/api/health', { headers: { origin: EXT_ORIGIN, 'access-control-request-method': 'GET' } });
    expect(r.status, '[E3] 预检返回 204').toBe(204);
    expect(r.headers['access-control-allow-methods'], '[E3] Allow-Methods 包含 GET').toMatch(/\bGET\b/);
  });

  await test.step('S3：GET /api/health，Origin=https://evil.example.com', async () => {
    const r = await api.get('/api/health', { headers: { origin: EVIL_ORIGIN } });
    expect(r.headers['access-control-allow-origin'], '[E4] 非白名单来源不返回 Allow-Origin').toBeUndefined();
  });
});
