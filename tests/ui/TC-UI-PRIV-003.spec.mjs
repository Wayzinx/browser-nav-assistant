import { test, expect } from '../fixtures/extension.mjs';

// TDD 草稿：只操作真实 Chromium、插件消息和后端；网络事件仅用于被动取证。
async function preparePages(ext, urls, { backend = ext.baseURL, history = [] } = {}) {
  const previousPages = [...ext.context.pages()];
  await ext.swEval(async () => {
    await chrome.storage.local.clear();
    await chrome.history.deleteAll();
  });
  await ext.setStorage({
    apiBaseUrl: backend,
    connection: { status: 'online', recoverPending: false, since: Date.now(), lastCheckedAt: null, lastErrorCode: null },
  });
  await ext.mockSites(Object.fromEntries(urls.map((url, index) => [url, '合成测试页 ' + (index + 1)])));
  const pages = await ext.openTabs(urls);
  for (const page of previousPages) await page.close();
  await pages.at(-1).bringToFront();
  await ext.swEval(() => chrome.history.deleteAll());
  await ext.seedHistory(history);
  await expect.poll(() => ext.swEval(async () =>
    (await chrome.tabs.query({ active: true, lastFocusedWindow: true })).map((tab) => tab.url)),
  { message: '前置：最后打开的普通页是当前活动页' }).toEqual([urls.at(-1)]);
  const tabs = await ext.swEval(() => chrome.tabs.query({ windowType: 'normal' }));
  expect(tabs.filter((tab) => !tab.incognito).map((tab) => tab.url).sort(), '前置：仅保留本例普通标签').toEqual([...urls].sort());
  await expect.poll(() => ext.swEval(async () =>
    (await chrome.history.search({ text: '', startTime: 0, maxResults: 1000 })).map((item) => item.url).sort()),
  { message: '前置：真实历史与声明的数据一致' }).toEqual([...history].sort());
  return pages;
}

async function readContext(popup, evidence) {
  const reply = await popup.evaluate(() => chrome.runtime.sendMessage({
    type: 'GET_CONTEXT', payload: {}, requestId: 'priv-context-' + Date.now(),
  }));
  expect(reply.ok, '前置：真实 GET_CONTEXT 消息成功').toBe(true);
  // 只记录来源和计数；敏感 URL 不写入日志。
  evidence.note('GET_CONTEXT ' + JSON.stringify({
    privacy: reply.data.privacy, tabs: reply.data.tabs.length, history: reply.data.history.length,
  }));
  return reply.data;
}

async function openContext(ext, observer) {
  const popup = await ext.openPopup();
  await expect(popup.getByTestId('sync-button'), '前置：同步按钮可用').toBeEnabled();
  await popup.getByTestId('tab-context').click();
  await expect(popup.getByTestId('context-loading'), '前置：上下文加载结束').toBeHidden();
  await expect(popup.getByTestId('context-privacy-keywords'), '前置：关键词来源可读').toBeVisible();
  await observer.settle();
  return popup;
}

function tabItem(popup, url) {
  return popup.getByTestId('context-tabs-list').getByTestId('context-tab-item')
    .filter({ has: popup.getByTestId('context-tab-url').filter({ hasText: url }) });
}

function observeBackend(ext, evidence, sensitiveUrls = []) {
  const origins = new Set([new URL(ext.baseURL).origin, 'http://127.0.0.1:9']);
  const requests = [];
  const byRequest = new Map();
  const active = new Set();
  const jobs = [];
  let sequence = 0;
  function redact(value) {
    let result = value;
    if (typeof value === 'string') {
      for (const url of sensitiveUrls) result = result.replaceAll(url, '[redacted-url]');
    } else if (Array.isArray(value)) {
      result = value.map(redact);
    } else if (value && typeof value === 'object') {
      result = Object.fromEntries(Object.entries(value).map(([key, item]) => [redact(key), redact(item)]));
    }
    return result;
  }
  const tracked = (request) => Boolean(request.serviceWorker())
    && origins.has(new URL(request.url()).origin) && new URL(request.url()).pathname.startsWith('/api/');
  const collect = (job) => jobs.push(job.then((value) => ({ value }), (error) => ({ error })));
  const record = (entry, responseBody, status, responseHeaders = {}) => evidence.recordApi({
    reqId: evidence.caseId + '-sw-' + entry.sequence, observed: true, setup: false,
    method: entry.method, url: entry.url, requestHeaders: redact(entry.request.headers()),
    requestBody: redact(entry.body), status, responseHeaders: redact(responseHeaders),
    responseBody: redact(responseBody), ms: Date.now() - entry.startedAt,
  });
  const onRequest = (request) => collect((async () => {
    if (tracked(request)) {
      const entry = { request, sequence: ++sequence, startedAt: Date.now(), method: request.method(),
        url: request.url(), path: new URL(request.url()).pathname, body: request.postDataJSON(), response: null, failure: null };
      requests.push(entry);
      byRequest.set(request, entry);
      active.add(request);
    }
  })());
  const onResponse = (response) => collect((async () => {
    if (byRequest.has(response.request())) {
      const entry = byRequest.get(response.request());
      const body = await response.json();
      entry.response = { status: response.status(), body };
      record(entry, body, response.status(), response.headers());
    }
  })());
  const onFinished = (request) => active.delete(request);
  const onFailed = (request) => collect((async () => {
    active.delete(request);
    if (byRequest.has(request)) {
      const entry = byRequest.get(request);
      entry.failure = request.failure()?.errorText;
      // 连接失败没有 HTTP 状态码；保留实际失败信息，不伪造响应。
      record(entry, { networkError: entry.failure }, null);
    }
  })());
  ext.context.on('request', onRequest);
  ext.context.on('response', onResponse);
  ext.context.on('requestfinished', onFinished);
  ext.context.on('requestfailed', onFailed);
  async function drain() {
    let consumed = 0;
    const errors = [];
    while (consumed < jobs.length) {
      const end = jobs.length;
      const settled = await Promise.all(jobs.slice(consumed, end));
      consumed = end;
      errors.push(...settled.filter((item) => Object.hasOwn(item, 'error')).map((item) => item.error));
    }
    if (errors.length) throw new AggregateError(errors, '真实 SW 请求取证失败');
  }
  async function settle() {
    await expect.poll(() => active.size, { message: '等待已发出的 SW 请求结束' }).toBe(0);
    await drain();
  }
  async function close() {
    try {
      await settle();
    } finally {
      ext.context.off('request', onRequest);
      ext.context.off('response', onResponse);
      ext.context.off('requestfinished', onFinished);
      ext.context.off('requestfailed', onFailed);
    }
  }
  const since = (mark, path) => requests.slice(mark).filter((entry) => entry.method === 'POST' && entry.path === path);
  return { requests, since, settle, close };
}

const ORDINARY = 'https://example.com/docs?topic=guide';

test('TC-UI-PRIV-003 普通 URL 反对照：不含敏感词时不误过滤且同 URL 按来源上传', async ({ ext, api, evidence }) => {
  let observer;
  let popup;
  try {
    await test.step('S1：仅打开普通页，清历史后新增一条真实历史', async () => {
      const pages = await preparePages(ext, [ORDINARY], { history: [ORDINARY] });
      observer = observeBackend(ext, evidence);
      await ext.snap(pages[0], '普通页与一条真实历史');
    });
    await test.step('S2：同步并核对三处来源、响应计数和 URL 去重', async () => {
      popup = await openContext(ext, observer);
      const context = await readContext(popup, evidence);
      expect(context.currentPage.url, '前置：普通当前页正确').toBe(ORDINARY);
      expect(context.history.map((item) => item.url), '前置：仅有一条真实普通历史').toEqual([ORDINARY]);
      await observer.settle();
      const mark = observer.requests.length;
      await popup.getByTestId('sync-button').click();
      await expect(popup.getByTestId('sync-status'), '[E2] 普通页面同步成功').toHaveAttribute('data-status', 'success');
      await observer.settle();
      const syncs = observer.since(mark, '/api/sync');
      expect(syncs, '[E1] 恰好一次真实同步').toHaveLength(1);
      const sync = syncs[0];
      expect(sync.body.activeTab.url, '[E1] activeTab 上传普通 URL').toBe(ORDINARY);
      expect(sync.body.openTabs.map((tab) => tab.url), '[E1] openTabs 恰有一条普通 URL').toEqual([ORDINARY]);
      expect(sync.body.history.map((item) => item.url), '[E1] history 恰有一条同 URL 历史').toEqual([ORDINARY]);
      await expect(popup.getByTestId('sync-filtered-count'), '[E2] 普通 URL 不误过滤').toHaveText('0');
      await expect(popup.getByTestId('sync-uploaded-count'), '[E2] 三处来源分别计数').toHaveText('3');
      expect(sync.response.status, '[E3] 真实同步响应为 200').toBe(200);
      expect(sync.response.body, '[E3] 三条来源新建一页并更新两次，无拒收').toMatchObject({ received: 3, created: 1, updated: 2, rejected: 0 });
      const health = await api.get('/api/health');
      expect(health.status, '[E4] health 查询成功').toBe(200);
      expect(health.body.pageCount, '[E4] 跨来源按 URL 去重为一页').toBe(1);
      const ranked = await api.get('/api/pages/ranked');
      expect(ranked.status, '[E4] ranked 查询成功').toBe(200);
      expect(ranked.body.pages.map((page) => page.url), '[E4] 入库的唯一页面就是普通 URL').toEqual([ORDINARY]);
      await expect.poll(() => ext.getStorage('syncState').then(({ syncState }) => syncState.status), { message: '前置：同步状态已写入 storage' }).toBe('success');
      await ext.snap(popup, '零过滤且三来源去重');
    });
  } finally {
    await observer?.close();
  }
});

