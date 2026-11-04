import { test, expect } from '../fixtures/api.mjs';

const PATHS = ['/api/pages/manual', '/api/pages/important'];
const INPUTS = [
  { label: '缺少 url', body: {} },
  { label: 'url 为空字符串', body: { url: '' } },
  { label: 'chrome 协议', body: { url: 'chrome://version/' } },
  { label: 'javascript 协议', body: { url: 'javascript:alert(1)' } },
  { label: '非 URL 字符串', body: { url: 'not-a-url' } },
];
const PERSISTENT_FIELDS = [
  'id', 'url', 'normalizedUrl', 'title', 'visitCount', 'lastVisitedAt', 'firstSeenAt',
  'sources', 'isOpen', 'isActive', 'isImportant',
];
const persistentPages = (pages) => pages.map((page) =>
  Object.fromEntries(PERSISTENT_FIELDS.map((field) => [field, page[field]])))
  .sort((a, b) => a.normalizedUrl.localeCompare(b.normalizedUrl));

test.use({ autoReset: false });

for (const path of PATHS) {
  for (const { label, body } of INPUTS) {
    test(`TC-API-MENU-007 ${path} 拒绝${label}且不改变已存页面`, async ({ api }) => {
      const T = await test.step('S1：为当前路径和非法输入重置并导入样例', async () => {
        const reset = await api.reset();
        expect(reset.status, '[E5] reset 返回 200').toBe(200);
        expect(reset.body.ok, '[E5] reset.ok=true').toBe(true);
        const { res } = await api.loadSample();
        expect(res.status, '[E5] sync 返回 200').toBe(200);
        expect(res.body, '[E5] 样例初始化成功且有 10 页').toMatchObject({ ok: true, pageCount: 10 });
        expect(res.body.syncedAt, '[E5] syncedAt 为毫秒时间戳').toEqual(expect.any(Number));
        return res.body.syncedAt;
      });

      const before = await test.step('S2：保存完整持久字段和健康基线', async () => {
        const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: T } });
        expect(ranked.status, '[E4] 初始 ranked 返回 200').toBe(200);
        expect(ranked.body.total, '[E3] 初始 total=10').toBe(10);
        expect(ranked.body.pages, '[E4] 基线包含完整十页').toHaveLength(10);
        for (const page of ranked.body.pages) {
          expect(Object.keys(page), '[E4] 基线页面包含全部持久字段').toEqual(expect.arrayContaining(PERSISTENT_FIELDS));
        }
        const health = await api.get('/api/health');
        expect(health.status, '[E3] 初始 health 返回 200').toBe(200);
        expect(health.body, '[E3] 初始健康计数和同步时间正确').toMatchObject({
          pageCount: 10, lastSyncAt: T, ruleCount: 0,
        });
        return { pages: persistentPages(ranked.body.pages), lastSyncAt: health.body.lastSyncAt, ruleCount: health.body.ruleCount };
      });

      await test.step('S3：提交原样 JSON 请求体并核对统一校验错误', async () => {
        const response = await api.post(path, body);
        expect(response.status, '[E1] 非法 URL 返回 400').toBe(400);
        expect(response.body.error.code, '[E1] 错误码为 VALIDATION_FAILED').toBe('VALIDATION_FAILED');
        expect(response.body.error.message, '[E1] 错误消息为非空字符串').toMatch(/\S/);
        expect(response.body.error.details.fields, '[E2] 错误字段包含 url').toContain('url');
      });

      await test.step('S4：读回页面及健康状态，确认没有副作用', async () => {
        const ranked = await api.get('/api/pages/ranked', { params: { limit: 500, now: T } });
        expect(ranked.status, '[E3] 最终 ranked 返回 200').toBe(200);
        expect(ranked.body.total, '[E3] 最终 total=10').toBe(10);
        expect(ranked.body.pages, '[E4] 最终仍有十页').toHaveLength(10);
        expect(persistentPages(ranked.body.pages), '[E4] 原十页的全部持久字段逐页不变').toStrictEqual(before.pages);
        const health = await api.get('/api/health');
        expect(health.status, '[E3] 最终 health 返回 200').toBe(200);
        expect(health.body, '[E3] 页数、同步时间和规则数均未改变').toMatchObject({
          pageCount: 10, lastSyncAt: before.lastSyncAt, ruleCount: before.ruleCount,
        });
      });
    });
  }
}
