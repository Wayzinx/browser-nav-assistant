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

const GOOGLE = 'https://www.google.com/search?q=chrome+extension+manifest+v3';
const OLD = 'https://github.com/org/repo/issues/100';
const COMMENTS = 'https://github.com/org/repo/issues/123?tab=comments';

test("TC-UI-CLEAN-005 点击忽略后重开popup：保存后端key与忽略时间，仅过滤本地展示", async ({ ext, api, evidence }) => {
  const traffic = observations.get(ext.context);
  await test.step('S1：重置并导入本例样例', async () => {
    await api.reset();
    const { res } = await api.loadSample();
    expect(res.status, '样例导入成功').toBe(200);
    expect(res.body.pageCount, '初始十页').toBe(10);
  });
  const { popup, googleKey } = await test.step('S2：取得后端建议 key 并打开整理页', async () => {
    const cleanup = await api.get('/api/pages/cleanup-suggestions');
    expect(cleanup.status, '建议回读成功').toBe(200);
    const suggestion = cleanup.body.suggestions.find((item) => item.action === 'archive' && item.url === GOOGLE);
    expect(suggestion.key, '使用后端返回的非空 key').toMatch(/\S/);
    const marker = traffic.requests.length;
    const page = await ext.openPopup();
    await waitForCleanup(ext, marker);
    const cleanupMarker = observations.get(ext.context).requests.length;
    await page.getByTestId('tab-cleanup').click();
    await waitForCleanup(ext, cleanupMarker);
    await ext.snap(page, '忽略前');
    return { popup: page, googleKey: suggestion.key };
  });
  const ignoreStart = traffic.requests.length;
  await test.step('S3：实际点击忽略并核对 SW 时间和存储', async () => {
    const item = popup.getByTestId('cleanup-group-archive').getByTestId('cleanup-item').filter({ hasText: GOOGLE });
    await expect(item, 'Google 归档父项唯一').toHaveCount(1);
    const tBefore = await ext.swEval(() => Date.now());
    await item.getByTestId('cleanup-ignore-button').click();
    await expect(item, '[E2] 忽略后仅目标建议消失').toHaveCount(0);
    const storage = await ext.getStorage('ignoredSuggestions');
    const tAfter = await ext.swEval(() => Date.now());
    const ignoredAt = storage.ignoredSuggestions[googleKey];
    expect(Number.isSafeInteger(ignoredAt), '[E1] 后端原始 key 对应整数毫秒').toBe(true);
    expect(ignoredAt, '[E1] 时间不早于点击').toBeGreaterThanOrEqual(tBefore);
    expect(ignoredAt, '[E1] 时间不晚于读回').toBeLessThanOrEqual(tAfter);
    expect(Object.keys(storage.ignoredSuggestions), '[E1] 未自造或替换 key').toEqual([googleKey]);
    evidence.note(JSON.stringify({ googleKey, tBefore, tAfter, storage }));
    await ext.snap(popup, '忽略后');
  });
  await test.step('S4：重开并等待真实刷新，核对局部过滤与首页计数', async () => {
    const marker = traffic.requests.length;
    const reopened = await ext.reopenPopup();
    await waitForCleanup(ext, marker);
    const cleanupMarker = observations.get(ext.context).requests.length;
    await reopened.getByTestId('tab-cleanup').click();
    await waitForCleanup(ext, cleanupMarker);
    await expect(reopened.getByTestId('cleanup-group-archive').getByTestId('cleanup-item').filter({ hasText: GOOGLE }), '[E2] 重开后仍过滤 Google 建议').toHaveCount(0);
    await expect(reopened.getByTestId('cleanup-group-archive').getByTestId('cleanup-item').filter({ hasText: OLD }), '[E3] 其他归档建议仍存在').toHaveCount(1);
    await expect(reopened.getByTestId('cleanup-group-merge').getByTestId('cleanup-item').filter({ hasText: COMMENTS }), '[E3] 重复建议仍存在').toHaveCount(1);
    await expect(reopened.getByTestId('tab-cleanup-count'), '[E4] 待处理数降为二').toHaveText('2');
    await ext.snap(reopened, '重开整理页');
    await reopened.getByTestId('tab-home').click();
    await expect(reopened.getByTestId('home-cleanup-archive-count'), '[E4] 首页归档一项').toHaveText('归档 1');
    await expect(reopened.getByTestId('home-cleanup-merge-count'), '[E4] 首页重复一项').toHaveText('重复 1');
    await expect(reopened.getByTestId('home-cleanup-keep-count'), '[E4] 首页保留零项').toHaveText('保留 0');
    await ext.snap(reopened, '重开首页摘要');
  });
  await test.step('S5：真实后端未变更，忽略期间没有整理写请求', async () => {
    const ranked = await api.get('/api/pages/ranked?limit=500');
    const cleanup = await api.get('/api/pages/cleanup-suggestions');
    const recs = await api.post('/api/recommendations/next', { currentPage: null, openTabs: [], recentHistory: [] });
    expect(cleanup.status, '[E5] 建议回读成功').toBe(200);
    expect(cleanup.body.suggestions, '[E5] 后端仍保留 Google 建议').toContainEqual(expect.objectContaining({ action: 'archive', url: GOOGLE, key: googleKey }));
    expect(cleanup.body.summary, '[E5] 后端三计数未改变').toEqual({ archive: 2, merge: 1, keep: 0 });
    expect(ranked.status, '[E6] 排序回读成功').toBe(200);
    expect(ranked.body.total, '[E6] 后端仍有十页').toBe(10);
    expect(ranked.body.pages.map((item) => item.url), '[E6] 后端仍含 Google 页面').toContain(GOOGLE);
    expect(recs.status, '推荐回读成功并留痕').toBe(200);
    const mutations = traffic.requests.slice(ignoreStart).filter((item) => item.method() === 'POST' && ['/api/pages/archive', '/api/pages/unarchive', '/api/pages/merge'].includes(new URL(item.url()).pathname));
    expect(mutations.map((item) => item.url()), '[E7] 忽略仅在本地过滤，没有归档、撤销或合并请求').toEqual([]);
    evidence.note(JSON.stringify({ ignoredSuggestions: (await ext.getStorage('ignoredSuggestions')).ignoredSuggestions, mutationRequests: mutations.map((item) => item.url()) }));
  });
});
