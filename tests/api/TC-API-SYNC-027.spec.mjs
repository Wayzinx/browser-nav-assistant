import { test, expect } from '../fixtures/api.mjs';

const INVALID = [
  ['根节点 null', null],
  ['根节点数组', []],
  ['activeTab 字符串', { activeTab: 'bad' }],
  ['activeTab 数组', { activeTab: [] }],
  ['history 字符串', { history: 'bad' }],
  ['history 对象', { history: {} }],
  ['mode 非枚举字符串', { mode: 'invalid' }],
  ['mode 数字', { mode: 1 }],
];

test('TC-API-SYNC-027 八种非法类型均返回 400 且不写入页面', async ({ api }) => {
  await test.step('S1：清空后端状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });
  for (const [label, payload] of INVALID) {
    await test.step('S2：逐行重置并原样提交类型非法的 JSON', async () => {
      const reset = await api.post('/api/__test__/reset', {});
      expect(reset.status, `[E1] ${label} 前独立 reset 返回 200`).toBe(200);
      expect(reset.body.ok, `[E1] ${label} 前独立 reset 成功`).toBe(true);
      // raw 保留 JSON 的根节点类型，null 和 [] 不会被当作空请求体。
      const r = await api.raw('POST', '/api/sync', JSON.stringify(payload));
      expect(r.status, `[E2] ${label} 返回 400`).toBe(400);
      expect(r.body.error.code, `[E2] ${label} 错误码为 VALIDATION_FAILED`).toBe('VALIDATION_FAILED');
      expect(r.body.error.message, `[E2] ${label} 错误消息非空`).toMatch(/\S/);
    });
    await test.step('S3：逐行回读健康状态和页面集，确认无副作用', async () => {
      const health = await api.get('/api/health');
      const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: Date.now() } });
      expect(health.status, `[E3] ${label} 后 health 返回 200`).toBe(200);
      expect(health.body, `[E3] ${label} 后没有页面或同步时间`).toMatchObject({ pageCount: 0, lastSyncAt: null });
      expect(ranked.status, `[E4] ${label} 后 ranked 返回 200`).toBe(200);
      expect(ranked.body.total, `[E4] ${label} 后 total 为零`).toBe(0);
      expect(ranked.body.pages, `[E4] ${label} 后页面为空`).toEqual([]);
    });
  }
});
