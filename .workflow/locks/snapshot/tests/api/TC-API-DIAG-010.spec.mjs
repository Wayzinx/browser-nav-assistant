// 来源：docs/trace/cases-api.json TC-API-DIAG-010（F-DIAG-10#AC1；C-BE-DIAG-02, C-BE-CORE-02）
import { test, expect } from '../fixtures/api.mjs';

const DEFAULT_KEYWORDS = ['password', 'token', 'bank', 'secret'];

test('TC-API-DIAG-010 默认配置下 GET /api/config 返回 cleanupThresholdDays=14、maxHistoryItems=100、隐私过滤开启和 4 个默认关键词', async ({ api }) => {
  await test.step('S1：GET /api/config', async () => {
    const r = await api.get('/api/config');
    expect(r.status, '[E1] 返回 200').toBe(200);
    expect(r.headers['content-type'], '[E1] content-type 包含 application/json').toContain('application/json');
    expect(r.body, '[E2] cleanupThresholdDays=14、maxHistoryItems=100').toMatchObject({ cleanupThresholdDays: 14, maxHistoryItems: 100 });
    expect(r.body.enablePrivacyFilter, '[E3] enablePrivacyFilter=true').toBe(true);
    expect(r.body.privacySensitiveKeywords, '[E4] 有效关键词为 4 个默认词（顺序一致）').toEqual(DEFAULT_KEYWORDS);
    expect(r.body.baseSensitiveKeywords, '[E5] 配置关键词为 4 个默认词').toEqual(DEFAULT_KEYWORDS);
  });
});
