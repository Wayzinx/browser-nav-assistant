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

const COOKIE = 'https://example.com/?cookie=1';
const DOCS = 'https://example.com/docs';
const KEYWORDS = ['password', 'token', 'bank', 'secret', 'cookie'];
const UNREACHABLE = 'http://127.0.0.1:9';

test('TC-UI-PRIV-006 已有 cookie 配置缓存后断网：仍用缓存关键词且失败不覆盖缓存', async ({ ext, api, evidence }) => {
  let observer;
  let popup;
  let savedConfig;
  try {
    await test.step('S1：本例在线配置 cookie，并保存真实写入的配置缓存 C', async () => {
      const updated = await api.put('/api/config', { privacySensitiveKeywords: KEYWORDS });
      expect(updated.status, '前置：通过真实接口新增 cookie').toBe(200);
      await preparePages(ext, [COOKIE, DOCS]);
      observer = observeBackend(ext, evidence, [COOKIE]);
      popup = await openContext(ext, observer);
      const context = await readContext(popup, evidence);
      expect(context.privacy.source, '前置：在线使用 server 配置').toBe('server');
      await expect(popup.getByTestId('context-privacy-keywords'), '前置：在线关键词含 cookie').toContainText('cookie');
      await observer.settle();
      await expect.poll(() => ext.getStorage('cache').then(({ cache }) => cache?.config?.data?.privacySensitiveKeywords), { message: '等待本例真实配置缓存 C 写入' }).toEqual(KEYWORDS);
      savedConfig = (await ext.getStorage('cache')).cache.config;
      expect(savedConfig.data.privacySensitiveKeywords, '前置：C 是本例在线取得的五项配置').toEqual(KEYWORDS);
      expect(Number.isInteger(savedConfig.cachedAt), '前置：真实缓存时间为整数').toBe(true);
      expect(savedConfig.cachedAt, '前置：真实缓存时间为正').toBeGreaterThanOrEqual(1);
      evidence.note('保存在线配置缓存 C：' + JSON.stringify(savedConfig));
      await ext.snap(popup, '在线取得真实cookie配置缓存');
    });
    await test.step('S2：关闭 popup 后改用端口 9，保留 C 并检查缓存来源', async () => {
      await popup.close();
      await ext.useUnreachableBackend();
      expect((await ext.getStorage('cache')).cache.config, '前置：切换地址保留在线缓存 C').toEqual(savedConfig);
      popup = await openContext(ext, observer);
      const context = await readContext(popup, evidence);
      expect(context.privacy.source, '[E1] 失败后来源为本地缓存').toBe('cache');
      expect(context.privacy.keywords, '[E1] 缓存关键词仍包含 cookie').toContain('cookie');
      await expect(popup.getByTestId('context-privacy-keywords'), '[E1] 显示本地缓存来源').toContainText('本地缓存');
      await expect(popup.getByTestId('context-privacy-keywords'), '[E1] 显示缓存 cookie 关键词').toContainText('cookie');
      await expect(tabItem(popup, COOKIE), '[E2] cookie 标签仍唯一展示').toHaveCount(1);
      await expect(tabItem(popup, COOKIE).getByTestId('context-tab-url'), '[E2] 标注对应 cookie URL').toHaveText(COOKIE);
      await expect(tabItem(popup, COOKIE).getByTestId('context-tab-badge'), '[E2] 按缓存标注 cookie 不上传').toHaveText('含 cookie · 不上传');
      await observer.settle();
      await ext.snap(popup, '断网后读取缓存与cookie标注');
    });
    await test.step('S3：失败同步仍剔除 cookie，配置缓存 data 和 cachedAt 均不改变', async () => {
      const context = await readContext(popup, evidence);
      expect(context.privacy.source, '[E1] 点击前仍使用 cache').toBe('cache');
      expect((await ext.getStorage('cache')).cache.config, '[E5] 失败读取没有覆盖 C').toEqual(savedConfig);
      await observer.settle();
      const mark = observer.requests.length;
      await popup.getByTestId('sync-button').click();
      await expect(popup.getByTestId('sync-status'), '[E4] 同步最终失败').toHaveAttribute('data-status', 'error');
      await expect.poll(() => ext.getStorage('syncState').then(({ syncState }) => syncState?.lastError?.code), { message: '等待真实连接失败写入 storage' }).toBe('BACKEND_UNREACHABLE');
      const state = await ext.getStorage('syncState');
      expect(state.syncState.lastError.code, '[E4] 保存 BACKEND_UNREACHABLE 错误').toBe('BACKEND_UNREACHABLE');
      await observer.settle();
      const syncs = observer.since(mark, '/api/sync');
      expect(syncs, '[E3] 捕获一次真实同步尝试').toHaveLength(1);
      const sync = syncs[0];
      expect(new URL(sync.url).origin, '[E3] 同步尝试确实指向端口 9').toBe(UNREACHABLE);
      expect(JSON.stringify(sync.body), '[E3] 失败请求不包含 cookie URL').not.toContain(COOKIE);
      expect(sync.body.activeTab.url, '[E3] 真实请求仍有普通 activeTab').toBe(DOCS);
      expect(sync.body.openTabs.map((tab) => tab.url), '[E3] 真实请求仅保留普通 openTabs').toEqual([DOCS]);
      expect(sync.body.history, '[E3] 真实请求历史为空').toEqual([]);
      expect(sync.failure, '[E4] 记录实际连接失败').toMatch(/\S+/);
      expect((await ext.getStorage('cache')).cache.config, '[E5] 失败后配置缓存 C 深度相等，时间戳也不变').toEqual(savedConfig);
      await ext.snap(popup, '同步失败且配置缓存未覆盖');
    });
  } finally {
    await observer?.close();
  }
});

