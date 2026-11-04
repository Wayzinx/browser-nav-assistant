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

const DOCS = 'https://example.com/docs';
const SCENARIOS = [
  { name: 'U', sensitive: 'https://example.com/login?TOKEN=abc' },
  { name: 'L', sensitive: 'https://example.com/login?token=abc' },
];

test('TC-UI-PRIV-002 关键词大小写边界：大写 TOKEN 与小写 token 均在上传前被过滤', async ({ ext, api, evidence }) => {
  for (const scenario of SCENARIOS) {
    let observer;
    let popup;
    try {
      await test.step('S1：独立重置 U/L 子场景，打开敏感标签和普通页（' + scenario.name + '）', async () => {
        await api.reset();
        const pages = await preparePages(ext, [scenario.sensitive, DOCS]);
        observer = observeBackend(ext, evidence, [scenario.sensitive]);
        popup = await openContext(ext, observer);
        await expect(popup.getByTestId('current-page-url'), '前置：当前活动普通页为 docs').toHaveText(DOCS);
        await ext.snap(pages.at(-1), scenario.name + '-普通页活动');
        await ext.snap(popup, scenario.name + '-同步前');
      });
      await test.step('S2：点击同步并检查本子场景请求、计数与 ranked（' + scenario.name + '）', async () => {
        await observer.settle();
        const mark = observer.requests.length;
        await popup.getByTestId('sync-button').click();
        await expect(popup.getByTestId('sync-status'), '[E2] ' + scenario.name + ' 同步成功').toHaveAttribute('data-status', 'success');
        await observer.settle();
        const syncs = observer.since(mark, '/api/sync');
        expect(syncs, '[E1] ' + scenario.name + ' 恰有一次真实同步').toHaveLength(1);
        const sync = syncs[0];
        expect(JSON.stringify(sync.body), '[E1] ' + scenario.name + ' 请求不含敏感 URL').not.toContain(scenario.sensitive);
        expect(sync.body.openTabs.map((tab) => tab.url), '[E1] ' + scenario.name + ' 仅上传普通标签').toEqual([DOCS]);
        expect(sync.body.activeTab.url, '[E1] ' + scenario.name + ' 当前页仍是普通 docs').toBe(DOCS);
        expect(sync.body.history, '[E1] ' + scenario.name + ' 历史为空').toEqual([]);
        await expect(popup.getByTestId('sync-filtered-count'), '[E2] ' + scenario.name + ' 均过滤一条').toHaveText('1');
        expect(sync.response.status, '[E2] ' + scenario.name + ' 真实同步响应为 200').toBe(200);
        expect(sync.response.body, '[E2] ' + scenario.name + ' 上传前过滤，后端没有拒收且仅一页').toMatchObject({ rejected: 0, pageCount: 1 });
        const ranked = await api.get('/api/pages/ranked');
        expect(ranked.status, '[E2] ' + scenario.name + ' ranked 查询成功').toBe(200);
        expect(ranked.body.pages.map((page) => page.url), '[E2] ' + scenario.name + ' ranked 只有普通 docs').toEqual([DOCS]);
        await expect.poll(() => ext.getStorage('syncState').then(({ syncState }) => syncState.status), { message: '前置：本子场景同步状态完成写入' }).toBe('success');
        await ext.snap(popup, scenario.name + '-过滤一条并成功');
      });
    } finally {
      try {
        await observer?.close();
      } finally {
        await popup?.close();
      }
    }
  }
});

