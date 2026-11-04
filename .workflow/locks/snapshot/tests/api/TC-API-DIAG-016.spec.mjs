// 来源：docs/trace/cases-api.json TC-API-DIAG-016（F-DIAG-10#AC1；C-BE-DIAG-02, C-BE-CORE-02）
import { test, expect } from '../fixtures/api.mjs';

const DEFAULT_KEYWORDS = ['password', 'token', 'bank', 'secret'];

test('TC-API-DIAG-016 关闭隐私过滤后 GET /api/config 返回 enablePrivacyFilter=false，reset 后恢复全部默认配置', async ({ api }) => {
  await test.step('S1：PUT /api/config { enablePrivacyFilter: false, cleanupThresholdDays: 30 }', async () => {
    const r = await api.put('/api/config', { enablePrivacyFilter: false, cleanupThresholdDays: 30 });
    expect(r.status, '[E1] 返回 200').toBe(200);
    expect(r.body.enablePrivacyFilter, '[E1] enablePrivacyFilter=false').toBe(false);
  });

  await test.step('S2：GET /api/config', async () => {
    const r = await api.get('/api/config');
    expect(r.body, '[E2] 覆盖值生效').toMatchObject({ enablePrivacyFilter: false, cleanupThresholdDays: 30 });
    expect(r.body.privacySensitiveKeywords, '[E2] 关键词仍为默认 4 个').toEqual(DEFAULT_KEYWORDS);
  });

  await test.step('S3：POST /api/__test__/reset', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E3] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E3] body.ok=true').toBe(true);
  });

  await test.step('S4：GET /api/config', async () => {
    const r = await api.get('/api/config');
    expect(r.body, '[E4] reset 后恢复默认配置').toMatchObject({ enablePrivacyFilter: true, cleanupThresholdDays: 14, maxHistoryItems: 100 });
  });
});
