import { test, expect, readResource } from '../fixtures/extension.mjs';

// TDD 草稿：只观察真实插件与真实后端，不替换业务消息、返回值或缓存。
const PR = 'https://github.com/org/repo/pull/456';
const ACTIONS = 'https://github.com/org/repo/actions';
const SAMPLE_URLS = [
  'https://github.com/org/repo/issues/123',
  'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API',
  'https://docs.internal.com/ai-agent-design',
  PR,
];

async function prepareBrowser(ext, evidence) {
  // 先保留初始页，待普通标签页建成后关闭，避免关闭 persistent context 的最后窗口。
  await ext.swEval(async () => {
    await chrome.history.deleteAll();
    await chrome.storage.local.remove(['cache', 'connection', 'syncState']);
  });
  const storage = await ext.getStorage(['cache', 'connection', 'syncState']);
  expect(storage, '前置：没有缓存或自动恢复标记').toEqual({});
  evidence.note(`打开 popup 前的恢复状态：${JSON.stringify(storage)}`);
}

function sampleSites() {
  const raw = readResource();
  return Object.fromEntries([...raw.history, ...raw.openTabs, raw.activeTab].map(({ url, title }) => [url, title]));
}

async function openCurrentTabs(ext, urls) {
  const previousPages = [...ext.context.pages()];
  await ext.seedHistory(urls);
  const pages = await ext.openTabs(urls);
  await Promise.all(previousPages.map((page) => page.close()));
  await pages.at(-1).bringToFront();
  await expect.poll(() => ext.swEval(async () =>
    (await chrome.tabs.query({ active: true, lastFocusedWindow: true })).map((tab) => tab.url)),
  { message: '前置：最后打开的普通页面为活动页' }).toEqual([urls.at(-1)]);
  const tabs = await ext.swEval(() => chrome.tabs.query({ windowType: 'normal' }));
  expect(tabs.filter((tab) => /^https?:/.test(tab.url || '')).map((tab) => tab.url).sort(),
    '前置：浏览器只有本例指定的普通页面').toEqual([...urls].sort());
}

// 事件回调只收集数据；异步失败由 drain 统一重新抛出，避免未处理拒绝或漏写证据。
function observeBackend(ext, evidence, origin = new URL(ext.baseURL).origin) {
  const exchanges = [];
  const requests = [];
  const responses = [];
  const failures = [];
  const syncRequests = [];
  const tasks = [];
  const starts = new Map();
  const inFlight = new Set();
  let sequence = 0;
  let closed = false;
  const matches = (request, pathname) => Boolean(request.serviceWorker())
    && request.method() === 'POST'
    && new URL(request.url()).origin === origin
    && new URL(request.url()).pathname === pathname;
  const isRecommendation = (request) => matches(request, '/api/recommendations/next');
  const collect = (task) => tasks.push(task.then((value) => ({ value }), (error) => ({ error })));
  const onRequest = (request) => collect((async () => {
    if (isRecommendation(request)) {
      const entry = { url: request.url(), method: request.method(), body: request.postDataJSON(), startedAt: Date.now(), sequence: ++sequence };
      starts.set(request, entry);
      inFlight.add(request);
      requests.push(entry);
    }
    if (matches(request, '/api/sync')) syncRequests.push({ url: request.url(), body: request.postDataJSON() });
  })());
  const onResponse = (response) => collect((async () => {
    const request = response.request();
    if (isRecommendation(request)) {
      const status = response.status();
      responses.push({ url: response.url(), status });
      const requestEntry = starts.get(request);
      const reqId = `${evidence.caseId}-sw-${requestEntry.sequence}`;
      const body = await response.json();
      const entry = { requestBody: request.postDataJSON(), body, status, startedAt: requestEntry.startedAt, sequence: requestEntry.sequence };
      evidence.recordApi({
        reqId, setup: false, observed: true, method: request.method(), url: request.url(),
        requestHeaders: request.headers(), requestBody: entry.requestBody,
        status, responseHeaders: response.headers(), responseBody: body,
        ms: Date.now() - entry.startedAt,
      });
      exchanges.push(entry);
    }
  })());
  const onFinished = (request) => { inFlight.delete(request); };
  const onFailed = (request) => collect((async () => {
    inFlight.delete(request);
    if (isRecommendation(request)) {
      const entry = { method: request.method(), url: request.url(), requestBody: request.postDataJSON(),
        errorText: request.failure()?.errorText || '' };
      failures.push(entry);
      evidence.note(`真实推荐连接失败（无 HTTP 响应码）：${JSON.stringify(entry)}`);
    }
  })());
  ext.context.on('request', onRequest);
  ext.context.on('response', onResponse);
  ext.context.on('requestfailed', onFailed);
  ext.context.on('requestfinished', onFinished);
  async function drain() {
    let consumed = 0;
    const errors = [];
    while (consumed < tasks.length) {
      const end = tasks.length;
      const settled = await Promise.all(tasks.slice(consumed, end));
      consumed = end;
      errors.push(...settled.filter((item) => Object.hasOwn(item, 'error')).map((item) => item.error));
    }
    if (errors.length) throw new AggregateError(errors, 'SW 网络取证失败');
  }
  async function settle() {
    await expect.poll(() => inFlight.size,
      { message: '等待所有已发出的 SW 推荐请求结束并完成取证' }).toBe(0);
    await drain();
  }
  async function close() {
    if (!closed) {
      try {
        await settle();
      } finally {
        closed = true;
        ext.context.off('request', onRequest);
        ext.context.off('response', onResponse);
        ext.context.off('requestfailed', onFailed);
        ext.context.off('requestfinished', onFinished);
        evidence.note(`SW 网络观察汇总：${JSON.stringify({ requests, responses, failures, syncRequests })}`);
      }
    }
  }
  return { exchanges, requests, responses, failures, syncRequests, drain, settle, close };
}

async function waitForRecommendation(observer) {
  await expect.poll(async () => {
    await observer.drain();
    return observer.exchanges.length;
  }, { message: '首页必须自行发起真实推荐 POST 并完成响应取证' }).toBeGreaterThan(0);
  await observer.settle();
  return [...observer.exchanges].sort((left, right) => left.sequence - right.sequence).at(-1);
}

test('TC-UI-REC-006 无缓存且真实后端连接失败时显示错误与诊断入口', async ({ ext, api, evidence }) => {
  await prepareBrowser(ext, evidence);
  const unreachable = 'http://127.0.0.1:9';
  let observer;
  let popup;
  try {
    await test.step('S1：用可达后端确认空库，仅打开 PR 外站', async () => {
      const health = await api.get('/api/health');
      expect(health.status, '前置：API 夹具仍连接正常后端').toBe(200);
      expect(health.body.pageCount, '前置：后端空库').toBe(0);
      await ext.mockSites({ [PR]: 'Refactor auth middleware (#456)' });
      await openCurrentTabs(ext, [PR]);
    });
    await test.step('S2：仅插件切换端口9，读回无缓存并注册网络观察', async () => {
      await ext.useUnreachableBackend();
      const storage = await ext.getStorage(['apiBaseUrl', 'cache']);
      expect(storage.apiBaseUrl, '[E1] 插件后端为端口9').toBe(unreachable);
      expect(Object.hasOwn(storage, 'cache'), '[E1] 推荐缓存 key 不存在').toBe(false);
      evidence.note(`打开 popup 前读回：${JSON.stringify(storage)}`);
      observer = observeBackend(ext, evidence, unreachable);
    });
    await test.step('S3：打开首页并等待真实推荐连接失败', async () => {
      popup = await ext.openPopup();
      await expect.poll(() => observer.failures.length, { message: '必须观察到 SW 推荐真实 requestfailed' }).toBeGreaterThan(0);
      expect(observer.failures, '[E7] 至少一次真正的 SW 推荐连接失败').not.toHaveLength(0);
      for (const failure of observer.failures) {
        expect(failure.method, '[E7] 失败请求为 POST').toBe('POST');
        expect(failure.url, '[E7] 失败来自端口9推荐接口').toBe(`${unreachable}/api/recommendations/next`);
        expect(failure.errorText.trim(), '[E7] 实际网络错误文本非空').toMatch(/\S/);
      }
      await expect(popup.getByTestId('rec-error'), '[E2] 网络完成后错误态可见').toBeVisible();
      await expect(popup.getByTestId('rec-error'), '[E2] 实际错误文案非空').not.toHaveText(/^\s*$/);
      await expect(popup.getByTestId('rec-loading'), '[E6] 网络完成后不再加载').toBeHidden();
    });
    await test.step('S4：检查错误内诊断入口，排除空态和伪成功', async () => {
      const diagnostic = popup.getByTestId('rec-error').getByTestId('error-diag-link');
      await expect(diagnostic, '[E3] 推荐错误内的诊断入口可见').toBeVisible();
      await expect(diagnostic, '[E3] 诊断入口含诊断文案').toContainText('诊断');
      await expect(popup.getByTestId('rec-empty'), '[E4] 连接失败不能显示空态').toBeHidden();
      await expect(popup.getByTestId('rec-list').getByTestId('rec-item'), '[E5] 连接失败没有推荐').toHaveCount(0);
      await expect(popup.getByTestId('rec-loading'), '[E6] 不允许无限加载').toBeHidden();
      await ext.snap(popup, '真实连接失败与诊断入口');
      await observer.close();
      const successfulResponses = observer.responses.filter((response) => response.status >= 200 && response.status < 300);
      expect(successfulResponses, '[E8] S2 至 S4 不存在端口9推荐接口的成功 HTTP 响应').toHaveLength(0);
    });
  } finally {
    await observer?.close();
  }
  // 独立 persistent context 由 extension fixture 在 teardown 关闭，端口9设置不跨用例。
});
