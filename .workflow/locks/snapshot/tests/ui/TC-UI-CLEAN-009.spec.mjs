import { test, expect } from '../fixtures/extension.mjs';

// TDD 草稿：只观察真实插件请求；采集与清理均使用现有夹具，不拦截后端。
const observations = new WeakMap();

test.beforeEach(async ({ ext }) => {
  await ext.swEval(async (baseURL) => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({ apiBaseUrl: baseURL });
  }, ext.baseURL);
  const traffic = { requests: [], responses: [], failed: [] };
  const isBackend = (request) => [ext.baseURL, 'http://127.0.0.1:9']
    .some((base) => request.url().startsWith(`${base}/api/`));
  ext.context.on('request', (request) => { if (isBackend(request)) traffic.requests.push(request); });
  ext.context.on('response', (response) => { if (isBackend(response.request())) traffic.responses.push(response); });
  ext.context.on('requestfailed', (request) => { if (isBackend(request)) traffic.failed.push(request); });
  observations.set(ext.context, traffic);
});

test.afterEach(async ({ ext, api, evidence }) => {
  try {
    if (ext.popup && !ext.popup.isClosed()) await ext.snap(ext.popup, '结束状态');
    const traffic = observations.get(ext.context);
    for (const response of traffic.responses) {
      const request = response.request();
      const completionError = await response.finished();
      if (completionError) throw completionError;
      const responseHeaders = await response.allHeaders();
      const requestHeaders = await request.allHeaders();
      const responseBody = /json/i.test(responseHeaders['content-type'] || '')
        ? await response.json() : await response.text();
      evidence.recordApi({
        source: 'extension', method: request.method(), url: request.url(),
        reqId: responseHeaders['x-request-id'] || requestHeaders['x-request-id'] || null,
        requestHeaders, requestBody: request.postData(),
        status: response.status(), responseHeaders, responseBody,
        ms: request.timing().responseEnd, setup: false,
      });
    }
    for (const request of traffic.failed) {
      evidence.recordApi({
        source: 'extension', method: request.method(), url: request.url(),
        reqId: request.headers()['x-request-id'] || null,
        requestHeaders: await request.allHeaders(), requestBody: request.postData(),
        status: null, responseHeaders: null, responseBody: null,
        networkError: request.failure()?.errorText, setup: false,
      });
    }
  } finally {
    try {
      await ext.setApiBase(ext.baseURL);
    } finally {
      try {
        await ext.swEval(() => chrome.storage.local.clear());
      } finally {
        try {
          await api.reset();
        } finally {
          try {
            for (const page of ext.context.pages()) await page.close();
          } finally {
            await ext.context.close();
          }
        }
      }
    }
  }
});

async function waitForCleanup(ext, afterRequest) {
  const traffic = observations.get(ext.context);
  const matches = (response) => response.request().method() === 'GET'
    && new URL(response.url()).pathname === '/api/pages/cleanup-suggestions'
    && traffic.requests.indexOf(response.request()) >= afterRequest;
  await expect.poll(() => traffic.responses.filter(matches).map((response) => response.status()),
    { message: '等待插件真实拉取整理建议成功' }).toContain(200);
  const response = traffic.responses.findLast((item) => matches(item) && item.status() === 200);
  const completionError = await response.finished();
  if (completionError) throw completionError;
  // 等待网络结果写入缓存，再等待视图退出加载态，避免负向断言读到旧缓存。
  await expect.poll(async () => (await ext.getStorage('cache')).cache?.cleanup?.cachedAt,
    { message: '等待本次真实网络响应写入整理缓存' }).toBeGreaterThanOrEqual(response.request().timing().startTime);
  await expect(ext.popup.getByTestId('home-cleanup-loading'), '首页整理加载已结束').toBeHidden();
  await expect(ext.popup.getByTestId('cleanup-loading'), '整理页加载已结束').toBeHidden();
}

async function clickAction(ext, button, path) {
  const endpoint = new URL(path, ext.baseURL).href;
  const [request, response] = await Promise.all([
    ext.context.waitForEvent('request', { predicate: (item) => item.url() === endpoint && item.method() === 'POST' }),
    ext.context.waitForEvent('response', { predicate: (item) => item.url() === endpoint && item.request().method() === 'POST' }),
    button.click(),
  ]);
  expect(response.request(), 'UI 操作的响应属于本次观察到的请求').toBe(request);
  return { request: request.postDataJSON(), requestEvent: request, status: response.status(), body: await response.json() };
}

const ISSUE = 'https://github.com/org/repo/issues/123';
const COMMENTS = `${ISSUE}?tab=comments`;

test("TC-UI-CLEAN-009 渲染后的合并建议在后端reset后失效：404后刷新并保留空库", async ({ ext, api, evidence }) => {
  const traffic = observations.get(ext.context);
  await test.step('S1：重置并导入本例样例', async () => {
    await api.reset();
    const { res } = await api.loadSample();
    expect(res.status, '样例导入成功').toBe(200);
    expect(res.body.pageCount, '初始十页').toBe(10);
  });
  const popup = await test.step('S2：渲染真实重复组后清空后端，保持旧 DOM', async () => {
    const marker = traffic.requests.length;
    const page = await ext.openPopup();
    await waitForCleanup(ext, marker);
    const cleanupMarker = observations.get(ext.context).requests.length;
    await page.getByTestId('tab-cleanup').click();
    await waitForCleanup(ext, cleanupMarker);
    await expect(page.getByTestId('cleanup-group-merge').getByTestId('cleanup-item').filter({ hasText: COMMENTS }), '重复组已真实渲染').toHaveCount(1);
    expect(await ext.getStorage('lastCleanupAction'), '[E6] 操作前没有成功记录').not.toHaveProperty('lastCleanupAction');
    await ext.snap(page, '旧重复组');
    await api.reset();
    const health = await api.get('/api/health');
    expect(health.status, 'reset 后健康检查成功').toBe(200);
    expect(health.body.pageCount, '后端已清空').toBe(0);
    await expect(page.getByTestId('cleanup-group-merge').getByTestId('cleanup-item').filter({ hasText: COMMENTS }), '待点击的旧重复组仍存在').toHaveCount(1);
    await ext.snap(page, '后端重置后旧重复组');
    return page;
  });
  const failedAction = await test.step('S3：实际点击旧组，捕获真实合并 404', async () => {
    const item = popup.getByTestId('cleanup-group-merge').getByTestId('cleanup-item').filter({ hasText: COMMENTS });
    const failed = await clickAction(ext, item.getByTestId('cleanup-merge-button'), '/api/pages/merge');
    expect(failed.request.keepUrl, '[E1] 真实合并请求保留主页面').toBe(ISSUE);
    expect(failed.request.urls.toSorted(), '[E1] 真实请求含两个原始变体').toEqual([ISSUE, COMMENTS].toSorted());
    expect(failed.status, '[E2] 真实返回 404').toBe(404);
    expect(failed.body.error, '[E2] 完整错误码和非空文案').toMatchObject({ code: 'NOT_FOUND', message: '页面不存在' });
    await expect(popup.getByTestId('cleanup-action-error'), '[E3] 操作错误可见').toBeVisible();
    await expect(popup.getByTestId('cleanup-action-error'), '[E3] 提示失效并刷新').toContainText('建议已失效，已刷新列表');
    await ext.snap(popup, '合并失效错误');
    return failed;
  });
  await test.step('S4：确认失败后自动刷新，空库和撤销记录未改变', async () => {
    await waitForCleanup(ext, traffic.requests.indexOf(failedAction.requestEvent) + 1);
    expect(traffic.requests.slice(traffic.requests.indexOf(failedAction.requestEvent) + 1).filter((item) => item.method() === 'GET' && new URL(item.url()).pathname === '/api/pages/cleanup-suggestions').map((item) => item.method()), '[E4] 插件在合并失败后重新 GET 建议').toContain('GET');
    await expect(popup.getByTestId('cleanup-empty'), '[E4] 自动刷新后空状态可见').toBeVisible();
    await expect(popup.getByTestId('panel-cleanup').getByTestId('cleanup-item'), '[E4] 没有残留建议项').toHaveCount(0);
    const health = await api.get('/api/health');
    const ranked = await api.get('/api/pages/ranked?limit=500');
    const cleanup = await api.get('/api/pages/cleanup-suggestions');
    expect([health.status, ranked.status, cleanup.status], '[E5] 三个真实回读成功').toEqual([200, 200, 200]);
    expect(health.body.pageCount, '[E5] 未新建主页面或 query 页面').toBe(0);
    expect(ranked.body.pages, '[E5] 排序仍为空').toEqual([]);
    expect(cleanup.body.suggestions, '[E5] 建议仍为空').toEqual([]);
    const storage = await ext.getStorage('lastCleanupAction');
    expect(storage, '[E6] 失败后不生成成功记录').not.toHaveProperty('lastCleanupAction');
    await expect(popup.getByTestId('cleanup-undo-button'), '[E6] 失败后没有撤销入口').toBeHidden();
    evidence.note(JSON.stringify({ phase: '失效合并后', storage }));
    await ext.snap(popup, '合并失效后空库');
  });
});
