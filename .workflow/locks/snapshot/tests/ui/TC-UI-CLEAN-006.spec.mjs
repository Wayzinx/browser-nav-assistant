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
const SEVEN_DAYS = 7 * 86_400_000;
const TARGET_AGE = SEVEN_DAYS - 60_000;

test("TC-UI-CLEAN-006 忽略7天−1分钟边界：Google建议仍被过滤", async ({ ext, api, evidence }) => {
  const traffic = observations.get(ext.context);
  await test.step('S1：重置并导入本例样例', async () => {
    await api.reset();
    const { res } = await api.loadSample();
    expect(res.status, '样例导入成功').toBe(200);
    expect(res.body.pageCount, '初始十页').toBe(10);
  });
  const { popup, googleKey } = await test.step('S2：取得后端原始 key 并打开整理页', async () => {
    const cleanup = await api.get('/api/pages/cleanup-suggestions');
    expect(cleanup.status, '建议回读成功').toBe(200);
    const suggestion = cleanup.body.suggestions.find((item) => item.action === 'archive' && item.url === GOOGLE);
    expect(suggestion.key, '后端建议 key 非空').toMatch(/\S/);
    const marker = traffic.requests.length;
    const page = await ext.openPopup();
    await waitForCleanup(ext, marker);
    const cleanupMarker = observations.get(ext.context).requests.length;
    await page.getByTestId('tab-cleanup').click();
    await waitForCleanup(ext, cleanupMarker);
    await ext.snap(page, '忽略前');
    return { popup: page, googleKey: suggestion.key };
  });
  await test.step('S3：先真实点击忽略并确认存储与视图', async () => {
    const item = popup.getByTestId('cleanup-group-archive').getByTestId('cleanup-item').filter({ hasText: GOOGLE });
    await expect(item, '目标建议唯一').toHaveCount(1);
    await item.getByTestId('cleanup-ignore-button').click();
    await expect(item, '[E1] 真实忽略后 Google 建议消失').toHaveCount(0);
    const storage = await ext.getStorage('ignoredSuggestions');
    expect(Number.isSafeInteger(storage.ignoredSuggestions[googleKey]), '[E1] 真实忽略已写入后端原始 key 的时间').toBe(true);
    evidence.note(JSON.stringify({ phase: '真实忽略后', googleKey, storage }));
    await ext.snap(popup, '真实忽略后');
  });
  const shifted = await test.step('S4：关闭 popup，仅改写 SW 中目标忽略时间', async () => {
    await popup.close();
    const value = await ext.swEval(async ({ key, age }) => {
      const { ignoredSuggestions } = await chrome.storage.local.get('ignoredSuggestions');
      const constructedAt = Date.now();
      const ignoredAt = constructedAt - age;
      await chrome.storage.local.set({ ignoredSuggestions: { ...ignoredSuggestions, [key]: ignoredAt } });
      return { constructedAt, ignoredAt };
    }, { key: googleKey, age: TARGET_AGE });
    evidence.note(JSON.stringify({ googleKey, targetAge: TARGET_AGE, ...value }));
    return value;
  });
  await test.step('S5：立即重开并完成真实刷新，核对七天边界和后端不变', async () => {
    const marker = traffic.requests.length;
    const reopened = await ext.reopenPopup();
    await waitForCleanup(ext, marker);
    const cleanupMarker = observations.get(ext.context).requests.length;
    await reopened.getByTestId('tab-cleanup').click();
    await waitForCleanup(ext, cleanupMarker);
    const swNow = await ext.swEval(() => Date.now());
    const age = swNow - shifted.ignoredAt;
    expect(age, '[E2] SW 时间差非负').toBeGreaterThanOrEqual(0);
    expect(age, '[E2] 位于七天边界的指定一侧').toBeLessThan(SEVEN_DAYS);
    expect(Math.abs(age - TARGET_AGE), '[E2] 与目标七天加减一分钟的偏差小于三十秒').toBeLessThan(30_000);
    expect(swNow - shifted.constructedAt, '[E2] 构造时间到核对的预算小于三十秒').toBeLessThan(30_000);
    await expect(reopened.getByTestId('cleanup-group-archive').getByTestId('cleanup-item').filter({ hasText: GOOGLE }), '[E3] 重开后的 Google 建议数量符合忽略期限').toHaveCount(0);
    await expect(reopened.getByTestId('tab-cleanup-count'), '[E4] 待处理数符合忽略期限').toHaveText('2');
    await ext.snap(reopened, '边界整理页');
    await reopened.getByTestId('tab-home').click();
    await expect(reopened.getByTestId('home-cleanup-archive-count'), '[E4] 首页归档计数符合忽略期限').toHaveText('归档 1');
    await ext.snap(reopened, '边界首页');
    const cleanup = await api.get('/api/pages/cleanup-suggestions');
    const ranked = await api.get('/api/pages/ranked?limit=500');
    expect(cleanup.status, '[E5] 后端整理回读成功').toBe(200);
    expect(cleanup.body.suggestions, '[E5] 后端仍有原始 Google 建议').toContainEqual(expect.objectContaining({ action: 'archive', url: GOOGLE, key: googleKey }));
    expect(cleanup.body.summary.archive, '[E5] 后端归档数仍为二').toBe(2);
    expect(ranked.status, '[E5] 后端排序回读成功').toBe(200);
    expect(ranked.body.total, '[E5] 后端仍有十页').toBe(10);
    expect(ranked.body.pages.map((item) => item.url), '[E5] 改写忽略时间不改变后端页面').toContain(GOOGLE);
    evidence.note(JSON.stringify({ swNow, age, targetAge: TARGET_AGE, ignoredAt: shifted.ignoredAt }));
  });
});
