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

const SENSITIVE = 'https://example.com/login?TOKEN=abc';
const CANDIDATES = ['https://example.org/guide-a', 'https://example.org/guide-b'];
const RECOMMENDATIONS = '/api/recommendations/next';

function assertRecommendationPrivacy(requests) {
  expect(requests.length, '[E1] 必须实际发出推荐 POST，空集合不能通过').toBeGreaterThanOrEqual(1);
  for (const entry of requests) {
    expect(entry.body, '[E1] 每次真实推荐都显式保留 currentPage 键且值为 null').toHaveProperty('currentPage', null);
    expect(entry.body.openTabs, '[E1] 每次推荐的 openTabs 都被过滤为空').toEqual([]);
    expect(entry.body.recentHistory, '[E1] 每次推荐的敏感历史被过滤为空').toEqual([]);
    expect(JSON.stringify(entry.body).split(SENSITIVE).length - 1, '[E1] 每次推荐请求体中敏感 URL 出现次数为零').toBe(0);
  }
}

test('TC-UI-PRIV-009 敏感当前页同时进入历史：同步过滤且推荐发送 null、缓存键不泄漏', async ({ ext, api, evidence }) => {
  let observer;
  let popup;
  try {
    const now = Date.now();
    const seeded = await api.seed({
      history: CANDIDATES.map((url, index) => ({ url, title: 'Guide ' + (index + 1), lastVisitTime: now, visitCount: 10 })),
    });
    expect(seeded.status, '前置：通过真实同步接口导入普通候选').toBe(200);
    expect(seeded.body, '前置：仅导入两页普通候选，无拒收').toMatchObject({ created: 2, rejected: 0, pageCount: 2 });
    await test.step('S1：仅打开敏感当前页并新增真实敏感历史，观察首页推荐', async () => {
      await preparePages(ext, [SENSITIVE], { history: [SENSITIVE] });
      observer = observeBackend(ext, evidence, [SENSITIVE]);
      popup = await ext.openPopup();
      await expect(popup.getByTestId('sync-button'), '前置：首页同步按钮可用').toBeEnabled();
      await expect.poll(() => observer.since(0, RECOMMENDATIONS).filter((entry) => entry.response?.status === 200).length, { message: '首页必须自行发起真实推荐并完成响应' }).toBeGreaterThanOrEqual(1);
      await expect(popup.getByTestId('rec-loading'), '前置：首页推荐加载结束').toBeHidden();
      await observer.settle();
      assertRecommendationPrivacy(observer.since(0, RECOMMENDATIONS));
      await ext.snap(popup, '敏感当前页首页推荐已过滤');
    });
    await test.step('S2：同步过滤三处敏感来源，观察同步后推荐刷新', async () => {
      const mark = observer.requests.length;
      await popup.getByTestId('sync-button').click();
      await expect(popup.getByTestId('sync-status'), '[E2] 敏感来源过滤后同步成功').toHaveAttribute('data-status', 'success');
      await expect.poll(() => observer.since(mark, RECOMMENDATIONS).filter((entry) => entry.response?.status === 200).length, { message: '同步成功后必须完成真实推荐刷新' }).toBeGreaterThanOrEqual(1);
      await observer.settle();
      const syncs = observer.since(mark, '/api/sync');
      expect(syncs, '[E2] 恰好一次真实同步请求').toHaveLength(1);
      const sync = syncs[0];
      expect(sync.body, '[E2] activeTab 键存在且显式为 null').toHaveProperty('activeTab', null);
      expect(sync.body.openTabs, '[E2] 敏感标签过滤为空').toEqual([]);
      expect(sync.body.history, '[E2] 敏感历史过滤为空').toEqual([]);
      expect(JSON.stringify(sync.body).split(SENSITIVE).length - 1, '[E2] 同步请求不含敏感 URL').toBe(0);
      await expect(popup.getByTestId('sync-filtered-count'), '[E2] active、tab、history 三处各过滤一次').toHaveText('3');
      expect(sync.response.status, '[E2] 真实同步响应为 200').toBe(200);
      expect(sync.response.body.rejected, '[E2] 上行已经过滤，后端拒收为零').toBe(0);
      assertRecommendationPrivacy(observer.since(mark, RECOMMENDATIONS));
      await ext.snap(popup, '同步过滤三条并完成推荐刷新');
    });
    await test.step('S3：核对本例所有推荐、缓存键、全部 storage 与 ranked 无泄漏', async () => {
      await observer.settle();
      assertRecommendationPrivacy(observer.since(0, RECOMMENDATIONS));
      await expect.poll(() => ext.getStorage('cache').then(({ cache }) => Number.isInteger(cache?.recommendations?.__none__?.cachedAt)), { message: '等待 __none__ 推荐缓存写入' }).toBe(true);
      const storage = await ext.getStorage();
      const recommendationCache = storage.cache.recommendations;
      expect(recommendationCache, '[E3] 存在 __none__ 的 data 字段').toHaveProperty('__none__.data');
      const entry = recommendationCache.__none__;
      expect(Object.keys(entry).sort(), '[E3] __none__ 保存 data 和 cachedAt').toEqual(['cachedAt', 'data']);
      expect(Number.isInteger(entry.cachedAt), '[E3] 推荐缓存时间为整数').toBe(true);
      expect(entry.cachedAt, '[E3] 推荐缓存时间为正整数').toBeGreaterThanOrEqual(1);
      expect(entry.cachedAt, '[E3] 推荐缓存时间不晚于当前读取').toBeLessThanOrEqual(Date.now());
      const normalized = new URL(SENSITIVE);
      normalized.hash = '';
      const keys = Object.keys(recommendationCache);
      expect(keys, '[E3] 推荐缓存键不含原始敏感 URL').not.toContain(SENSITIVE);
      expect(keys, '[E3] 推荐缓存键不含敏感 URL 的去 hash 形式').not.toContain(normalized.href);
      expect(JSON.stringify(storage).split(SENSITIVE).length - 1, '[E4] local storage 所有字段中敏感 URL 出现次数为零').toBe(0);
      const ranked = await api.get('/api/pages/ranked');
      expect(ranked.status, '[E5] ranked 查询成功').toBe(200);
      expect(JSON.stringify(ranked.body.pages).split(SENSITIVE).length - 1, '[E5] ranked 中敏感 URL 出现次数为零').toBe(0);
      expect(ranked.body.pages.map((page) => page.url).sort(), '[E5] 后端只保留本例普通候选').toEqual([...CANDIDATES].sort());
      await ext.snap(popup, '推荐缓存及后端无敏感URL');
    });
  } finally {
    await observer?.close();
  }
});

