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

const RULES = [
  { rawText: '把 7 天没访问过的 GitHub issue 建议归档', type: 'archive_candidate', domain: 'github.com', urlPattern: '/issues/', inactiveDays: 7, action: 'suggest_archive', enabled: true },
  { rawText: 'docs.internal.com 的页面永远不要归档', type: 'never_archive', domain: 'docs.internal.com', action: 'keep', enabled: true },
];

const OLD = 'https://github.com/org/repo/issues/100';
const GOOGLE = 'https://www.google.com/search?q=chrome+extension+manifest+v3';
const ISSUE = 'https://github.com/org/repo/issues/123';
const COMMENTS = `${ISSUE}?tab=comments`;
const PROTECTED = 'https://docs.internal.com/ai-agent-design';

test("TC-UI-CLEAN-012 点击全部归档：只提交归档组两个URL，重复和保留页面仍存在", async ({ ext, api, evidence }) => {
  await test.step('S1：重置并导入本例样例', async () => {
    await api.reset();
    const { res } = await api.loadSample();
    expect(res.status, '样例导入成功').toBe(200);
    expect(res.body.pageCount, '初始十页').toBe(10);
  });
  await test.step('S2：真实保存两条规则', async () => {
    const saved = await api.post('/api/rules', { rules: RULES }, { setup: true });
    expect(saved.status, '规则保存返回 201').toBe(201);
    expect(saved.body.rules, '两条规则保存成功').toHaveLength(2);
    evidence.note(JSON.stringify({ savedRules: saved.body.rules }));
  });
  const popup = await test.step('S3：确认归档组并实际点击全部归档', async () => {
    const marker = observations.get(ext.context).requests.length;
    const page = await ext.openPopup();
    await waitForCleanup(ext, marker);
    const cleanupMarker = observations.get(ext.context).requests.length;
    await page.getByTestId('tab-cleanup').click();
    await waitForCleanup(ext, cleanupMarker);
    const items = page.getByTestId('cleanup-group-archive').getByTestId('cleanup-item');
    await expect(items, '全部归档前恰有两项').toHaveCount(2);
    await expect(items.filter({ hasText: OLD }), '全部归档前包含旧 issue').toHaveCount(1);
    await expect(items.filter({ hasText: GOOGLE }), '全部归档前包含 Google').toHaveCount(1);
    await ext.snap(page, '全部归档前');
    const archived = await clickAction(ext, page.getByTestId('cleanup-archive-all-button'), '/api/pages/archive');
    expect(archived.request.urls.toSorted(), '[E1] 批量请求集合精确等于两条归档 URL，未包含重复或保留页面').toEqual([OLD, GOOGLE].toSorted());
    expect(archived.status, '[E2] 真实批量归档返回 200').toBe(200);
    expect(archived.body, '[E2] 归档两页且没有丢失目标').toMatchObject({ affected: 2, notFound: 0 });
    await expect(items, '[E6] 归档组已清空').toHaveCount(0);
    await ext.snap(page, '全部归档后');
    return page;
  });
  await test.step('S4：真实回读只移除归档集合，重复和保留不受影响', async () => {
    const ranked = await api.get('/api/pages/ranked?limit=500');
    const cleanup = await api.get('/api/pages/cleanup-suggestions');
    const recs = await api.post('/api/recommendations/next', { currentPage: null, openTabs: [], recentHistory: [] });
    expect(ranked.status, '[E3] 排序回读成功').toBe(200);
    expect(ranked.body.total, '[E3] 批量归档后剩八页').toBe(8);
    expect(ranked.body.pages.map((entry) => entry.url).filter((url) => [OLD, GOOGLE].includes(url)), '[E3] 排序不含两条归档 URL').toEqual([]);
    expect(ranked.body.pages.map((entry) => entry.url), '[E4] 重复组两个变体和保护页面均保留').toEqual(expect.arrayContaining([ISSUE, COMMENTS, PROTECTED]));
    expect(cleanup.status, '[E5] 整理回读成功').toBe(200);
    expect(cleanup.body.summary, '[E5] 仅归档清零，重复和保留不变').toEqual({ archive: 0, merge: 1, keep: 1 });
    expect(cleanup.body.suggestions.filter((entry) => [OLD, GOOGLE].includes(entry.url)), '[E5] 整理建议不含两条归档 URL').toEqual([]);
    expect(recs.status, '[E6] 推荐回读成功').toBe(200);
    expect(recs.body.recommendations.filter((entry) => [OLD, GOOGLE].includes(entry.url)), '[E6] 推荐不含两条归档 URL').toEqual([]);
    await expect(popup.getByTestId('cleanup-group-archive').getByTestId('cleanup-item'), '[E6] 回读后归档组仍为空').toHaveCount(0);
    await ext.snap(popup, '批量归档回读完成');
  });
});
