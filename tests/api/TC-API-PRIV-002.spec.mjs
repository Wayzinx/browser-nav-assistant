import fs from 'node:fs';
import { test, expect } from '../fixtures/api.mjs';

test('TC-API-PRIV-002 拒收日志只记录域名和计数，不泄漏敏感 URL', async ({ api }) => {
  await test.step('S1：POST /api/__test__/reset', () => api.reset());

  const { logFile, offset } = await test.step('S2：记录 LOG_FILE 当前字节长度', async () => {
    const logFile = process.env.SERVER_LOG_FILE;
    expect(logFile, '[E2] 已配置真实后端日志文件').toMatch(/\S/);
    return { logFile, offset: fs.statSync(logFile).size };
  });

  const reqId = await test.step('S3：POST /api/sync 提交含 token 的历史', async () => {
    const r = await api.post('/api/sync', {
      history: [{
        url: 'https://example.com/reset?token=abc', title: 't',
        lastVisitTime: Date.now() - 60 * 60 * 1000, visitCount: 1,
      }],
    });
    expect(r.status, '[E1] 同步返回 200').toBe(200);
    expect(r.body, '[E1] 拒收一条敏感记录').toMatchObject({ rejected: 1, rejectedByReason: { privacy: 1 } });
    return r.reqId;
  });

  await test.step('S4：按字节偏移读取新增日志并逐行解析 JSON', async () => {
    const text = fs.readFileSync(logFile).subarray(offset).toString('utf8');
    expect(text, '[E2] 本次同步产生了新增日志').toMatch(/\S/);
    expect(text, '[E2] 日志不包含敏感路径和查询串').not.toContain('reset?token=abc');
    expect(text, '[E2] 日志不包含 token 值').not.toContain('token=abc');
    const entries = text.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
    const completed = entries.find((entry) => entry.msg === 'sync done' && entry.reqId === reqId);
    expect(completed, '[E3] 本次请求的同步日志只给出拒收域名和计数').toMatchObject({
      msg: 'sync done', reqId, rejected: 1,
      rejectedByReason: { privacy: 1 }, rejectedDomains: { 'example.com': 1 },
    });
  });
});
