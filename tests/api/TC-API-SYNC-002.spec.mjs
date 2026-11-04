import { test, expect } from '../fixtures/api.mjs';

const A = 'https://github.com/org/repo/pull/456';
const B = 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API';

test('TC-API-SYNC-002 系统页已跳过的上下文只保存普通页面', async ({ api, evidence }) => {
  await test.step('S1：清空后端状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });
  const raw = await test.step('S2：保存实际发送的上下文 JSON 字节', async () => {
    const raw = JSON.stringify({ activeTab: null, openTabs: [{ url: A }, { url: B }], history: [] });
    evidence.note(`实际请求体：${raw}`);
    return raw;
  });
  const r = await test.step('S3：原样发送已在采集侧跳过系统页的上下文', async () => {
    const r = await api.raw('POST', '/api/sync', raw);
    const sent = JSON.parse(raw);
    expect(Object.keys(sent).sort(), '[E2] 发送 JSON 包含三个上下文字段').toEqual(['activeTab', 'history', 'openTabs']);
    expect(sent.activeTab, '[E2] 当前系统页在请求中为 null').toBeNull();
    expect([...sent.openTabs, ...sent.history].filter((p) => p.url.startsWith('chrome://')), '[E2] 三处记录均无系统 URL').toHaveLength(0);
    expect(r.status, '[E3] 同步返回 200').toBe(200);
    expect(r.body, '[E3] 两条普通观测各创建一页').toMatchObject({ received: 2, created: 2, updated: 0, rejected: 0, pageCount: 2 });
    return r;
  });
  await test.step('S4：回读页面和健康状态', async () => {
    const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: r.body.syncedAt } });
    const health = await api.get('/api/health');
    expect(ranked.status, '[E4] ranked 返回 200').toBe(200);
    expect(ranked.body.total, '[E4] 总数为 2').toBe(2);
    expect(ranked.body.pages.map((p) => p.url).sort(), '[E4] 恰为两条普通页面').toEqual([A, B].sort());
    expect(ranked.body.pages.map((p) => ({ isOpen: p.isOpen, isActive: p.isActive })), '[E4] 两页均打开但未激活').toEqual([{ isOpen: true, isActive: false }, { isOpen: true, isActive: false }]);
    expect(health.status, '[E5] health 返回 200').toBe(200);
    expect(health.body.pageCount, '[E5] 后端仅保存两页').toBe(2);
    expect(ranked.body.pages.filter((p) => p.url.startsWith('chrome://')), '[E5] 后端不存在系统页').toHaveLength(0);
  });
});
