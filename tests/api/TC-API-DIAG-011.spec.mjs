// 来源：docs/trace/cases-api.json TC-API-DIAG-011（F-DIAG-10#AC2；C-BE-DIAG-02, C-BE-CORE-02）
import { test, expect } from '../fixtures/api.mjs';

const WEIGHTS = { recency: 0.4, frequency: 0.3, open: 0.2, domain: 0.1 };
const LIMITS = { maxItemsPerSync: 500, maxUrlLength: 2048, maxRuleTextLength: 500, maxBodyBytes: 1048576 };

test('TC-API-DIAG-011 GET /api/config 扩展字段：historyLookbackDays=30、半衰期 7、四项权重、推荐下限 0.3、apiVersion="1" 和 4 项 limits', async ({ api }) => {
  await test.step('S1：GET /api/config', async () => {
    const r = await api.get('/api/config');
    expect(r.status, '[E1] 返回 200').toBe(200);
    expect(r.body, '[E1] historyLookbackDays=30、recencyHalfLifeDays=7').toMatchObject({ historyLookbackDays: 30, recencyHalfLifeDays: 7 });
    expect(r.body.weights, '[E2] weights 深度相等').toEqual(WEIGHTS);
    expect(r.body.minRecommendationScore, '[E3] minRecommendationScore=0.3').toBe(0.3);
    expect(r.body.apiVersion, '[E4] apiVersion 为字符串 "1"').toBe('1');
    expect(r.body.limits, '[E5] limits 深度相等（只有 4 项）').toEqual(LIMITS);
    expect(Object.keys(r.body.limits), '[E5] limits 不含 maxArrayItems').not.toContain('maxArrayItems');
  });
});
