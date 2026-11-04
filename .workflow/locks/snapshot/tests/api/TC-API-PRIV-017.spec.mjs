import fs from 'node:fs';
import { test, expect } from '../fixtures/api.mjs';

test('TC-API-PRIV-017 含敏感 URL 的非法 JSON 不在错误响应或日志中泄漏 URL', async ({ api }) => {
  await test.step('S1：POST /api/__test__/reset', () => api.reset());

  const { logFile, offset } = await test.step('S2：记录 LOG_FILE 当前字节长度', async () => {
    const logFile = process.env.SERVER_LOG_FILE;
    expect(logFile, '[E3] 已配置真实后端日志文件').toMatch(/\S/);
    return { logFile, offset: fs.statSync(logFile).size };
  });

  const reqId = await test.step('S3：POST /api/sync 原样发送含敏感 URL 的截断 JSON', async () => {
    const r = await api.raw('POST', '/api/sync', '{"history":[{"url":"https://example.com/reset?token=abc"', 'application/json');
    expect(r.status, '[E1] 非法 JSON 返回 400').toBe(400);
    expect(r.body.error.code, '[E1] 错误码为 INVALID_JSON').toBe('INVALID_JSON');
    expect(r.body.error.message, '[E1] 错误信息为非空字符串').toMatch(/\S/);
    expect(JSON.stringify(r.body), '[E2] 错误响应不回显敏感 URL').not.toContain('reset?token=abc');
    expect(JSON.stringify(r.body), '[E2] 错误响应不回显 token 值').not.toContain('token=abc');
    return r.reqId;
  });

  await test.step('S4：按字节偏移读取请求期间新增日志', async () => {
    const text = fs.readFileSync(logFile).subarray(offset).toString('utf8');
    expect(text, '[E3] 本次失败请求产生了新增日志').toMatch(/\S/);
    expect(text, '[E3] 新增日志不回显敏感 URL').not.toContain('reset?token=abc');
    expect(text, '[E3] 新增日志不回显 token 值').not.toContain('token=abc');
    const entries = text.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
    expect(entries, '[E3] 新增日志包含本次真实请求的记录').toContainEqual(expect.objectContaining({
      reqId, method: 'POST', path: '/api/sync', status: 400,
    }));
  });

  await test.step('S5：GET /api/health 验证非法请求无数据写入', async () => {
    const r = await api.get('/api/health');
    expect(r.status, '[E4] 健康检查返回 200').toBe(200);
    expect(r.body.pageCount, '[E4] 页面总数仍为零').toBe(0);
  });
});
