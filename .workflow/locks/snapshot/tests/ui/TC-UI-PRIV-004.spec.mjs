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

const ACCOUNTS = 'https://accounts.example.com/reset-password?token=8f2a91c';
const BANK = 'https://bank.example.com/account/overview';
const SECRET = 'https://example.com/?secret=1';
const DOCS = 'https://example.com/docs';
const UNREACHABLE = 'http://127.0.0.1:9';

test('TC-UI-PRIV-004 后端不可达且无配置缓存：内置关键词仍标注并过滤敏感项', async ({ ext, evidence }) => {
  let observer;
  let popup;
  try {
    await test.step('S1：打开三条敏感标签和普通页，清历史并使用不可达后端', async () => {
      const pages = await preparePages(ext, [ACCOUNTS, BANK, SECRET, DOCS], { backend: UNREACHABLE });
      expect(await ext.getStorage('cache'), '前置：整个 cache 不存在').toEqual({});
      observer = observeBackend(ext, evidence, [ACCOUNTS, BANK, SECRET]);
      await ext.snap(pages.at(-1), '断网前置且普通页活动');
    });
    await test.step('S2：读取内置兜底关键词与逐条敏感标注', async () => {
      popup = await openContext(ext, observer);
      const context = await readContext(popup, evidence);
      expect(context.privacy, '[E1] 无后端和缓存时使用启用的内置关键词').toEqual({ source: 'default', enabled: true, keywords: ['password', 'token', 'bank', 'secret'] });
      await expect(popup.getByTestId('context-privacy-keywords'), '[E1] 显示内置默认来源').toContainText('内置默认');
      for (const keyword of ['password', 'token', 'bank', 'secret']) {
        await expect(popup.getByTestId('context-privacy-keywords'), '[E1] 内置关键词可见：' + keyword).toContainText(keyword);
      }
      for (const [url, keyword] of [[ACCOUNTS, 'password'], [BANK, 'bank'], [SECRET, 'secret']]) {
        await expect(tabItem(popup, url), '[E2] 敏感标签唯一且仍展示').toHaveCount(1);
        await expect(tabItem(popup, url).getByTestId('context-tab-url'), '[E2] 标注匹配正确 URL').toHaveText(url);
        await expect(tabItem(popup, url).getByTestId('context-tab-badge'), '[E2] 逐条显示关键词与不上传说明').toHaveText('含 ' + keyword + ' · 不上传');
      }
      await observer.settle();
      await ext.snap(popup, '内置默认及三条敏感标注');
    });
    await test.step('S3：捕获端口 9 同步尝试，失败后标签仍可读', async () => {
      const mark = observer.requests.length;
      await popup.getByTestId('sync-button').click();
      await expect(popup.getByTestId('sync-status'), '[E4] 同步最终失败').toHaveAttribute('data-status', 'error');
      await expect.poll(() => ext.getStorage('syncState').then(({ syncState }) => syncState?.lastError?.code), { message: '等待真实网络错误写入 storage' }).toBe('BACKEND_UNREACHABLE');
      const state = await ext.getStorage('syncState');
      expect(state.syncState.lastError.code, '[E4] 真实网络错误为 BACKEND_UNREACHABLE').toBe('BACKEND_UNREACHABLE');
      await observer.settle();
      const syncs = observer.since(mark, '/api/sync');
      expect(syncs, '[E3] 捕获一次真实同步出站尝试').toHaveLength(1);
      const sync = syncs[0];
      expect(new URL(sync.url).origin, '[E3] 同步尝试确实指向端口 9').toBe(UNREACHABLE);
      expect(sync.body.activeTab.url, '[E3] activeTab 仅保留普通页').toBe(DOCS);
      expect(sync.body.openTabs.map((tab) => tab.url), '[E3] openTabs 仅保留普通 docs').toEqual([DOCS]);
      expect(sync.body.history, '[E3] 历史为空').toEqual([]);
      for (const url of [ACCOUNTS, BANK, SECRET]) {
        expect(JSON.stringify(sync.body), '[E3] 失败请求也在上传前剔除敏感 URL').not.toContain(url);
      }
      expect(sync.failure, '[E4] 记录实际网络失败').toMatch(/\S+/);
      await expect.poll(async () => (await popup.getByTestId('context-tabs-list').getByTestId('context-tab-url').allTextContents()).sort(), { message: '等待失败后上下文标签保持可读' }).toEqual([ACCOUNTS, BANK, SECRET, DOCS].sort());
      expect((await popup.getByTestId('context-tabs-list').getByTestId('context-tab-url').allTextContents()).sort(), '[E5] 失败后四页仍展示，敏感项只标注').toEqual([ACCOUNTS, BANK, SECRET, DOCS].sort());
      await ext.snap(popup, '同步失败但敏感记录仍可读');
    });
  } finally {
    await observer?.close();
  }
});

