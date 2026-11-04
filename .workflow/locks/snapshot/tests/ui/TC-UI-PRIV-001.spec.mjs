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
const DOCS = 'https://example.com/docs';

test('TC-UI-PRIV-001 默认敏感词命中两标签：上传前剔除且上下文逐条标注', async ({ ext, api, evidence }) => {
  let observer;
  let popup;
  try {
    await test.step('S1：打开两条敏感标签和普通对照页，清空历史', async () => {
      const config = await api.get('/api/config');
      expect(config.status, '前置：真实默认配置可读').toBe(200);
      expect(config.body.privacySensitiveKeywords, '前置：默认关键词顺序固定').toEqual(['password', 'token', 'bank', 'secret']);
      expect(config.body.enablePrivacyFilter, '前置：默认开启隐私过滤').toBe(true);
      const pages = await preparePages(ext, [ACCOUNTS, BANK, DOCS]);
      await ext.snap(pages.at(-1), '普通页活动且历史已清空');
    });
    await test.step('S2：核对真实上下文并逐条检查敏感标注', async () => {
      observer = observeBackend(ext, evidence, [ACCOUNTS, BANK]);
      popup = await openContext(ext, observer);
      const context = await readContext(popup, evidence);
      expect(context.currentPage.url, '前置：当前普通页为 docs').toBe(DOCS);
      expect(context.tabs.map((tab) => tab.url).sort(), '前置：上下文包含且仅包含声明的三页').toEqual([ACCOUNTS, BANK, DOCS].sort());
      expect(context.history, '前置：上下文历史为空').toEqual([]);
      await expect(tabItem(popup, ACCOUNTS), '[E1] accounts 标签唯一').toHaveCount(1);
      await expect(tabItem(popup, ACCOUNTS).getByTestId('context-tab-url'), '[E1] 标注对应完整 accounts URL').toHaveText(ACCOUNTS);
      await expect(tabItem(popup, ACCOUNTS).getByTestId('context-tab-badge'), '[E1] 按默认顺序优先命中 password').toHaveText('含 password · 不上传');
      await expect(tabItem(popup, BANK), '[E2] bank 标签唯一').toHaveCount(1);
      await expect(tabItem(popup, BANK).getByTestId('context-tab-url'), '[E2] 标注对应完整 bank URL').toHaveText(BANK);
      await expect(tabItem(popup, BANK).getByTestId('context-tab-badge'), '[E2] bank 标签明确不上传').toHaveText('含 bank · 不上传');
      await observer.settle();
      await ext.snap(popup, '两条敏感记录分别标注');
    });
    await test.step('S3：独立记录点击同步区间并核对上行、计数和响应', async () => {
      const mark = observer.requests.length;
      await popup.getByTestId('sync-button').click();
      await expect(popup.getByTestId('sync-status'), '[E5] 同步最终成功').toHaveAttribute('data-status', 'success');
      await expect(popup.getByTestId('sync-status'), '[E5] 成功文案可见').toContainText('同步成功');
      await observer.settle();
      const syncs = observer.since(mark, '/api/sync');
      expect(syncs, '[E3] 点击区间恰好一次真实 POST /api/sync').toHaveLength(1);
      const sync = syncs[0];
      expect(sync.body.activeTab.url, '[E3] activeTab 保留普通 docs').toBe(DOCS);
      expect(sync.body.openTabs.map((tab) => tab.url), '[E3] openTabs 仅上传普通 docs').toEqual([DOCS]);
      expect(sync.body.history, '[E3] 历史为空').toEqual([]);
      expect(JSON.stringify(sync.body), '[E3] 上传前剔除 accounts').not.toContain(ACCOUNTS);
      expect(JSON.stringify(sync.body), '[E3] 上传前剔除 bank').not.toContain(BANK);
      await expect(popup.getByTestId('sync-filtered-count'), '[E4] 过滤两条敏感标签').toHaveText('2');
      await expect(popup.getByTestId('sync-uploaded-count'), '[E4] 普通 active/open 各计一次').toHaveText('2');
      expect(sync.response.status, '[E6] 真实同步响应为 200').toBe(200);
      expect(sync.response.body, '[E6] 后端接收两条、未再拒收且去重为一页').toMatchObject({ received: 2, rejected: 0, pageCount: 1 });
      await expect.poll(() => ext.getStorage('syncState').then(({ syncState }) => syncState.status), { message: '前置：同步状态已持久化' }).toBe('success');
      await ext.snap(popup, '过滤两条并同步成功');
    });
    await test.step('S4：真实 ranked 和 health 核对普通页入库', async () => {
      const ranked = await api.get('/api/pages/ranked');
      expect(ranked.status, '[E7] ranked 真实响应成功').toBe(200);
      expect(ranked.body.pages.map((page) => page.url), '[E7] URL 集合恰为普通 docs').toEqual([DOCS]);
      const health = await api.get('/api/health');
      expect(health.status, '[E8] health 真实响应成功').toBe(200);
      expect(health.body.pageCount, '[E8] 后端只有一页').toBe(1);
      await ext.snap(popup, '后端核对完成');
    });
  } finally {
    await observer?.close();
  }
});

