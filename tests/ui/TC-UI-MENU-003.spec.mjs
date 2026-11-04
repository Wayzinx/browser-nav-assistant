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

test('TC-UI-MENU-003 含 token 的页面点击添加在本地拒绝且不上传不泄漏 URL', async ({ ext, api, evidence }) => {
  const { popup } = await test.step('S1：独立 reset，确认真实 config 启用敏感过滤，打开敏感页与 popup', async () => {
    await resetExtensionState(ext, api);
    const config = await api.get('/api/config');
    expect(config.body.enablePrivacyFilter, '前置：真实 config 启用敏感过滤').toBe(true);
    expect(config.body.privacySensitiveKeywords, '前置：敏感关键词包含 token').toContain('token');
    const opened = await openTargetAndPopup(ext, SENSITIVE, SENSITIVE_TITLE);
    await ext.snap(opened.popup, '敏感页popup');
    return opened;
  });

  const watch = await test.step('S2：记录 storage 基线并只读观察，点击 current-page-add 等待「含敏感词未上传」', async () => {
    const baseline = await ext.getStorage(null);
    evidence.note(`点击前 storage 基线：${JSON.stringify(baseline)}`);
    const observer = observeMenuWrites(ext, evidence, 'sensitive-add');
    await popup.getByTestId('current-page-add').click();
    await expect(popup.getByTestId('toast'), '[E1] toast 提示含敏感词未上传').toContainText('含敏感词未上传');
    await popup.waitForLoadState('networkidle');
    await observer.settle();
    observer.close();
    expect(observer.of('/api/pages/manual'), '[E2] 本次操作没有发出 POST /api/pages/manual').toHaveLength(0);
    await ext.snap(popup, '敏感提示');
    return observer;
  });

  await test.step('S3：读取真实 ranked/health、lastMenuAction 与全部 storage；reload popup 再读回', async () => {
    expect(watch.rows.map((row) => row.url).join(' '), '[E2] 观察到的写请求中不含目标敏感 URL').not.toContain('token=1');
    const { ranked, matches } = await rankedMatches(api, SENSITIVE);
    expect(matches, '[E3] ranked 中没有目标 URL 的记录').toHaveLength(0);
    expect(ranked.body.pages, '[E3] 后端未入库任何页面').toHaveLength(0);
    expect((await api.get('/api/health')).body.pageCount, '[E3] health.pageCount=0').toBe(0);
    const all = await ext.getStorage(null);
    expect(all.lastMenuAction, '[E4] lastMenuAction 字段仅为 kind/accepted/reason/at，kind=add、accepted=false、reason=sensitive')
      .toEqual({ kind: 'add', accepted: false, reason: 'sensitive', at: expect.any(Number) });
    const serialized = JSON.stringify(all);
    expect(serialized, '[E5] storage 不含完整敏感 URL').not.toContain(SENSITIVE);
    expect(serialized, '[E5] storage 不含 token=1').not.toContain('token=1');
    expect(all.importantUrls, '[E5] importantUrls=[]').toEqual([]);
    const reloaded = await ext.reopenPopup();
    await expect(reloaded.getByTestId('toast'), '[E6] reload 后 toast 仍提示含敏感词未上传').toContainText('含敏感词未上传');
    const after = JSON.stringify(await ext.getStorage(null));
    expect(after, '[E6] reload 后 storage 仍不含目标敏感 URL').not.toContain(SENSITIVE);
    expect(after, '[E6] reload 后 storage 仍不含 token=1').not.toContain('token=1');
    await ext.snap(reloaded, 'reload后');
  });
});
