import { test, expect } from '../fixtures/extension.mjs';

// 本模块写接口：只读观察，不 route、不改写请求
const MENU_WRITE_PATHS = ['/api/pages/manual', '/api/pages/important'];

/**
 * 只读观察浏览器上下文（含 service worker）发往 manual / important 的真实 POST。
 * 记录请求体、状态码、响应体或连接失败原因，并写入 evidence/<CaseID>/api/。
 */
function observeMenuWrites(ext, evidence, phase) {
  const rows = [];
  const byRequest = new Map();
  const active = new Set();
  const reading = [];
  let sequence = 0;
  const onRequest = (request) => {
    const url = new URL(request.url());
    if (request.method() === 'POST' && MENU_WRITE_PATHS.includes(url.pathname)) {
      const row = {
        sequence: ++sequence, phase, method: request.method(), url: request.url(), origin: url.origin,
        path: url.pathname, rawBody: request.postData(), fromServiceWorker: Boolean(request.serviceWorker()),
        startedAt: Date.now(), transport: 'pending', status: null, responseText: null, failure: null,
      };
      rows.push(row);
      byRequest.set(request, row);
      active.add(request);
    }
  };
  const onResponse = (response) => {
    const row = byRequest.get(response.request());
    if (row) {
      row.status = response.status();
      reading.push(response.text().then((text) => { row.responseText = text; }));
    }
  };
  const onFinished = (request) => {
    const row = byRequest.get(request);
    if (row) { row.transport = 'finished'; row.endedAt = Date.now(); active.delete(request); }
  };
  const onFailed = (request) => {
    const row = byRequest.get(request);
    if (row) {
      row.transport = 'failed';
      row.failure = request.failure()?.errorText || 'requestfailed';
      row.endedAt = Date.now();
      active.delete(request);
    }
  };
  ext.context.on('request', onRequest);
  ext.context.on('response', onResponse);
  ext.context.on('requestfinished', onFinished);
  ext.context.on('requestfailed', onFailed);

  const of = (path) => rows.filter((row) => row.path === path);
  const body = (row) => JSON.parse(row.rawBody);
  const json = (row) => JSON.parse(row.responseText);
  async function settle() {
    await expect.poll(() => active.size, { message: `${phase}：等待观察到的真实写请求全部结束` }).toBe(0);
    let consumed = 0;
    while (consumed < reading.length) {
      const end = reading.length;
      await Promise.all(reading.slice(consumed, end));
      consumed = end;
    }
    for (const row of rows.filter((item) => !item.persisted)) {
      evidence.recordApi({
        reqId: `${evidence.caseId}-${phase}-observed-${row.sequence}`, observed: true, setup: false,
        method: row.method, url: row.url, requestBody: row.rawBody, status: row.status,
        responseBody: row.responseText ?? { failure: row.failure }, transport: row.transport,
        fromServiceWorker: row.fromServiceWorker, ms: (row.endedAt || Date.now()) - row.startedAt,
      });
      row.persisted = true;
    }
    evidence.note(`${phase} 观察到的写请求：${JSON.stringify(rows.map(({ rawBody, responseText, ...rest }) => rest))}`);
  }
  function close() {
    ext.context.off('request', onRequest);
    ext.context.off('response', onResponse);
    ext.context.off('requestfinished', onFinished);
    ext.context.off('requestfailed', onFailed);
  }
  return { rows, of, body, json, settle, close };
}

/** 每例独立前置：清空插件 storage / history，指向真实测试后端，importantUrls=[]，确认后端为空 */
async function resetExtensionState(ext, api) {
  await ext.swEval(async (base) => {
    await chrome.storage.local.clear();
    await chrome.history.deleteAll();
    await chrome.storage.local.set({ apiBaseUrl: base, importantUrls: [] });
  }, ext.baseURL);
  const health = await api.get('/api/health');
  expect(health.status, '前置：reset 后 health 可读').toBe(200);
  expect(health.body.pageCount, '前置：reset 后后端页面数为 0').toBe(0);
}

/** 打开唯一的离线外站作为最近访问的非插件 tab，关闭其他页面，再以 tab 方式打开真实 popup */
async function openTargetAndPopup(ext, url, title) {
  const previous = [...ext.context.pages()];
  await ext.mockSites({ [url]: title });
  const [site] = await ext.openTabs([url]);
  await Promise.all(previous.map((page) => page.close()));
  await site.bringToFront();
  const popup = await ext.openPopup();
  await expect(popup.getByTestId('current-page-url'), '前置：当前页为目标外站').toHaveText(url);
  return { site, popup };
}

/** 读取真实 ranked 中某个 normalizedUrl 的全部记录 */
async function rankedMatches(api, normalizedUrl) {
  const ranked = await api.get('/api/pages/ranked?limit=500');
  expect(ranked.status, 'ranked 可读').toBe(200);
  return { ranked, matches: ranked.body.pages.filter((page) => page.normalizedUrl === normalizedUrl) };
}

const SENSITIVE = 'https://example.com/reset?token=1';
const SENSITIVE_TITLE = 'Reset';

async function expectStarLocked(popup, tag) {
  const star = popup.getByTestId('current-page-star');
  await expect(star, `${tag} 星标 disabled`).toBeDisabled();
  await expect(star, `${tag} 星标 aria-disabled=true`).toHaveAttribute('aria-disabled', 'true');
  await expect(star, `${tag} 星标 aria-pressed=false`).toHaveAttribute('aria-pressed', 'false');
}

/** 读取全部 storage 的重要状态与序列化值，用于脱敏审计 */
async function storageAudit(ext) {
  const all = await ext.getStorage(null);
  return { importantUrls: all.importantUrls, serialized: JSON.stringify(all) };
}

test('TC-UI-MENU-006 敏感页面星标置灰并保持后端与本地重要状态为空', async ({ ext, api, evidence }) => {
  const { popup, watch } = await test.step('S1：独立 reset，确认真实 config 后打开敏感外站与 popup', async () => {
    await resetExtensionState(ext, api);
    const config = await api.get('/api/config');
    expect(config.body.enablePrivacyFilter, '前置：真实 config 启用敏感过滤').toBe(true);
    expect(config.body.privacySensitiveKeywords, '前置：敏感关键词包含 token').toContain('token');
    const observer = observeMenuWrites(ext, evidence, 'sensitive-popup');
    const opened = await openTargetAndPopup(ext, SENSITIVE, SENSITIVE_TITLE);
    return { popup: opened.popup, watch: observer };
  });

  await test.step('S2：读取星标 disabled / aria-disabled / title / aria-pressed，观察初始化期间的重要写请求', async () => {
    await expectStarLocked(popup, '[E1]');
    await expect(popup.getByTestId('current-page-star'), '[E1] 星标 title=敏感页面不采集').toHaveAttribute('title', '敏感页面不采集');
    await expect(popup.getByTestId('current-page-star'), '[E2] 星标 aria-pressed=false').toHaveAttribute('aria-pressed', 'false');
    await popup.waitForLoadState('networkidle');
    await watch.settle();
    await ext.snap(popup, '置灰星标');
  });

  await test.step('S3：读取真实 ranked/health 与全部 storage；reload popup 再读回', async () => {
    expect(watch.of('/api/pages/important'), '[E3] POST /api/pages/important 请求数为 0').toHaveLength(0);
    expect((await api.get('/api/pages/ranked?limit=500')).body.pages, '[E3] ranked.pages.length=0').toHaveLength(0);
    expect((await api.get('/api/health')).body.pageCount, '[E3] health.pageCount=0').toBe(0);
    const audit = await storageAudit(ext);
    expect(audit.importantUrls, '[E4] importantUrls=[]').toEqual([]);
    expect(audit.serialized, '[E4] storage 不含完整敏感 URL').not.toContain(SENSITIVE);
    expect(audit.serialized, '[E4] storage 不含 token=1').not.toContain('token=1');
    const reloaded = await ext.reopenPopup();
    await expect(reloaded.getByTestId('current-page-url'), '[E2] reload 后当前页仍为敏感页').toHaveText(SENSITIVE);
    await expectStarLocked(reloaded, '[E2] reload 后');
    await reloaded.waitForLoadState('networkidle');
    await watch.settle();
    watch.close();
    expect(watch.of('/api/pages/important'), '[E3] reload 后 POST /api/pages/important 请求数仍为 0').toHaveLength(0);
    const reloadAudit = await storageAudit(ext);
    expect(reloadAudit.importantUrls, '[E4] reload 后 importantUrls=[]').toEqual([]);
    expect(reloadAudit.serialized, '[E4] reload 后 storage 不含完整敏感 URL').not.toContain(SENSITIVE);
    expect(reloadAudit.serialized, '[E4] reload 后 storage 不含 token=1').not.toContain('token=1');
    await ext.snap(reloaded, 'reload后');
  });
});
