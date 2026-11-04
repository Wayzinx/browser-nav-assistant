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

test("TC-UI-CLEAN-004 点击合并再撤销：保留无query页面，并恢复被并入页面", async ({ ext, api, evidence }) => {
  await test.step('S1：重置并导入本例样例', async () => {
    await api.reset();
    const { res } = await api.loadSample();
    expect(res.status, '样例导入成功').toBe(200);
    expect(res.body.pageCount, '初始十页').toBe(10);
  });
  const { popup, merge } = await test.step('S2：打开重复组并读取后端 urls 和 keepUrl', async () => {
    const marker = observations.get(ext.context).requests.length;
    const page = await ext.openPopup();
    await waitForCleanup(ext, marker);
    const cleanupMarker = observations.get(ext.context).requests.length;
    await page.getByTestId('tab-cleanup').click();
    await waitForCleanup(ext, cleanupMarker);
    const cleanup = await api.get('/api/pages/cleanup-suggestions');
    expect(cleanup.status, '整理建议请求成功').toBe(200);
    const item = cleanup.body.suggestions.find((entry) => entry.action === 'merge' && entry.urls.includes(COMMENTS));
    expect(item.urls.toSorted(), '本例重复组精确包含两个变体').toEqual([ISSUE, COMMENTS].toSorted());
    expect(item.keepUrl, '保留无 query 页面').toBe(ISSUE);
    await ext.snap(page, '合并前');
    return { popup: page, merge: item };
  });
  await test.step('S3：实际点击合并并核对真实请求响应', async () => {
    const item = popup.getByTestId('cleanup-group-merge').getByTestId('cleanup-item').filter({ hasText: COMMENTS });
    await expect(item, '重复组父项唯一').toHaveCount(1);
    const merged = await clickAction(ext, item.getByTestId('cleanup-merge-button'), '/api/pages/merge');
    expect(merged.request.urls.toSorted(), '[E1] 合并精确提交两个变体').toEqual([ISSUE, COMMENTS].toSorted());
    expect(merged.request.urls.toSorted(), '[E1] 请求使用本次后端分组').toEqual(merge.urls.toSorted());
    expect(merged.request.keepUrl, '[E1] 保留后端指定页面').toBe(merge.keepUrl);
    expect(merged.status, '[E2] 合并响应成功').toBe(200);
    expect(merged.body, '[E2] 仅并入一个页面').toMatchObject({ ok: true, keepUrl: ISSUE, merged: 1 });
    await expect(popup.getByTestId('cleanup-undo-button'), '合并后可撤销').toBeVisible();
    await expect(item, '重复组已处理').toHaveCount(0);
    await ext.snap(popup, '合并后');
  });
  await test.step('S4：真实回读排序、整理和推荐', async () => {
    const ranked = await api.get('/api/pages/ranked?limit=500');
    const cleanup = await api.get('/api/pages/cleanup-suggestions');
    const recs = await api.post('/api/recommendations/next', { currentPage: null, openTabs: [], recentHistory: [] });
    expect(ranked.status, '[E3] 排序请求成功').toBe(200);
    expect(ranked.body.total, '[E3] 合并后九页').toBe(9);
    expect(ranked.body.pages.map((item) => item.url), '[E3] 保留主页面').toContain(ISSUE);
    expect(ranked.body.pages.map((item) => item.url), '[E3] 移除 query 页面').not.toContain(COMMENTS);
    expect(cleanup.status, '[E4] 整理回读成功').toBe(200);
    expect(cleanup.body.suggestions.filter((item) => item.action === 'merge' && item.urls.includes(ISSUE) && item.urls.includes(COMMENTS)), '[E4] 原重复组不再出现').toEqual([]);
    expect(recs.status, '[E5] 推荐回读成功').toBe(200);
    expect(recs.body.recommendations.map((item) => item.url), '[E5] 推荐不含并入页面').not.toContain(COMMENTS);
  });
  await test.step('S5：核对撤销记录并实际撤销合并', async () => {
    const storage = await ext.getStorage('lastCleanupAction');
    evidence.note(JSON.stringify({ lastCleanupAction: storage.lastCleanupAction }));
    expect(storage.lastCleanupAction.kind, '[E6] 撤销记录类型为 merge').toBe('merge');
    expect(storage.lastCleanupAction.urls, '[E6] 撤销记录仅含并入页面').toEqual([COMMENTS]);
    expect(storage.lastCleanupAction.urls, '[E6] 不撤销保留页面').not.toContain(ISSUE);
    await ext.snap(popup, '撤销合并前');
    const restored = await clickAction(ext, popup.getByTestId('cleanup-undo-button'), '/api/pages/unarchive');
    expect(restored.request.urls, '[E7] 撤销仅提交 query 页面').toEqual([COMMENTS]);
    expect(restored.status, '[E7] 撤销响应成功').toBe(200);
    expect(restored.body.affected, '[E7] 恢复一个页面').toBe(1);
    const ranked = await api.get('/api/pages/ranked?limit=500');
    expect(ranked.status, '[E8] 撤销后排序回读成功').toBe(200);
    expect(ranked.body.total, '[E8] 恢复十页').toBe(10);
    expect(ranked.body.pages.map((item) => item.url), '[E8] 两个变体均恢复').toEqual(expect.arrayContaining([ISSUE, COMMENTS]));
    await ext.snap(popup, '撤销合并后');
  });
});
