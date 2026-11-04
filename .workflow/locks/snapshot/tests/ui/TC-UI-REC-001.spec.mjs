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

test('TC-UI-REC-001 样例 PR 首页展示三条精确推荐、分数与理由', async ({ ext, api, evidence }) => {
  await prepareBrowser(ext, evidence);
  let sample;
  let observer;
  let popup;
  try {
    await test.step('S1：离线化外站并经真实同步接口导入样例', async () => {
      await ext.mockSites(sampleSites());
      sample = await api.loadSample();
      const health = await api.get('/api/health');
      expect(health.status, '前置：health 成功').toBe(200);
      expect(health.body.pageCount, '前置：样例入库十页').toBe(10);
    });
    await test.step('S2：打开四个样例普通页面并确认 PR 活动', async () => {
      await openCurrentTabs(ext, SAMPLE_URLS);
    });
    await test.step('S3：先观察 SW 推荐网络，再以标签页打开 popup', async () => {
      observer = observeBackend(ext, evidence);
      popup = await ext.openPopup();
    });
    await test.step('S4：等待网络结果并逐项对照三条推荐', async () => {
      const response = await waitForRecommendation(observer);
      expect(response.startedAt - sample.now, '前置：导入后 60 秒内取数').toBeLessThan(60_000);
      expect(response.status, '[E1] 真实推荐 HTTP 200').toBe(200);
      expect(response.requestBody.currentPage.url, '[E1] 实际当前页为 PR').toBe(PR);
      expect(response.requestBody.openTabs.map((tab) => tab.url).sort(), '[E2] 只发送四个样例普通页').toEqual([...SAMPLE_URLS].sort());
      const recs = response.body.recommendations;
      const titles = ['Actions · org/repo', 'useState – React', 'Quick Start – React'];
      expect(recs, '[E3] 真实响应恰有三条').toHaveLength(3);
      expect(recs.map((rec) => rec.title), '[E3] 真实响应标题与顺序精确匹配').toEqual(titles);
      const items = popup.getByTestId('rec-list').getByTestId('rec-item');
      await expect(items, '[E4] 首页恰好三条').toHaveCount(3);
      await expect(items.getByTestId('rec-item-title'), '[E4] 首页标题序列匹配').toHaveText(titles);
      const scores = ['0.87', '0.46', '0.41'];
      expect(recs.map((rec) => rec.score.toFixed(2)), '[E5] 响应分数精确匹配').toEqual(scores);
      await expect(items.getByTestId('rec-item-score'), '[E5] 首页显示两位小数精确分数').toHaveText(scores);
      await expect(items.getByTestId('rec-item-score'), '[E5] 首页分数逐项等于真实响应').toHaveText(recs.map((rec) => rec.score.toFixed(2)));
      for (const [index, rec] of recs.entries()) {
        expect(rec.reason.trim(), '[E6] 真实理由非空').toMatch(/\S/);
        await expect(items.nth(index), '[E4] 每条推荐可见').toBeVisible();
        await expect(items.nth(index).getByTestId('rec-item-reason'), '[E6] 理由逐项等于真实响应').toHaveText(rec.reason);
        await expect(items.nth(index).getByTestId('rec-item-reason'), '[E6] 页面理由非空').not.toHaveText(/^\s*$/);
      }
      await expect(items.first().getByTestId('rec-item-reason'), '[E7] 第一条理由包含 PR').toContainText('PR');
      await expect(items.first().getByTestId('rec-item-reason'), '[E7] 第一条理由包含 CI').toContainText('CI');
      await expect(popup.getByTestId('rec-loading'), '[E8] 加载结束').toBeHidden();
      await expect(popup.getByTestId('rec-empty'), '[E8] 空态隐藏').toBeHidden();
      await expect(popup.getByTestId('rec-error'), '[E8] 错误态隐藏').toBeHidden();
      await ext.snap(popup, '三条推荐与分数理由');
    });
  } finally {
    await observer?.close();
  }
});
