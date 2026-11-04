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

test('TC-UI-REC-002 点击第一条推荐只新增一个活动 Actions 标签页', async ({ ext, api, evidence }) => {
  await prepareBrowser(ext, evidence);
  let observer;
  let popup;
  let before;
  let originalPR;
  let originalPopup;
  let newPage;
  let probeInstalled = false;
  try {
    await test.step('S1：独立导入样例，打开四页并确认 PR 活动', async () => {
      await ext.mockSites({ ...sampleSites(), [ACTIONS]: 'Actions · org/repo' });
      await api.loadSample();
      await openCurrentTabs(ext, SAMPLE_URLS);
    });
    await test.step('S2：观察真实推荐并打开首页等待 Actions', async () => {
      observer = observeBackend(ext, evidence);
      popup = await ext.openPopup();
      const response = await waitForRecommendation(observer);
      expect(response.status, '前置：真实推荐成功').toBe(200);
      expect(response.body.recommendations[0].url, '[E1] 实际首条 URL 为 Actions').toBe(ACTIONS);
      await expect(popup.getByTestId('rec-list').getByTestId('rec-item').first().getByTestId('rec-item-title'),
        '[E1] 点击前首条标题为 Actions').toHaveText('Actions · org/repo');
      await expect(popup.getByTestId('rec-loading'), '前置：网络加载完成').toBeHidden();
      await ext.snap(popup, '点击前首页');
    });
    await test.step('S3：记录原 tab 并在点击前注册 page 和 tabs 事件', async () => {
      before = await ext.swEval(() => chrome.tabs.query({ windowType: 'normal' }));
      originalPR = before.find((tab) => tab.url === PR);
      originalPopup = before.find((tab) => tab.url === ext.popupUrl);
      expect(before.filter((tab) => tab.url === PR), '前置：原 PR 唯一存在').toHaveLength(1);
      expect(before.filter((tab) => tab.url === ext.popupUrl), '前置：原 popup 唯一存在').toHaveLength(1);
      await ext.swEval(() => {
        const events = [];
        const onCreated = (tab) => events.push({ type: 'created', tabId: tab.id, url: tab.url || tab.pendingUrl, active: tab.active });
        const onActivated = (info) => events.push({ type: 'activated', ...info });
        globalThis.__recTabProbe = { events, onCreated, onActivated };
        chrome.tabs.onCreated.addListener(onCreated);
        chrome.tabs.onActivated.addListener(onActivated);
      });
      probeInstalled = true;
      const pagePromise = ext.context.waitForEvent('page');
      [newPage] = await Promise.all([
        pagePromise,
        popup.getByTestId('rec-list').getByTestId('rec-item').first().click(),
      ]);
    });
    await test.step('S4：验证新增活动标签页，原 PR 与 popup 均保留', async () => {
      await expect(newPage, '[E3] 新页面导航至 Actions').toHaveURL(ACTIONS);
      await newPage.waitForLoadState('domcontentloaded');
      await expect.poll(async () => (await ext.swEval(() => chrome.tabs.query({ windowType: 'normal' })))
        .filter((tab) => !before.some((old) => old.id === tab.id)).map((tab) => ({ url: tab.url, active: tab.active })),
      { message: '新 tab 应导航完成且处于活动状态' }).toEqual([{ url: ACTIONS, active: true }]);
      const after = await ext.swEval(() => chrome.tabs.query({ windowType: 'normal' }));
      const added = after.filter((tab) => !before.some((old) => old.id === tab.id));
      expect(added, '[E2] 相比点击前恰好新增一个 tabId').toHaveLength(1);
      expect(after.length, '[E2] 没有通过关闭其它页面替换标签页').toBe(before.length + 1);
      expect(before.map((tab) => tab.id), '[E2] 新 id 与所有旧 id 不同').not.toContain(added[0].id);
      expect(added[0].url, '[E3] 新标签页 URL 为 Actions').toBe(ACTIONS);
      expect(added[0].active, '[E4] 新标签页活动').toBe(true);
      expect([originalPR.id, originalPopup.id], '[E4] 新标签页不是原 PR 或 popup').not.toContain(added[0].id);
      expect(after.filter((tab) => tab.id === originalPR.id).map((tab) => tab.url), '[E5] 原 PR tabId 与 URL 保留').toEqual([PR]);
      expect(after.filter((tab) => tab.id === originalPopup.id).map((tab) => tab.url), '[E6] 原 popup tabId 与 URL 保留').toEqual([ext.popupUrl]);
      const events = await ext.swEval(() => globalThis.__recTabProbe.events);
      expect(events.filter((event) => event.type === 'created').map((event) => event.tabId), '[E2] 确实只创建这一个标签页').toEqual([added[0].id]);
      expect(events.filter((event) => event.type === 'activated').map((event) => event.tabId), '[E4] 捕获新标签页活动事件').toContain(added[0].id);
      evidence.note(`标签页前后快照与事件：${JSON.stringify({ before, after, events })}`);
      await ext.snap(newPage, '新Actions活动页');
      await ext.snap(popup, '原popup仍保留');
    });
  } finally {
    try {
      await observer?.close();
    } finally {
      if (probeInstalled) {
        await ext.swEval(() => {
          const probe = globalThis.__recTabProbe;
          chrome.tabs.onCreated.removeListener(probe.onCreated);
          chrome.tabs.onActivated.removeListener(probe.onActivated);
          delete globalThis.__recTabProbe;
        });
      }
    }
  }
});
