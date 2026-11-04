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

test('TC-UI-REC-005 十条候选均已打开时非空后端也显示空推荐', async ({ ext, api, evidence }) => {
  await prepareBrowser(ext, evidence);
  const urls = [...readResource().history.map((item) => item.url).filter((url) => url !== PR), PR];
  let before;
  let observer;
  let popup;
  try {
    await test.step('S1：独立导入样例十页并离线化全部外站', async () => {
      await ext.mockSites(sampleSites());
      await api.loadSample();
      before = await api.get('/api/health');
      expect(before.status, '前置：health 成功').toBe(200);
      expect(before.body.pageCount, '前置：后端有十页').toBe(10);
    });
    await test.step('S2：打开全部十个原始 URL，PR 最后且活动', async () => {
      await openCurrentTabs(ext, urls);
      evidence.note(`十个打开 URL：${JSON.stringify(urls)}`);
    });
    await test.step('S3：观察真实推荐并打开首页等待空结果', async () => {
      observer = observeBackend(ext, evidence);
      popup = await ext.openPopup();
      const response = await waitForRecommendation(observer);
      expect(response.requestBody.currentPage.url, '[E1] 当前页为 PR').toBe(PR);
      expect(response.requestBody.openTabs.map((tab) => tab.url).sort(), '[E1] 实际发送十个原始 URL').toEqual([...urls].sort());
      expect(response.status, '[E2] 真实推荐 HTTP 200').toBe(200);
      expect(response.body.recommendations, '[E2] 全部候选已打开后推荐为空').toEqual([]);
      await expect(popup.getByTestId('rec-loading'), '[E5] 网络结束加载态隐藏').toBeHidden();
    });
    await test.step('S4：检查空态并复核后端仍有十页', async () => {
      await expect(popup.getByTestId('rec-list').getByTestId('rec-item'), '[E3] 首页没有任何推荐').toHaveCount(0);
      await expect(popup.getByTestId('rec-empty'), '[E4] 空态可见').toBeVisible();
      await expect(popup.getByTestId('rec-empty'), '[E4] 空态含同步引导').toContainText('同步浏览器上下文');
      await expect(popup.getByTestId('rec-loading'), '[E5] 不再加载').toBeHidden();
      await expect(popup.getByTestId('rec-error'), '[E5] 不是错误态').toBeHidden();
      const after = await api.get('/api/health');
      expect(after.status, '核对：health 成功').toBe(200);
      expect(after.body.pageCount, '[E6] 后端仍然十页').toBe(10);
      expect(after.body.pageCount, '[E6] 前后页面数一致').toBe(before.body.pageCount);
      evidence.note(`非空后端与空推荐对照：${JSON.stringify({ before: before.body.pageCount, after: after.body.pageCount, recommendations: observer.exchanges[0].body.recommendations })}`);
      await ext.snap(popup, '全部候选已打开的空推荐');
    });
  } finally {
    await observer?.close();
  }
});
