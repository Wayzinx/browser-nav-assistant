import { test, expect } from '../fixtures/api.mjs';

const PATHS = ['/api/pages/manual', '/api/pages/important'];
const URLS = ['https://example.com/reset?token=1', 'https://BANK.example.com/account'];
const PERSISTENT_FIELDS = [
  'id', 'url', 'normalizedUrl', 'title', 'visitCount', 'lastVisitedAt', 'firstSeenAt',
  'sources', 'isOpen', 'isActive', 'isImportant',
];
const persistentPages = (pages) => pages.map((page) =>
  Object.fromEntries(PERSISTENT_FIELDS.map((field) => [field, page[field]])))
  .sort((a, b) => a.normalizedUrl.localeCompare(b.normalizedUrl));

test.use({ autoReset: false });

for (const path of PATHS) {
  for (const url of URLS) {
    test(`TC-API-MENU-006 ${path} 拒收敏感 URL ${url}`, async ({ api }) => {
      const T = await test.step('S1：为当前路径与 URL 组合重置并导入样例', async () => {
        const reset = await api.reset();
        expect(reset.status, '[E5] reset 返回 200').toBe(200);
        expect(reset.body.ok, '[E5] reset.ok=true').toBe(true);
        const { res } = await api.loadSample();
        expect(res.status, '[E5] sync 返回 200').toBe(200);
        expect(res.body, '[E5] 样例初始化成功且有 10 页').toMatchObject({ ok: true, pageCount: 10 });
        expect(res.body.syncedAt, '[E5] syncedAt 为毫秒时间戳').toEqual(expect.any(Number));
        return res.body.syncedAt;
      });

      const before = await test.step('S2：保存十页的完整持久字段和健康基线', async () => {
        const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: T } });
        expect(ranked.status, '[E4] 初始 ranked 返回 200').toBe(200);
        expect(ranked.body.total, '[E2] 初始 total=10').toBe(10);
        expect(ranked.body.pages, '[E4] 基线包含完整十页').toHaveLength(10);
        for (const page of ranked.body.pages) {
          expect(Object.keys(page), '[E4] 基线页面包含全部持久字段').toEqual(expect.arrayContaining(PERSISTENT_FIELDS));
        }
        const health = await api.get('/api/health');
        expect(health.status, '[E2] 初始 health 返回 200').toBe(200);
        expect(health.body, '[E2] 初始健康计数和同步时间正确').toMatchObject({
          pageCount: 10, lastSyncAt: T, ruleCount: 0,
        });
        return { pages: persistentPages(ranked.body.pages), lastSyncAt: health.body.lastSyncAt, ruleCount: health.body.ruleCount };
      });

      await test.step('S3：直接向后端提交敏感 URL', async () => {
        const body = { url, title: 'Private note' };
        if (path === '/api/pages/important') body.important = true;
        const response = await api.post(path, body);
        expect(response.status, '[E1] 敏感请求返回 200').toBe(200);
        expect(response.body, '[E1] 敏感 URL 被拒收').toMatchObject({ accepted: false, rejected: 1 });
      });

      await test.step('S4：核对敏感 URL 未泄漏且持久状态完全不变', async () => {
        const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: T } });
        expect(ranked.status, '[E2] 最终 ranked 返回 200').toBe(200);
        expect(ranked.body.total, '[E2] 最终 total=10').toBe(10);
        expect(ranked.body.pages, '[E4] 最终仍有十页').toHaveLength(10);
        expect(persistentPages(ranked.body.pages), '[E4] 原十页的全部持久字段逐页不变').toStrictEqual(before.pages);
        const cleanup = await api.get('/api/pages/cleanup-suggestions', { params: { now: T } });
        expect(cleanup.status, '[E3] cleanup 返回 200').toBe(200);
        const pageUrls = ranked.body.pages.flatMap((page) => [page.url, page.normalizedUrl]);
        const suggestionUrls = cleanup.body.suggestions.flatMap((item) => [item.url, item.keepUrl, ...(item.urls ?? [])]);
        for (const privateUrl of new Set([url, new URL(url).href])) {
          expect(pageUrls, '[E3] ranked 不含敏感原 URL 或规范化 URL').not.toContain(privateUrl);
          expect(suggestionUrls, '[E3] 建议的 url、urls、keepUrl 均不含敏感 URL').not.toContain(privateUrl);
        }
        const health = await api.get('/api/health');
        expect(health.status, '[E2] 最终 health 返回 200').toBe(200);
        expect(health.body, '[E2] 页数、同步时间和规则数均未改变').toMatchObject({
          pageCount: 10, lastSyncAt: before.lastSyncAt, ruleCount: before.ruleCount,
        });
      });
    });
  }
}
