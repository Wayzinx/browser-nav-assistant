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

const NOTE = 'https://example.com/note';
const NOTE_TITLE = 'Note';

test('TC-UI-MENU-010 添加写入后端不可达时无成功提示且后端页面数不变', async ({ ext, api, evidence }) => {
  const { popup } = await test.step('S1：独立 reset，正常后端下打开目标页与 popup，lastMenuAction 未设置', async () => {
    await resetExtensionState(ext, api);
    const opened = await openTargetAndPopup(ext, NOTE, NOTE_TITLE);
    expect((await ext.getStorage('lastMenuAction')).lastMenuAction, '前置：lastMenuAction 未设置').toBeUndefined();
    await ext.snap(opened.popup, '失败前');
    return opened;
  });

  try {
    await test.step('S2：仅将 apiBaseUrl 改为不可达地址，只读观察并点击 current-page-add', async () => {
      await ext.useUnreachableBackend();
      expect((await ext.getStorage('apiBaseUrl')).apiBaseUrl, '前置：apiBaseUrl 已指向不可达地址').toBe('http://127.0.0.1:9');
      const watch = observeMenuWrites(ext, evidence, 'unreachable-add');
      await popup.getByTestId('current-page-add').click();
      await expect.poll(() => watch.of('/api/pages/manual').filter((row) => row.transport !== 'pending').length,
        { message: '等待发往不可达地址的真实请求结束' }).toBe(1);
      await popup.waitForLoadState('networkidle');
      await watch.settle();
      watch.close();
      const rows = watch.of('/api/pages/manual');
      expect(rows.map((row) => row.url), '[E1] 请求发往 http://127.0.0.1:9/api/pages/manual').toEqual(['http://127.0.0.1:9/api/pages/manual']);
      expect(rows.map((row) => row.transport), '[E1] 真实连接失败').toEqual(['failed']);
      expect(rows.map((row) => row.responseText), '[E1] 未收到任何响应（无 accepted=true）').toEqual([null]);
      await ext.snap(popup, '失败后');
    });

    await test.step('S3：读取 toast、lastMenuAction、importantUrls；保持不可达地址 reload；独立客户端读原后端', async () => {
      await expect(popup.getByTestId('toast'), '[E2] 没有「已添加到分析」提示').not.toContainText('已添加到分析');
      const { lastMenuAction } = await ext.getStorage('lastMenuAction');
      expect(lastMenuAction?.accepted === true, '[E2] lastMenuAction 中不存在 accepted=true 的成功结果').toBe(false);
      expect((await api.get('/api/pages/ranked?limit=500')).body.pages, '[E3] 原正常后端 ranked.pages.length=0').toHaveLength(0);
      expect((await api.get('/api/health')).body.pageCount, '[E3] 原正常后端 health.pageCount=0').toBe(0);
      expect((await ext.getStorage('importantUrls')).importantUrls, '[E3] importantUrls=[]').toEqual([]);
      const reloaded = await ext.reopenPopup();
      await expect(reloaded.getByTestId('current-page-url'), '[E4] reload 后当前页仍为目标页').toHaveText(NOTE);
      await expect(reloaded.getByTestId('toast'), '[E4] reload 后 toast 不包含「已添加到分析」').not.toContainText('已添加到分析');
      const after = (await ext.getStorage('lastMenuAction')).lastMenuAction;
      expect(after?.accepted === true, '[E4] reload 后 lastMenuAction 中仍不存在成功结果').toBe(false);
      await ext.snap(reloaded, 'reload后');
    });
  } finally {
    await ext.setApiBase(ext.baseURL);
  }
});
