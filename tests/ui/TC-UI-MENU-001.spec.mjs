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

const HTTP_MENU = 'http://example.com/menu';
const HTTPS_MENU = 'https://example.com/menu';
const MENU_IDS = ['nav-add', 'nav-important'];

test('TC-UI-MENU-001 插件安装后两个右键菜单 ID 均已注册（AC1 代理检查）', async ({ ext, api, evidence }) => {
  await test.step('S1：独立 reset，打开两个离线外站 tab 与真实 popup', async () => {
    await resetExtensionState(ext, api);
    await ext.mockSites({ [HTTP_MENU]: 'Menu http', [HTTPS_MENU]: 'Menu https' });
    await ext.openTabs([HTTP_MENU, HTTPS_MENU]);
    const popup = await ext.openPopup();
    await expect(popup.getByTestId('current-page-url'), '前置：当前页为最后打开的外站').toHaveText(HTTPS_MENU);
    await ext.snap(popup, '打开popup');
  });

  await test.step('S2：在 SW 中对两个菜单 ID 调用 contextMenus.update 并在回调内读取 lastError', async () => {
    const results = await ext.swEval((ids) => Promise.all(ids.map((id) => new Promise((resolve) => {
      chrome.contextMenus.update(id, {}, () => {
        const lastError = chrome.runtime.lastError;
        resolve({ id, lastError: lastError ? String(lastError.message) : null });
      });
    }))), MENU_IDS);
    evidence.note(`contextMenus.update 回调结果：${JSON.stringify(results)}；未打开原生菜单，未触发点击`);
    expect(results.find((item) => item.id === 'nav-add'), '[E1] nav-add 的 update 回调中 lastError 为空，已注册')
      .toEqual({ id: 'nav-add', lastError: null });
    expect(results.find((item) => item.id === 'nav-important'), '[E2] nav-important 的 update 回调中 lastError 为空，已注册')
      .toEqual({ id: 'nav-important', lastError: null });
    // 对照：未注册 ID 的 update 回调必须带 lastError，证明该探针能识别「未注册」
    const control = await ext.swEval(() => new Promise((resolve) => {
      chrome.contextMenus.update('nav-unregistered-control', {}, () => resolve(chrome.runtime.lastError?.message ?? null));
    }));
    evidence.note(`对照 ID nav-unregistered-control 的 lastError：${control}`);
    expect(control, '对照：未注册 ID 的 update 回调中 lastError 非空').toContain('nav-unregistered-control');
  });

  await test.step('S3：读取真实 health，记录代理验证范围', async () => {
    const health = await api.get('/api/health');
    expect(health.status, '[E3] health 返回 200').toBe(200);
    expect(health.body.pageCount, '[E3] 注册检查未产生业务写入，pageCount=0').toBe(0);
    evidence.note('AC1 自动化代理：仅证明菜单 ID 已注册；原生菜单文字、外观与实际点击未验证');
    await ext.snap(ext.popup, '注册检查完成');
  });
});
