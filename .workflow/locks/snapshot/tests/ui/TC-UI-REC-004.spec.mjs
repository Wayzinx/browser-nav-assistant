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

test('TC-UI-REC-004 真实返回五条推荐时首页严格显示前三条', async ({ ext, api, evidence }) => {
  await prepareBrowser(ext, evidence);
  const current = 'https://news.example.org/c';
  const urls = Array.from({ length: 5 }, (_, index) => `https://news.example.org/a${index + 1}`);
  const counts = [10, 8, 6, 4, 2];
  let importedAt;
  let observer;
  let popup;
  let recs;
  try {
    await test.step('S1：真实导入五条候选，只打开同域当前页', async () => {
      importedAt = Date.now();
      const seeded = await api.post('/api/sync', {
        activeTab: null, openTabs: [],
        history: urls.map((url, index) => ({ url, title: `候选${index + 1}`, visitCount: counts[index], lastVisitTime: importedAt - 300_000 })),
      });
      expect(seeded.status, '前置：真实导入成功').toBe(200);
      const health = await api.get('/api/health');
      expect(health.status, '前置：health 成功').toBe(200);
      expect(health.body.pageCount, '前置：只有五条候选').toBe(5);
      await ext.mockSites({ [current]: '同域当前页' });
      await openCurrentTabs(ext, [current]);
      evidence.note(`T=${importedAt}，visitCount=${JSON.stringify(counts)}；pageScore=[0.80,0.77,0.74,0.70,0.64]；same_domain final=0.6*0.6+0.4*pageScore。`);
    });
    await test.step('S2：打开前观察真实网络，等待首页推荐完成', async () => {
      observer = observeBackend(ext, evidence);
      popup = await ext.openPopup();
      const response = await waitForRecommendation(observer);
      expect(response.startedAt - importedAt, '前置：导入后 60 秒内取数').toBeLessThan(60_000);
      expect(response.status, '[E1] 推荐真实 HTTP 200').toBe(200);
      expect(response.requestBody.currentPage.url, '[E1] 请求当前页为 c').toBe(current);
      expect(response.requestBody.openTabs.map((tab) => tab.url), '[E1] 请求仅有当前页 c').toEqual([current]);
      recs = response.body.recommendations;
    });
    await test.step('S3：将五条响应与首页前三条逐项对照', async () => {
      expect(recs, '[E2] 真实响应五条推荐').toHaveLength(5);
      expect(recs.map((rec) => rec.url), '[E2] 五条 URL 和顺序精确匹配').toEqual(urls);
      expect(recs.map((rec) => rec.score), '[E3] 五条最终分数精确匹配').toEqual([0.68, 0.67, 0.66, 0.64, 0.62]);
      const items = popup.getByTestId('rec-list').getByTestId('rec-item');
      const top = recs.slice(0, 3);
      await expect(items, '[E4] 首页总数严格为三').toHaveCount(3);
      await expect(items.getByTestId('rec-item-title'), '[E5] 首页显示候选一二三').toHaveText(['候选1', '候选2', '候选3']);
      await expect(items.getByTestId('rec-item-title'), '[E5] 首页标题等于响应前三条').toHaveText(top.map((rec) => rec.title));
      await expect(items.getByTestId('rec-item-score'), '[E6] 首页精确两位小数分数').toHaveText(['0.68', '0.67', '0.66']);
      await expect(items.getByTestId('rec-item-score'), '[E6] 首页分数等于响应前三条').toHaveText(top.map((rec) => rec.score.toFixed(2)));
      for (const [index, rec] of top.entries()) {
        await expect(items.nth(index), '[E4] 前三条推荐分别可见').toBeVisible();
        expect(rec.reason.trim(), '[E7] 真实推荐理由非空').toMatch(/\S/);
        await expect(items.nth(index).getByTestId('rec-item-reason'), '[E7] 理由等于对应真实推荐').toHaveText(rec.reason);
        await expect(items.nth(index).getByTestId('rec-item-reason'), '[E7] 页面理由非空').not.toHaveText(/^\s*$/);
      }
      await expect(popup.getByTestId('rec-loading'), '[E9] 最终加载态隐藏').toBeHidden();
      await expect(popup.getByTestId('rec-empty'), '[E9] 最终空态隐藏').toBeHidden();
      await expect(popup.getByTestId('rec-error'), '[E9] 最终错误态隐藏').toBeHidden();
      evidence.note(`真实五条到首页三条：${JSON.stringify({ response: recs, displayed: top })}`);
    });
    await test.step('S4：确认第四第五条未展示并截图', async () => {
      const titles = popup.getByTestId('rec-list').getByTestId('rec-item-title');
      await expect(titles.filter({ hasText: /^候选[45]$/ }), '[E8] 候选四和五不存在于标题列表').toHaveCount(0);
      await ext.snap(popup, '五条响应只展示前三条');
    });
  } finally {
    await observer?.close();
  }
});
