// 来源：docs/trace/cases-api.json TC-API-DIAG-015（F-DIAG-10#AC1；C-BE-DIAG-02, C-BE-CORE-02）
// 规则 id 从 S1 响应中取，不写死。
import { test, expect } from '../fixtures/api.mjs';

const DEFAULT_KEYWORDS = ['password', 'token', 'bank', 'secret'];
const PRIVACY_RULE = { rawText: '不要上传包含 cookie 的 URL', type: 'privacy_filter', action: 'exclude_upload', keywords: ['cookie'] };

test('TC-API-DIAG-015 保存 privacy_filter 规则后 privacySensitiveKeywords 合并 cookie、baseSensitiveKeywords 不变；删除规则后恢复 4 个默认词', async ({ api }) => {
  const ruleId = await test.step('S1：POST /api/rules 保存 privacy_filter 规则，记录 id 为 R', async () => {
    const r = await api.post('/api/rules', { rules: [PRIVACY_RULE] });
    expect(r.status, '[E1] 保存返回 201').toBe(201);
    expect(r.body.rules[0].type, '[E1] rules[0].type=privacy_filter').toBe('privacy_filter');
    expect(r.body.ruleCount, '[E1] ruleCount=1').toBe(1);
    return r.body.rules[0].id;
  });

  await test.step('S2：GET /api/config', async () => {
    const r = await api.get('/api/config');
    expect([...r.body.privacySensitiveKeywords].sort(), '[E2] 有效关键词为默认 4 个加 cookie，共 5 项')
      .toEqual([...DEFAULT_KEYWORDS, 'cookie'].sort());
    expect(r.body.baseSensitiveKeywords, '[E3] baseSensitiveKeywords 不变').toEqual(DEFAULT_KEYWORDS);
  });

  await test.step('S3：DELETE /api/rules/<R>', async () => {
    const r = await api.del(`/api/rules/${ruleId}`);
    expect(r.status, '[E4] 删除返回 200').toBe(200);
    expect(r.body.deleted, '[E4] deleted=R').toBe(ruleId);
  });

  await test.step('S4：GET /api/config', async () => {
    const r = await api.get('/api/config');
    expect(r.body.privacySensitiveKeywords, '[E5] 恢复为 4 个默认词').toEqual(DEFAULT_KEYWORDS);
    expect(r.body.privacySensitiveKeywords, '[E5] 不再包含 cookie').not.toContain('cookie');
  });
});
