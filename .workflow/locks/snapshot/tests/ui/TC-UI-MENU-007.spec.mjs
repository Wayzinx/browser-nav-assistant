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

test('TC-UI-MENU-007 同一页面连续两次添加只保留一个 manual 页面', async ({ ext, api, evidence }) => {
  const { popup } = await test.step('S1：独立 reset，打开目标离线页与真实 popup', async () => {
    await resetExtensionState(ext, api);
    const opened = await openTargetAndPopup(ext, NOTE, NOTE_TITLE);
    await ext.snap(opened.popup, '点击前');
    return opened;
  });

  const watch = await test.step('S2：连续两次点击 current-page-add，每次等待真实 manual 响应与成功提示', async () => {
    const observer = observeMenuWrites(ext, evidence, 'add-twice');
    const done = () => observer.of('/api/pages/manual').filter((row) => row.transport !== 'pending').length;
    await popup.getByTestId('current-page-add').click();
    await expect.poll(done, { message: '等待第一次真实 manual 完成' }).toBe(1);
    await expect(popup.getByTestId('toast'), '[E3] 第一次添加后提示已添加到分析').toContainText('已添加到分析');
    await observer.settle();
    await ext.snap(popup, '第一次添加');
    await popup.getByTestId('current-page-add').click();
    await expect.poll(done, { message: '等待第二次真实 manual 完成' }).toBe(2);
    await observer.settle();
    observer.close();
    await expect(popup.getByTestId('toast'), '[E3] 第二次添加后提示已添加到分析').toContainText('已添加到分析');
    await ext.snap(popup, '第二次添加');
    return observer;
  });

  await test.step('S3：读取真实 ranked/health 与 lastMenuAction；reload popup 后再读', async () => {
    const [first, second] = watch.of('/api/pages/manual');
    expect(first.status, '[E1] 第一次 manual 响应 200').toBe(200);
    expect(watch.json(first), '[E1] 第一次响应 accepted=true、created=true、pageCount=1')
      .toEqual(expect.objectContaining({ accepted: true, created: true, pageCount: 1 }));
    expect(watch.of('/api/pages/manual'), '[E2] 共观察到 2 次真实 manual 请求').toHaveLength(2);
    expect(second.status, '[E2] 第二次 manual 响应 200').toBe(200);
    expect(watch.json(second), '[E2] 第二次响应 accepted=true、created=false、pageCount=1')
      .toEqual(expect.objectContaining({ accepted: true, created: false, pageCount: 1 }));
    const { lastMenuAction } = await ext.getStorage('lastMenuAction');
    expect(lastMenuAction, '[E3] lastMenuAction.kind=add、accepted=true').toEqual(expect.objectContaining({ kind: 'add', accepted: true }));
    const { matches } = await rankedMatches(api, NOTE);
    expect(matches, '[E4] ranked 中目标页记录数=1').toHaveLength(1);
    expect(matches[0].sources, '[E4] 目标页 sources 包含 manual').toContain('manual');
    expect((await api.get('/api/health')).body.pageCount, '[E4] health.pageCount=1').toBe(1);
    const reloaded = await ext.reopenPopup();
    await expect(reloaded.getByTestId('current-page-url'), '[E5] reload 后当前页仍为目标页').toHaveText(NOTE);
    const again = await rankedMatches(api, NOTE);
    expect(again.matches, '[E5] reload 后目标页记录数仍为 1').toHaveLength(1);
    expect((await api.get('/api/health')).body.pageCount, '[E5] reload 后 health.pageCount 仍为 1').toBe(1);
    await ext.snap(reloaded, 'reload后');
  });
});
