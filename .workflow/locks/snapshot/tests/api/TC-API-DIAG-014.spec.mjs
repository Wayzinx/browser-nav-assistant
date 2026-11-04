// 来源：docs/trace/cases-api.json TC-API-DIAG-014（F-DIAG-10#AC1；C-BE-DIAG-02, C-BE-CORE-02）
// 反例请求体用 api.raw 原样发送（否则会被再次 JSON 编码）。
import { test, expect } from '../fixtures/api.mjs';

const DEFAULT_KEYWORDS = ['password', 'token', 'bank', 'secret'];

test('TC-API-DIAG-014 PUT /api/config 请求体非法 JSON 或 Content-Type 错误时返回 400 / 415，GET /api/config 仍为默认值', async ({ api }) => {
  await test.step('S1：PUT /api/config，非法 JSON', async () => {
    const r = await api.raw('PUT', '/api/config', '{"enablePrivacyFilter": fal', 'application/json');
    expect(r.status, '[E1] 返回 400').toBe(400);
    expect(r.body.error.code, '[E1] error.code=INVALID_JSON').toBe('INVALID_JSON');
    expect(r.body.error.message, '[E1] error.message 非空').toMatch(/\S/);
  });

  await test.step('S2：PUT /api/config，Content-Type: text/plain', async () => {
    const r = await api.raw('PUT', '/api/config', 'enablePrivacyFilter=false', 'text/plain');
    expect(r.status, '[E2] 返回 415').toBe(415);
    expect(r.body.error.code, '[E2] error.code=UNSUPPORTED_MEDIA_TYPE').toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  await test.step('S3：GET /api/config', async () => {
    const r = await api.get('/api/config');
    expect(r.status, '[E3] 返回 200').toBe(200);
    expect(r.body.enablePrivacyFilter, '[E3] enablePrivacyFilter 仍为 true').toBe(true);
    expect(r.body.privacySensitiveKeywords, '[E3] 关键词仍为默认 4 个').toEqual(DEFAULT_KEYWORDS);
    expect(r.body.cleanupThresholdDays, '[E3] cleanupThresholdDays 仍为 14').toBe(14);
  });
});
