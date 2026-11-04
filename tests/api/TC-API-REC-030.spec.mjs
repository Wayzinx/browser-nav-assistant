// 来源：docs/trace/cases/API-REC.json；REC API，独立真实 HTTP 用例。
import { test, expect, samplePayload } from '../fixtures/api.mjs';

// S1 显式发送 JSON 重置请求，替代夹具在步骤外的自动重置。
test.use({ autoReset: false });

test("TC-API-REC-030 openTabs 和 recentHistory 各自在500条被接受而501条被拒绝", async ({ api, evidence }) => {
  await test.step('S1：POST /api/__test__/reset，以 JSON 空对象重置数据与缓存', async () => {
    const r = await api.post('/api/__test__/reset', {}, { setup: true });
    expect(r.status, 'S1 重置返回 200').toBe(200);
    expect(r.body, 'S1 重置成功').toMatchObject({ ok: true });
  });

  const { payload, N } = await test.step('S2：按 D-01 平移样例并真实同步，记录 syncedAt 为 N', async () => {
    const T = Date.now();
    const payload = samplePayload({ now: T });
    const r = await api.seed(payload);
    expect(r.status, 'S2 同步返回 200').toBe(200);
    expect(r.body, 'S2 同步样例的完整计数').toMatchObject({
      received: 14, created: 10, updated: 4, rejected: 0, pageCount: 10,
    });
    expect(r.body.syncedAt, 'S2 后端生成毫秒时间基准').toEqual(expect.any(Number));
    evidence.note(JSON.stringify({ T, N: r.body.syncedAt }));
    return { payload, N: r.body.syncedAt };
  });

  const { bodyA, bodyB } = await test.step('S3：分别发送 500 条 openTabs 和 500 条 recentHistory', async () => {
    const bodyA = {
      currentPage: payload.activeTab,
      openTabs: [...payload.openTabs, ...Array.from({ length: 497 }, (_, i) => ({ url: 'https://pad.example.org/tab/' + i }))],
      recentHistory: [],
    };
    const bodyB = {
      currentPage: payload.activeTab, openTabs: payload.openTabs,
      recentHistory: Array.from({ length: 500 }, (_, i) => ({
        url: 'https://pad.example.org/history/' + i, lastVisitTime: N - 300000 - i * 1000,
      })),
    };
    expect(bodyA.openTabs, 'S3 A 仅 openTabs 达到 500 条').toHaveLength(500);
    expect(bodyB.recentHistory, 'S3 B 仅 recentHistory 达到 500 条').toHaveLength(500);
    for (const [label, body] of [['A openTabs=500', bodyA], ['B recentHistory=500', bodyB]]) {
      expect(Buffer.byteLength(JSON.stringify(body), 'utf8'), 'S3 请求正文远小于 1MiB').toBeLessThan(1048576);
      const r = await api.post('/api/recommendations/next', body, { params: { now: N } });
      expect(r.status, '[E1] ' + label + ' 返回 200').toBe(200);
      expect(r.body.recommendations.map(p => [p.url, p.score]), '[E1] ' + label + ' 保持精确三条样例推荐').toEqual([
        ['https://github.com/org/repo/actions', 0.87],
        ['https://react.dev/reference/react/useState', 0.46],
        ['https://react.dev/learn', 0.41],
      ]);
    }
    return { bodyA, bodyB };
  });
  await test.step('S4：分别把两个数组扩展到 501 条，单独检验上限', async () => {
    const variants = [
      ['A openTabs=501', { ...bodyA, openTabs: [...bodyA.openTabs, { url: 'https://pad.example.org/tab/497' }] }],
      ['B recentHistory=501', { ...bodyB, recentHistory: [
        ...bodyB.recentHistory, { url: 'https://pad.example.org/history/500', lastVisitTime: N - 800000 },
      ] }],
    ];
    for (const [label, body] of variants) {
      expect(Buffer.byteLength(JSON.stringify(body), 'utf8'), 'S4 数组越界请求仍小于正文上限').toBeLessThan(1048576);
      const r = await api.post('/api/recommendations/next', body, { params: { now: N } });
      expect(r.status, '[E2] ' + label + ' 返回 413').toBe(413);
      expect(r.body.error.code, '[E2] ' + label + ' 使用 PAYLOAD_TOO_LARGE').toBe('PAYLOAD_TOO_LARGE');
      expect(r.body.error.message, '[E2] ' + label + ' 有非空错误消息').toMatch(/\S/);
    }
  });

  await test.step('S5：GET /api/health，读回计数并核对查询没有写入副作用', async () => {
    const r = await api.get('/api/health');
    expect(r.status, '[E3] 健康检查返回 200').toBe(200);
    expect(r.body, '[E3] 页面、规则及同步状态保持预期').toMatchObject({ pageCount: 10, ruleCount: 0, lastSyncAt: N });
  });
});
