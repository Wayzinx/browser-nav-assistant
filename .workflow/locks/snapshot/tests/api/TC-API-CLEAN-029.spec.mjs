import { test, expect, samplePayload } from '../fixtures/api.mjs';

const ISSUE = 'https://github.com/org/repo/issues/100';

test('TC-API-CLEAN-029 错误媒体类型和截断 JSON 不归档页面', async ({ api }) => {
  const now = Date.now();
  await test.step('S1：同步平移后的样例', () => api.seed(samplePayload({ now })));
  await test.step('S2：使用 text/plain 发送合法 JSON 文本', async () => {
    const r = await api.raw('POST', '/api/pages/archive', JSON.stringify({ urls: [ISSUE] }), 'text/plain');
    expect(r.status, '[E1] 错误媒体类型返回 415').toBe(415);
    expect(r.body.error.code, '[E1] 错误码为 UNSUPPORTED_MEDIA_TYPE').toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(r.body.error.message, '[E1] 错误说明非空').toMatch(/\S/);
  });
  await test.step('S3：使用 application/json 发送截断 JSON', async () => {
    const r = await api.raw('POST', '/api/pages/archive', '{"urls":[', 'application/json');
    expect(r.status, '[E2] 非法 JSON 返回 400').toBe(400);
    expect(r.body.error.code, '[E2] 错误码为 INVALID_JSON').toBe('INVALID_JSON');
    expect(r.body.error.message, '[E2] 错误说明非空').toMatch(/\S/);
  });
  await test.step('S4：回读整理建议确认未发生归档', async () => {
    const r = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
    expect(r.status, '[E3] 返回 200').toBe(200);
    expect(r.body.suggestions.find(s => s.action === 'archive' && s.url === ISSUE), '[E3] 旧 issue 仍为归档候选').toMatchObject({ url: ISSUE });
    expect(r.body.summary.archive, '[E3] 两条归档建议都未变化').toBe(2);
  });
});
