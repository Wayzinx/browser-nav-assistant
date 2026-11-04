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

const OLD = 'https://github.com/org/repo/issues/100';

test("TC-UI-CLEAN-003 点击归档issues/100再撤销：真实接口移除并恢复同一URL", async ({ ext, api, evidence }) => {
  await test.step('S1：重置并导入本例样例', async () => {
    await api.reset();
    const { res } = await api.loadSample();
    expect(res.status, '样例导入成功').toBe(200);
    expect(res.body.pageCount, '初始页面数').toBe(10);
  });
  const popup = await test.step('S2：回读目标存在，打开整理页', async () => {
    const ranked = await api.get('/api/pages/ranked?limit=500');
    expect(ranked.status, '排序请求成功').toBe(200);
    expect(ranked.body.pages.map((item) => item.url), '归档前目标存在').toContain(OLD);
    expect(ranked.body.total, '归档前共十页').toBe(10);
    const marker = observations.get(ext.context).requests.length;
    const page = await ext.openPopup();
    await waitForCleanup(ext, marker);
    const cleanupMarker = observations.get(ext.context).requests.length;
    await page.getByTestId('tab-cleanup').click();
    await waitForCleanup(ext, cleanupMarker);
    await ext.snap(page, '归档前');
    return page;
  });
  await test.step('S3：实际点击目标归档并核对真实请求响应', async () => {
    const item = popup.getByTestId('cleanup-group-archive').getByTestId('cleanup-item').filter({ hasText: OLD });
    await expect(item, '目标归档父项唯一').toHaveCount(1);
    const archived = await clickAction(ext, item.getByTestId('cleanup-archive-button'), '/api/pages/archive');
    expect(archived.request.urls, '[E1] 归档只提交目标 URL').toEqual([OLD]);
    expect(archived.status, '[E2] 真实归档响应 200').toBe(200);
    expect(archived.body, '[E2] 归档一页且没有丢失目标').toMatchObject({ ok: true, affected: 1, notFound: 0 });
    expect(Number.isSafeInteger(archived.body.archivedAt), '[E2] 归档时间为安全整数毫秒').toBe(true);
    expect(archived.body.archivedAt, '[E2] 归档时间为正数').toBeGreaterThan(0);
    await expect(item, '[E3] 目标从归档组消失').toHaveCount(0);
    await expect(popup.getByTestId('cleanup-undo-button'), '[E7] 显示撤销按钮').toBeVisible();
    await expect(popup.getByTestId('cleanup-undo-button'), '[E7] 撤销可点击').toBeEnabled();
    await ext.snap(popup, '归档成功');
  });
  await test.step('S4：真实回读排序、整理建议和推荐', async () => {
    const ranked = await api.get('/api/pages/ranked?limit=500');
    const cleanup = await api.get('/api/pages/cleanup-suggestions');
    const recs = await api.post('/api/recommendations/next', { currentPage: null, openTabs: [], recentHistory: [] });
    expect(ranked.status, '[E4] 排序回读成功').toBe(200);
    expect(ranked.body.total, '[E4] 归档后九页').toBe(9);
    expect(ranked.body.pages.map((item) => item.url), '[E4] 排序不含已归档目标').not.toContain(OLD);
    expect(cleanup.status, '[E5] 整理回读成功').toBe(200);
    expect(cleanup.body.suggestions.map((item) => item.url), '[E5] 整理不含已归档目标').not.toContain(OLD);
    expect(recs.status, '[E6] 推荐回读成功').toBe(200);
    expect(recs.body.recommendations.map((item) => item.url), '[E6] 推荐不含已归档目标').not.toContain(OLD);
  });
  await test.step('S5：实际点击撤销并核对同一 URL 恢复', async () => {
    await ext.snap(popup, '撤销前');
    const restored = await clickAction(ext, popup.getByTestId('cleanup-undo-button'), '/api/pages/unarchive');
    expect(restored.request.urls, '[E8] 撤销只提交本次归档 URL').toEqual([OLD]);
    expect(restored.status, '[E8] 撤销返回 200').toBe(200);
    expect(restored.body, '[E8] 撤销恢复一页').toMatchObject({ affected: 1, notFound: 0 });
    const ranked = await api.get('/api/pages/ranked?limit=500');
    const cleanup = await api.get('/api/pages/cleanup-suggestions');
    expect(ranked.status, '[E9] 恢复后排序回读成功').toBe(200);
    expect(ranked.body.total, '[E9] 恢复十页').toBe(10);
    expect(ranked.body.pages.map((item) => item.url), '[E9] 同一目标重新出现').toContain(OLD);
    expect(cleanup.status, '[E10] 恢复后整理回读成功').toBe(200);
    expect(cleanup.body.suggestions, '[E10] 同一目标重新建议归档').toContainEqual(expect.objectContaining({ action: 'archive', url: OLD }));
    await expect(popup.getByTestId('cleanup-group-archive').getByTestId('cleanup-item').filter({ hasText: OLD }), '[E10] 整理视图恢复目标').toHaveCount(1);
    await ext.snap(popup, '撤销后');
  });
});
