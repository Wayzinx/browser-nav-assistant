import { test, expect } from '../fixtures/api.mjs';

const PATHS = ['/api/pages/manual', '/api/pages/important'];
const NOTE = 'https://example.com/media-type-note';
const RAW_BODY = '{"url":"https://example.com/media-type-note","important":true}';
const PERSISTENT_FIELDS = [
  'id', 'url', 'normalizedUrl', 'title', 'visitCount', 'lastVisitedAt', 'firstSeenAt',
  'sources', 'isOpen', 'isActive', 'isImportant',
];
const persistentPages = (pages) => pages.map((page) =>
  Object.fromEntries(PERSISTENT_FIELDS.map((field) => [field, page[field]])))
  .sort((a, b) => a.normalizedUrl.localeCompare(b.normalizedUrl));

test.use({ autoReset: false });

for (const path of PATHS) {
  test(`TC-API-MENU-010 ${path} text/plain 返回 415 且不写入页面`, async ({ api }) => {
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
      expect(health.status, '[E3] 初始 health 返回 200').toBe(200);
      expect(health.body, '[E3] 初始健康计数和同步时间正确').toMatchObject({
        pageCount: 10, lastSyncAt: T, ruleCount: 0,
      });
      return { T, pages: persistentPages(ranked.body.pages), lastSyncAt: health.body.lastSyncAt, ruleCount: health.body.ruleCount };
    });

    await test.step('S2：以 text/plain 发送内容合法的原始 JSON 请求体', async () => {
      const response = await api.raw('POST', path, RAW_BODY, 'text/plain');
      expect(response.status, '[E1] 错误媒体类型返回 415').toBe(415);
      expect(response.body.error.code, '[E1] 错误码为 UNSUPPORTED_MEDIA_TYPE').toBe('UNSUPPORTED_MEDIA_TYPE');
      expect(response.body.error.message, '[E1] 错误消息为非空字符串').toMatch(/\S/);
    });

    await test.step('S3：确认目标 URL 未落库且原页面和健康状态不变', async () => {
      const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: before.T } });
      expect(ranked.status, '[E2] 最终 ranked 返回 200').toBe(200);
      expect(ranked.body.total, '[E2] 最终 total=10').toBe(10);
      expect(ranked.body.pages, '[E3] 最终仍有十页').toHaveLength(10);
      const urls = ranked.body.pages.map((page) => page.normalizedUrl);
      expect(urls, '[E2] 错误媒体类型请求的目标页面未落库').not.toContain(NOTE);
      expect(persistentPages(ranked.body.pages), '[E3] 原十页的全部持久字段逐页不变').toStrictEqual(before.pages);
      const health = await api.get('/api/health');
      expect(health.status, '[E2] 最终 health 返回 200').toBe(200);
      expect(health.body.pageCount, '[E2] health.pageCount=10').toBe(10);
      expect(health.body, '[E3] 同步时间和规则数均未改变').toMatchObject({
        lastSyncAt: before.lastSyncAt, ruleCount: before.ruleCount,
      });
    });
  });
}
