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

const DOC = 'https://docs.internal.com/ai-agent-design';
const DOC_TITLE = 'AI Agent Design';

test('TC-UI-MENU-004 普通页面点击星标后 domain 分为 1.00 且重要状态持久读回', async ({ ext, api, evidence }) => {
  const { popup } = await test.step('S1：独立 reset，打开目标外站与 popup，星标初始未标记', async () => {
    await resetExtensionState(ext, api);
    const opened = await openTargetAndPopup(ext, DOC, DOC_TITLE);
    await expect(opened.popup.getByTestId('current-page-star'), '前置：星标 aria-pressed=false').toHaveAttribute('aria-pressed', 'false');
    await ext.snap(opened.popup, '星标前');
    return opened;
  });

  await test.step('S2：只读观察，点击 current-page-star，等待真实 important 响应与 aria-pressed=true', async () => {
    const watch = observeMenuWrites(ext, evidence, 'star');
    await popup.getByTestId('current-page-star').click();
    await expect.poll(() => watch.of('/api/pages/important').filter((row) => row.transport !== 'pending').length,
      { message: '等待真实 POST /api/pages/important 完成' }).toBe(1);
    await watch.settle();
    watch.close();
    const [row] = watch.of('/api/pages/important');
    expect(watch.body(row), '[E1] important 请求 url 为目标 URL、important=true').toEqual(expect.objectContaining({ url: DOC, important: true }));
    expect(row.status, '[E1] important 响应 200').toBe(200);
    expect(watch.json(row), '[E1] 响应 accepted=true、isImportant=true、created=true')
      .toEqual(expect.objectContaining({ accepted: true, isImportant: true, created: true }));
    await expect(popup.getByTestId('current-page-star'), '[E2] 星标 aria-pressed=true').toHaveAttribute('aria-pressed', 'true');
    await ext.snap(popup, '星标后');
  });

  await test.step('S3：读取真实 ranked/health 与 importantUrls，reload popup 再读回', async () => {
    const { matches } = await rankedMatches(api, DOC);
    expect(matches, '[E3] ranked 中目标页恰有 1 条').toHaveLength(1);
    expect(matches[0].isImportant, '[E3] 目标页 isImportant=true').toBe(true);
    expect(matches[0].scoreDetail.domain, '[E3] scoreDetail.domain=1.00').toBe(1);
    expect(matches[0].scoreDetail.domainSource, '[E3] scoreDetail.domainSource=important').toBe('important');
    expect(matches[0].reason, '[E4] reason 包含「已被你标记为重要」').toContain('已被你标记为重要');
    expect((await api.get('/api/health')).body.pageCount, '[E5] health.pageCount=1').toBe(1);
    expect((await ext.getStorage('importantUrls')).importantUrls, '[E5] importantUrls 恰为目标 URL').toEqual([DOC]);
    const reloaded = await ext.reopenPopup();
    await expect(reloaded.getByTestId('current-page-url'), '[E6] reload 后当前页仍为目标 URL').toHaveText(DOC);
    await expect(reloaded.getByTestId('current-page-star'), '[E6] reload 后星标 aria-pressed=true').toHaveAttribute('aria-pressed', 'true');
    expect((await ext.getStorage('importantUrls')).importantUrls, '[E6] reload 后 importantUrls 仍恰为目标 URL').toEqual([DOC]);
    await ext.snap(reloaded, 'reload后');
  });
});
