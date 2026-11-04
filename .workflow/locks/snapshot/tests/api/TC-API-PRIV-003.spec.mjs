import { test, expect } from '../fixtures/api.mjs';

test('TC-API-PRIV-003 三种来源均过滤敏感 URL，大写 TOKEN 也被拒收', async ({ api }) => {
  await test.step('S1：POST /api/__test__/reset', () => api.reset());

  await test.step('S2：POST /api/sync 提交三种来源的五条记录', async () => {
    const lastVisitTime = Date.now() - 60 * 60 * 1000;
    const r = await api.post('/api/sync', {
      activeTab: { url: 'https://accounts.example.com/reset-password?token=8f2a91c', title: 'reset' },
      openTabs: [
        { url: 'https://bank.example.com/account/overview', title: 'account' },
        { url: 'https://example.com/login?TOKEN=abc', title: 'login' },
      ],
      history: [
        { url: 'https://example.com/?secret=1', title: 'private', lastVisitTime, visitCount: 1 },
        { url: 'https://example.com/priv-ok', title: 'normal', lastVisitTime, visitCount: 1 },
      ],
    });
    expect(r.status, '[E1] 同步返回 200').toBe(200);
    expect(r.body, '[E1] 五条中拒收四条，仅创建一页').toMatchObject({
      received: 5, rejected: 4, created: 1, pageCount: 1,
    });
    expect(r.body.rejectedByReason, '[E2] 四条拒收全部来自隐私过滤').toStrictEqual({ invalid_url: 0, privacy: 4 });
  });

  await test.step('S3：GET /api/pages/ranked', async () => {
    const r = await api.get('/api/pages/ranked');
    expect(r.status, '[E3] 排序接口返回 200').toBe(200);
    expect(r.body.total, '[E3] 排序总数为一').toBe(1);
    expect(r.body.pages.map((page) => page.url), '[E3] 只有普通 URL 入库').toStrictEqual(['https://example.com/priv-ok']);
    expect(r.body.pages.filter((page) => /password|token|bank|secret/i.test(page.url)), '[E4] 所有敏感关键词均未进入排序结果').toStrictEqual([]);
  });

  await test.step('S4：GET /api/health', async () => {
    const r = await api.get('/api/health');
    expect(r.status, '[E5] 健康检查返回 200').toBe(200);
    expect(r.body.pageCount, '[E5] 后端仅保存普通页面').toBe(1);
  });
});
