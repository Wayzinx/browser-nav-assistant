import { readFile, stat } from 'node:fs/promises';
import { test, expect } from '../fixtures/api.mjs';

const A = 'https://github.com/org/repo/pull/456';
const B = 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API';

test('TC-API-SYNC-001 一次上下文上报接收三个字段并保存两页', async ({ api }, testInfo) => {
  await test.step('S1：清空后端状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });

  const { payload, logFile, offset } = await test.step('S2：记录服务端日志偏移并构造三个上下文字段', async () => {
    const port = new URL(testInfo.project.use.baseURL).port;
    const logFile = process.env.LOG_FILE || `evidence/_runtime/server-${port}.log`;
    const offset = (await stat(logFile)).size;
    const payload = { activeTab: { url: A, title: 'Pull request' }, openTabs: [{ url: A }, { url: B }], history: [] };
    expect(Object.keys(payload).sort(), '[E2] 上传包含三个上下文字段').toEqual(['activeTab', 'history', 'openTabs']);
    return { payload, logFile, offset };
  });

  const r = await test.step('S3：只发送一次同步请求', async () => {
    const r = await api.post('/api/sync', payload);
    expect(r.status, '[E2] 同步返回 200').toBe(200);
    expect(r.body, '[E2] 同步成功且默认为 full').toMatchObject({ ok: true, mode: 'full' });
    expect(r.body, '[E3] 三次观测合并为两页').toMatchObject({ received: 3, created: 2, updated: 1, rejected: 0, pageCount: 2 });
    return r;
  });

  await test.step('S4：回读页面、健康状态和本次服务端访问日志', async () => {
    const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: r.body.syncedAt } });
    const health = await api.get('/api/health');
    expect(ranked.status, '[E4] ranked 返回 200').toBe(200);
    expect(ranked.body.total, '[E4] 共两页').toBe(2);
    expect(ranked.body.pages.map((p) => p.url).sort(), '[E4] URL 集合恰为两条普通页面').toEqual([A, B].sort());
    const log = (await readFile(logFile)).subarray(offset).toString('utf8');
    const records = log.trim().split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
    const sync = records.filter((entry) => entry.method === 'POST' && entry.path === '/api/sync');
    expect(sync, '[E5] 服务端同步区间只收到一次 POST /api/sync').toHaveLength(1);
    expect(sync[0].reqId, '[E5] 服务端记录对应本次真实请求 ID').toBe(r.reqId);
    expect(health.status, '[E6] health 返回 200').toBe(200);
    expect(health.body, '[E6] 页面数和同步时间与本次响应一致').toMatchObject({ pageCount: 2, lastSyncAt: r.body.syncedAt });
  });
});
