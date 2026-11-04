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

test("TC-UI-CLEAN-002 空库：首页和整理页展示同步引导，待处理数隐藏", async ({ ext, api, evidence }) => {
  await test.step('S1：重置后回读空库', async () => {
    await api.reset();
    const cleanup = await api.get('/api/pages/cleanup-suggestions');
    const health = await api.get('/api/health');
    expect(cleanup.status, '[E1] 空库请求成功').toBe(200);
    expect(cleanup.body.suggestions, '[E1] 空库没有建议').toEqual([]);
    expect(cleanup.body.summary, '[E1] 空库三计数为零').toEqual({ archive: 0, merge: 0, keep: 0 });
    expect(health.status, '[E2] 健康检查成功').toBe(200);
    expect(health.body.pageCount, '[E2] 没有页面').toBe(0);
  });
  await test.step('S2：核对首页与整理页同步引导及无错误状态', async () => {
    const marker = observations.get(ext.context).requests.length;
    const popup = await ext.openPopup();
    await waitForCleanup(ext, marker);
    await expect(popup.getByTestId('home-cleanup-empty'), '[E3] 首页空状态可见').toBeVisible();
    await expect(popup.getByTestId('home-cleanup-empty'), '[E3] 首页提示同步').toContainText('同步浏览器上下文');
    await expect(popup.getByTestId('home-cleanup-error'), '[E6] 首页没有错误').toBeHidden();
    await ext.snap(popup, '首页空状态');
    await popup.getByTestId('tab-cleanup').click();
    await expect(popup.getByTestId('cleanup-empty'), '[E4] 整理页空状态可见').toBeVisible();
    await expect(popup.getByTestId('cleanup-empty'), '[E4] 整理页提示同步').toContainText('同步浏览器上下文');
    await expect(popup.getByTestId('panel-cleanup').getByTestId('cleanup-item'), '[E5] 没有建议项').toHaveCount(0);
    await expect(popup.getByTestId('tab-cleanup-count'), '[E6] 无待处理数').toBeHidden();
    await expect(popup.getByTestId('cleanup-error'), '[E6] 整理页没有错误').toBeHidden();
    await ext.snap(popup, '整理空状态');
  });
});
