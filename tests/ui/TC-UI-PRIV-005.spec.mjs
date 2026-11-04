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

test('TC-UI-PRIV-005 服务端新增 cookie 关键词：请求过滤、上下文标注与配置缓存一致', async ({ ext, api, evidence }) => {
  const startedAt = Date.now();
  let observer;
  let popup;
  try {
    await test.step('S1：通过真实配置接口增加 cookie 并核对', async () => {
      const updated = await api.put('/api/config', { privacySensitiveKeywords: KEYWORDS });
      expect(updated.status, '前置：配置修改成功').toBe(200);
      const config = await api.get('/api/config');
      expect(config.status, '前置：真实配置可读').toBe(200);
      expect(config.body.privacySensitiveKeywords, '前置：有效关键词恰为配置的五项').toEqual(KEYWORDS);
    });
    await test.step('S2：打开 cookie 标签与普通页，核对后端来源和标注', async () => {
      await preparePages(ext, [COOKIE, DOCS]);
      observer = observeBackend(ext, evidence, [COOKIE]);
      popup = await openContext(ext, observer);
      const context = await readContext(popup, evidence);
      expect(context.privacy.source, '[E1] GET_CONTEXT 使用真实后端配置').toBe('server');
      await expect(popup.getByTestId('context-privacy-keywords'), '[E1] 显示后端来源').toContainText('后端');
      await expect(popup.getByTestId('context-privacy-keywords'), '[E1] 显示新增 cookie').toContainText('cookie');
      await expect(tabItem(popup, COOKIE), '[E2] cookie 标签唯一且展示').toHaveCount(1);
      await expect(tabItem(popup, COOKIE).getByTestId('context-tab-url'), '[E2] 标注匹配 cookie URL').toHaveText(COOKIE);
      await expect(tabItem(popup, COOKIE).getByTestId('context-tab-badge'), '[E2] 明确 cookie 不上传').toHaveText('含 cookie · 不上传');
      await observer.settle();
      await ext.snap(popup, '后端新增cookie并标注');
    });
    await test.step('S3：同步并核对过滤、真实缓存、ranked 和 health', async () => {
      const mark = observer.requests.length;
      await popup.getByTestId('sync-button').click();
      await expect(popup.getByTestId('sync-status'), '[E3] 同步成功').toHaveAttribute('data-status', 'success');
      await observer.settle();
      const syncs = observer.since(mark, '/api/sync');
      expect(syncs, '[E3] 恰好一次真实 POST /api/sync').toHaveLength(1);
      const sync = syncs[0];
      expect(sync.body.activeTab.url, '[E3] activeTab 仅保留普通 docs').toBe(DOCS);
      expect(sync.body.openTabs.map((tab) => tab.url), '[E3] openTabs 仅保留普通 docs').toEqual([DOCS]);
      expect(sync.body.history, '[E3] 历史为空').toEqual([]);
      expect(JSON.stringify(sync.body), '[E3] cookie URL 在上传前被剔除').not.toContain(COOKIE);
      expect(sync.response.status, '[E3] 真实同步响应成功').toBe(200);
      expect(sync.response.body.rejected, '[E3] 后端无需再次拒收 cookie').toBe(0);
      await expect(popup.getByTestId('sync-filtered-count'), '[E3] cookie 标签过滤一条').toHaveText('1');
      await expect.poll(() => ext.getStorage('cache').then(({ cache }) => cache?.config?.data?.privacySensitiveKeywords), { message: '等待真实配置缓存写入' }).toEqual(KEYWORDS);
      const { cache } = await ext.getStorage('cache');
      expect(cache.config.data.privacySensitiveKeywords, '[E4] 配置缓存包含 cookie').toContain('cookie');
      expect(Number.isInteger(cache.config.cachedAt), '[E4] 缓存时间是整数').toBe(true);
      expect(cache.config.cachedAt, '[E4] 缓存时间属于本例且为正').toBeGreaterThanOrEqual(startedAt);
      expect(cache.config.cachedAt, '[E4] 缓存时间不晚于本次读取').toBeLessThanOrEqual(Date.now());
      const ranked = await api.get('/api/pages/ranked');
      expect(ranked.status, '[E5] ranked 查询成功').toBe(200);
      expect(ranked.body.pages.map((page) => page.url), '[E5] ranked 恰含普通页，cookie 未入库').toEqual([DOCS]);
      expect(ranked.body.pages.map((page) => page.url), '[E5] ranked 不含 cookie URL').not.toContain(COOKIE);
      const health = await api.get('/api/health');
      expect(health.status, '[E6] health 查询成功').toBe(200);
      expect(health.body.pageCount, '[E6] 后端仅一页').toBe(1);
      await ext.snap(popup, 'cookie过滤且缓存与后端一致');
    });
  } finally {
    await observer?.close();
  }
});

