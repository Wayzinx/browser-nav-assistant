import { test, expect } from '../fixtures/api.mjs';

const PATHS = ['/api/pages/manual', '/api/pages/important'];
const LENGTHS = [2048, 2049];
const PREFIX = 'https://example.com/';
const PERSISTENT_FIELDS = [
  'id', 'url', 'normalizedUrl', 'title', 'visitCount', 'lastVisitedAt', 'firstSeenAt',
  'sources', 'isOpen', 'isActive', 'isImportant',
];
const persistentPages = (pages) => pages.map((page) =>
  Object.fromEntries(PERSISTENT_FIELDS.map((field) => [field, page[field]])))
  .sort((a, b) => a.normalizedUrl.localeCompare(b.normalizedUrl));

test.use({ autoReset: false });

for (const path of PATHS) {
  for (const length of LENGTHS) {
    test(`TC-API-MENU-008 ${path} URL 长度边界 ${length} 字符`, async ({ api }) => {
      const before = await test.step('S1：为当前路径和长度重置、同步并保存基线', async () => {
        const reset = await api.reset();
        expect(reset.status, '[E6] reset 返回 200').toBe(200);
        expect(reset.body.ok, '[E6] reset.ok=true').toBe(true);
        const { res } = await api.loadSample();
        expect(res.status, '[E6] sync 返回 200').toBe(200);
        expect(res.body, '[E6] 样例初始化成功且有 10 页').toMatchObject({ ok: true, pageCount: 10 });
        expect(res.body.syncedAt, '[E6] syncedAt 为毫秒时间戳').toEqual(expect.any(Number));
        const T = res.body.syncedAt;
        const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: T } });
        expect(ranked.status, '[E5] 初始 ranked 返回 200').toBe(200);
        expect(ranked.body.total, '[E5] 初始 total=10').toBe(10);
        expect(ranked.body.pages, '[E5] 基线包含完整十页').toHaveLength(10);
        for (const page of ranked.body.pages) {
          expect(Object.keys(page), '[E5] 基线页面包含全部持久字段').toEqual(expect.arrayContaining(PERSISTENT_FIELDS));
        }
        const health = await api.get('/api/health');
        expect(health.status, '[E5] 初始 health 返回 200').toBe(200);
        expect(health.body, '[E5] 初始健康计数和同步时间正确').toMatchObject({
          pageCount: 10, lastSyncAt: T, ruleCount: 0,
        });
        return { T, pages: persistentPages(ranked.body.pages), lastSyncAt: health.body.lastSyncAt, ruleCount: health.body.ruleCount };
      });

      const body = await test.step('S2：构造并严格核对全 ASCII 边界 URL', async () => {
        const url = PREFIX + 'a'.repeat(length - PREFIX.length);
        if (length === 2048) {
          expect(url.length, '[E1] 合法边界输入恰为 2048 字符').toBe(2048);
        } else {
          expect(url.length, '[E4] 超限边界输入恰为 2049 字符').toBe(2049);
        }
        const payload = { url, title: 'URL length boundary' };
        if (path === '/api/pages/important') payload.important = true;
        return payload;
      });

      await test.step('S3：提交边界 URL 并核对接收或校验错误', async () => {
        const response = await api.post(path, body);
        if (length === 2048) {
          expect(response.status, '[E1] 2048 字符 URL 返回 200').toBe(200);
          expect(response.body, '[E1] 2048 字符 URL 被接收并新建页面').toMatchObject({
            accepted: true, rejected: 0, created: true,
          });
          if (path === '/api/pages/manual') {
            expect(response.body.pageCount, '[E3] manual 响应 pageCount=11').toBe(11);
          } else {
            expect(response.body.isImportant, '[E3] important 响应 isImportant=true').toBe(true);
          }
        } else {
          expect(response.status, '[E4] 2049 字符 URL 返回 400').toBe(400);
          expect(response.body.error.code, '[E4] 超限错误码为 VALIDATION_FAILED').toBe('VALIDATION_FAILED');
          expect(response.body.error.message, '[E4] 超限错误消息非空').toMatch(/\S/);
          expect(response.body.error.details.fields, '[E4] 超限错误字段包含 url').toContain('url');
        }
      });

      await test.step('S4：读回完整长 URL 或确认拒收没有副作用', async () => {
        const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: before.T } });
        const health = await api.get('/api/health');
        if (length === 2048) {
          expect(ranked.status, '[E2] 合法边界读回 ranked 返回 200').toBe(200);
          expect(ranked.body.total, '[E2] 合法边界 ranked.total=11').toBe(11);
          expect(ranked.body.pages, '[E2] 合法边界读回完整十一页').toHaveLength(11);
          const added = ranked.body.pages.filter((page) => page.normalizedUrl === body.url);
          expect(added, '[E2] 完整边界 URL 恰好一条').toHaveLength(1);
          expect(added[0].normalizedUrl, '[E2] normalizedUrl 等于完整提交 URL').toBe(body.url);
          expect(added[0].normalizedUrl.length, '[E2] 持久化 URL 未截断，仍为 2048 字符').toBe(2048);
          expect(added[0].sources, '[E2] 长 URL 页面含 manual 来源').toContain('manual');
          if (path === '/api/pages/important') {
            expect(added[0].isImportant, '[E3] important 新页面读回仍为重要').toBe(true);
          }
          expect(health.status, '[E2] 合法边界 health 返回 200').toBe(200);
          expect(health.body.pageCount, '[E2] 合法边界 health.pageCount=11').toBe(11);
        } else {
          expect(ranked.status, '[E5] 超限边界读回 ranked 返回 200').toBe(200);
          expect(ranked.body.total, '[E5] 拒收后 ranked.total=10').toBe(10);
          expect(ranked.body.pages, '[E5] 拒收后仍有十页').toHaveLength(10);
          const urls = ranked.body.pages.flatMap((page) => [page.url, page.normalizedUrl]);
          expect(urls, '[E5] 超限 URL 未落库').not.toContain(body.url);
          expect(persistentPages(ranked.body.pages), '[E5] 原十页的全部持久字段逐页不变').toStrictEqual(before.pages);
          expect(health.status, '[E5] 超限边界 health 返回 200').toBe(200);
          expect(health.body, '[E5] 拒收后页数、同步时间和规则数均未改变').toMatchObject({
            pageCount: 10, lastSyncAt: before.lastSyncAt, ruleCount: before.ruleCount,
          });
        }
      });
    });
  }
}
