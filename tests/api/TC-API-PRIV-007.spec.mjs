import { test, expect } from '../fixtures/api.mjs';

const DEFAULT_KEYWORDS = ['password', 'token', 'bank', 'secret'];

test('TC-API-PRIV-007 保存 cookie 规则后合并关键词，基础配置保持不变', async ({ api }) => {
  await test.step('S1：POST /api/__test__/reset', () => api.reset());

  await test.step('S2：GET /api/config 核对默认关键词', async () => {
    const r = await api.get('/api/config');
    expect(r.status, '[E1] 配置查询返回 200').toBe(200);
    expect(r.body.privacySensitiveKeywords, '[E1] 初始有效关键词严格为四个默认词').toStrictEqual(DEFAULT_KEYWORDS);
  });

  await test.step('S3：POST /api/rules 保存 cookie 隐私规则', async () => {
    const r = await api.post('/api/rules', {
      rules: [{
        rawText: '不要上传包含 cookie 的 URL', type: 'privacy_filter',
        keywords: ['cookie'], action: 'exclude_upload',
      }],
    });
    expect(r.status, '[E2] 保存规则返回 201').toBe(201);
    expect(r.body.ruleCount, '[E2] 共保存一条规则').toBe(1);
    expect(r.body.rules, '[E2] 本次返回一条规则').toHaveLength(1);
    expect(r.body.rules[0].type, '[E2] 保存的类型为 privacy_filter').toBe('privacy_filter');
    expect(r.body.rules[0].keywords, '[E2] 规则关键词只有 cookie').toStrictEqual(['cookie']);
  });

  await test.step('S4：GET /api/config 核对配置与规则关键词合并', async () => {
    const r = await api.get('/api/config');
    expect(r.status, '[E3] 配置查询返回 200').toBe(200);
    expect(r.body.privacySensitiveKeywords, '[E3] 有效关键词包含四个默认词和 cookie').toEqual(expect.arrayContaining([...DEFAULT_KEYWORDS, 'cookie']));
    expect(r.body.privacySensitiveKeywords, '[E3] 有效关键词共五项').toHaveLength(5);
    expect(r.body.baseSensitiveKeywords, '[E4] 基础配置仍为四个默认词，不包含规则关键词').toStrictEqual(DEFAULT_KEYWORDS);
  });
});
