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

const SYSTEM_PAGE = 'chrome://version/';

test('TC-UI-MENU-005 仅有系统页时当前页添加与星标入口均不显示', async ({ ext, api, evidence }) => {
  const watch = await test.step('S1：独立 reset，仅保留 chrome://version/ 作为非插件 tab，再打开真实 popup', async () => {
    await resetExtensionState(ext, api);
    const previous = [...ext.context.pages()];
    const system = await ext.context.newPage();
    await system.goto(SYSTEM_PAGE);
    await Promise.all(previous.map((page) => page.close()));
    await system.bringToFront();
    const tabs = await ext.swEval(() => chrome.tabs.query({}));
    expect(tabs.filter((tab) => /^https?:/.test(tab.url || '')), '前置：没有任何 http(s) tab').toHaveLength(0);
    const observer = observeMenuWrites(ext, evidence, 'system-popup');
    await ext.openPopup();
    return observer;
  });

  await test.step('S2：等待系统页标识，检查添加与星标入口的渲染状态', async () => {
    const popup = ext.popup;
    await expect(popup.getByTestId('current-page-system-badge'), '[E1] 系统页标识包含「系统页 · 不采集」').toContainText('系统页 · 不采集');
    await expect(popup.getByTestId('current-page-add'), '[E2] current-page-add 不可见').toBeHidden();
    await expect(popup.getByTestId('current-page-star'), '[E2] current-page-star 不可见').toBeHidden();
    await popup.waitForLoadState('networkidle');
    await watch.settle();
    watch.close();
    expect(watch.of('/api/pages/manual'), '[E3] POST /api/pages/manual 请求数为 0').toHaveLength(0);
    expect(watch.of('/api/pages/important'), '[E3] POST /api/pages/important 请求数为 0').toHaveLength(0);
    await ext.snap(popup, '系统页卡片');
  });

  await test.step('S3：读取真实 ranked/health 与 importantUrls', async () => {
    const ranked = await api.get('/api/pages/ranked?limit=500');
    expect(ranked.body.pages, '[E4] ranked.pages.length=0').toHaveLength(0);
    expect((await api.get('/api/health')).body.pageCount, '[E4] health.pageCount=0').toBe(0);
    expect((await ext.getStorage('importantUrls')).importantUrls, '[E4] importantUrls=[]').toEqual([]);
  });
});
