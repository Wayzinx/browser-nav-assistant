import { test, expect } from '../fixtures/api.mjs';

const PATHS = ['/api/pages/manual', '/api/pages/important'];
const MALFORMED_JSON = '{bad';
const PERSISTENT_FIELDS = [
  'id', 'url', 'normalizedUrl', 'title', 'visitCount', 'lastVisitedAt', 'firstSeenAt',
  'sources', 'isOpen', 'isActive', 'isImportant',
];
const persistentPages = (pages) => pages.map((page) =>
  Object.fromEntries(PERSISTENT_FIELDS.map((field) => [field, page[field]])))
  .sort((a, b) => a.normalizedUrl.localeCompare(b.normalizedUrl));

test.use({ autoReset: false });

for (const path of PATHS) {
  test(`TC-API-MENU-009 ${path} 原始畸形 JSON 返回 INVALID_JSON 且无副作用`, async ({ api }) => {
    const before = await test.step('S1：重置、同步并保存十页持久状态和健康基线', async () => {
      const reset = await api.reset();
      expect(reset.status, '[E4] reset 返回 200').toBe(200);
      expect(reset.body.ok, '[E4] reset.ok=true').toBe(true);
      const { res } = await api.loadSample();
      expect(res.status, '[E4] sync 返回 200').toBe(200);
      expect(res.body, '[E4] 样例初始化成功且有 10 页').toMatchObject({ ok: true, pageCount: 10 });
      expect(res.body.syncedAt, '[E4] syncedAt 为毫秒时间戳').toEqual(expect.any(Number));
      const T = res.body.syncedAt;
      const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: T } });
      expect(ranked.status, '[E3] 初始 ranked 返回 200').toBe(200);
      expect(ranked.body.total, '[E2] 初始 total=10').toBe(10);
      expect(ranked.body.pages, '[E3] 基线包含完整十页').toHaveLength(10);
      for (const page of ranked.body.pages) {
        expect(Object.keys(page), '[E3] 基线页面包含全部持久字段').toEqual(expect.arrayContaining(PERSISTENT_FIELDS));
      }
      const health = await api.get('/api/health');
      expect(health.status, '[E2] 初始 health 返回 200').toBe(200);
      expect(health.body, '[E2] 初始健康计数和同步时间正确').toMatchObject({
        pageCount: 10, lastSyncAt: T, ruleCount: 0,
      });
      return { T, pages: persistentPages(ranked.body.pages), lastSyncAt: health.body.lastSyncAt, ruleCount: health.body.ruleCount };
    });

    await test.step('S2：发送原始 UTF-8 字节 {bad，不进行 JSON 编码', async () => {
      const response = await api.raw('POST', path, MALFORMED_JSON, 'application/json');
      expect(response.status, '[E1] 畸形 JSON 返回 400').toBe(400);
      expect(response.body.error.code, '[E1] 错误码为 INVALID_JSON').toBe('INVALID_JSON');
      expect(response.body.error.message, '[E1] 错误消息为非空字符串').toMatch(/\S/);
    });

    await test.step('S3：读回完整页面和健康状态，确认没有副作用', async () => {
      const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: before.T } });
      expect(ranked.status, '[E2] 最终 ranked 返回 200').toBe(200);
      expect(ranked.body.total, '[E2] 最终 total=10').toBe(10);
      expect(ranked.body.pages, '[E3] 最终仍有十页').toHaveLength(10);
      expect(persistentPages(ranked.body.pages), '[E3] 原十页的全部持久字段逐页不变').toStrictEqual(before.pages);
      const health = await api.get('/api/health');
      expect(health.status, '[E2] 最终 health 返回 200').toBe(200);
      expect(health.body, '[E2] 页数、同步时间和规则数均未改变').toMatchObject({
        pageCount: 10, lastSyncAt: before.lastSyncAt, ruleCount: before.ruleCount,
      });
    });
  });
}
