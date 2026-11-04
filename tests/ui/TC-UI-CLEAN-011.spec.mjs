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

test("TC-UI-CLEAN-011 有缓存且归档请求不可达：保留离线建议，恢复连接后实际归档成功", async ({ ext, api, evidence }) => {
  const traffic = observations.get(ext.context);
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
  const baselineCache = await test.step('S3：从真实网络建立整理缓存并记录时间', async () => {
    const marker = traffic.requests.length;
    const popup = await ext.openPopup();
    await waitForCleanup(ext, marker);
    await expect(popup.getByTestId('home-cleanup-archive-count'), '[E1] 基线归档二项').toHaveText('归档 2');
    await expect(popup.getByTestId('home-cleanup-merge-count'), '[E1] 基线重复一项').toHaveText('重复 1');
    await expect(popup.getByTestId('home-cleanup-keep-count'), '[E1] 基线保留一项').toHaveText('保留 1');
    await popup.getByTestId('tab-cleanup').click();
    await expect(popup.getByTestId('cleanup-group-archive').getByTestId('cleanup-item'), '网络基线归档组已渲染').toHaveCount(2);
    await expect.poll(async () => (await ext.getStorage('cache')).cache?.cleanup?.data?.summary).toEqual({ archive: 2, merge: 1, keep: 1 });
    const storage = await ext.getStorage(['cache', 'lastCleanupAction']);
    expect(storage.cache.cleanup.data.summary, '[E1] 缓存来自真实网络并包含基线三计数').toEqual({ archive: 2, merge: 1, keep: 1 });
    expect(Number.isSafeInteger(storage.cache.cleanup.cachedAt), '记录整理缓存时间').toBe(true);
    expect(Number.isSafeInteger(storage.cache.cachedAt), '记录全局缓存时间').toBe(true);
    expect(storage, '[E5] 故障前没有成功操作记录').not.toHaveProperty('lastCleanupAction');
    await ext.snap(popup, '离线前真实缓存');
    await popup.close();
    const { cache } = await ext.getStorage('cache');
    evidence.note(JSON.stringify({ phase: '断网前缓存', cache }));
    return cache;
  });
  const popup = await test.step('S4：保留缓存并断网，重新打开整理页', async () => {
    await ext.useUnreachableBackend();
    const failedRequest = ext.context.waitForEvent('requestfailed', { predicate: (item) => item.url() === 'http://127.0.0.1:9/api/pages/cleanup-suggestions' && item.method() === 'GET' });
    const page = await ext.reopenPopup();
    await page.getByTestId('tab-cleanup').click();
    const failed = await failedRequest;
    expect(await failed.response(), '离线整理刷新没有 HTTP 响应').toBeNull();
    await expect(page.getByTestId('cleanup-group-archive').getByTestId('cleanup-item'), '[E2] 离线仍展示两个归档项').toHaveCount(2);
    await expect(page.getByTestId('cleanup-group-merge').getByTestId('cleanup-item'), '[E2] 离线仍展示一个重复项').toHaveCount(1);
    await expect(page.getByTestId('cleanup-group-keep').getByTestId('cleanup-item'), '[E2] 离线仍展示一个保留项').toHaveCount(1);
    const hhmm = await ext.swEval((timestamp) => {
      const date = new Date(timestamp);
      return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }, baselineCache.cachedAt);
    await expect(page.getByTestId('offline-banner-cleanup'), '[E2] 整理页离线提示可见').toBeVisible();
    await expect(page.getByTestId('offline-banner-cleanup'), '[E2] 显示实际缓存时间对应的浏览器本地 HH:mm').toHaveText(`以下为 ${hhmm} 同步时缓存的结果`);
    expect((await ext.getStorage('cache')).cache.cleanup, '失败的刷新保留原整理缓存').toEqual(baselineCache.cleanup);
    await ext.snap(page, '离线缓存整理页');
    return page;
  });
  await test.step('S5：真实点击离线归档，核对错误与后端无副作用', async () => {
    const item = popup.getByTestId('cleanup-group-archive').getByTestId('cleanup-item').filter({ hasText: OLD });
    await expect(item, '离线归档目标唯一').toHaveCount(1);
    await ext.snap(popup, '离线归档前');
    const failedRequest = ext.context.waitForEvent('requestfailed', { predicate: (entry) => entry.url() === 'http://127.0.0.1:9/api/pages/archive' && entry.method() === 'POST' });
    await item.getByTestId('cleanup-archive-button').click();
    const failed = await failedRequest;
    expect(failed.postDataJSON().urls, '[E3] 真实离线点击尝试提交目标').toEqual([OLD]);
    expect(await failed.response(), '[E3] 离线归档没有 HTTP 响应').toBeNull();
    await expect(popup.getByTestId('cleanup-action-error'), '[E3] 离线操作错误可见').toBeVisible();
    await expect(popup.getByTestId('cleanup-action-error'), '[E3] 离线操作显示实际故障地址').toContainText('无法连接后端 http://127.0.0.1:9');
    const ranked = await api.get('/api/pages/ranked?limit=500');
    const cleanup = await api.get('/api/pages/cleanup-suggestions');
    expect([ranked.status, cleanup.status], '[E4] 原 TEST_PORT 的真实回读成功').toEqual([200, 200]);
    expect(ranked.body.total, '[E4] 失败后仍有十页').toBe(10);
    expect(ranked.body.pages.map((entry) => entry.url), '[E4] 失败后排序仍含目标').toContain(OLD);
    expect(cleanup.body.suggestions, '[E4] 失败后仍有目标归档建议').toContainEqual(expect.objectContaining({ action: 'archive', url: OLD }));
    const storage = await ext.getStorage('lastCleanupAction');
    expect(storage, '[E5] 离线失败不创建成功操作记录').not.toHaveProperty('lastCleanupAction');
    await expect(popup.getByTestId('cleanup-undo-button'), '[E5] 离线失败不显示撤销').toBeHidden();
    evidence.note(JSON.stringify({ phase: '离线归档失败后', storage, networkError: failed.failure() }));
    await ext.snap(popup, '离线归档失败');
  });
  await test.step('S6：保持同一 popup，恢复地址后实际归档并真实回读', async () => {
    await ext.setApiBase(ext.baseURL);
    const item = popup.getByTestId('cleanup-group-archive').getByTestId('cleanup-item').filter({ hasText: OLD });
    await expect(item, '失败后缓存目标仍在').toHaveCount(1);
    await ext.snap(popup, '恢复后重试前');
    const archived = await clickAction(ext, item.getByTestId('cleanup-archive-button'), '/api/pages/archive');
    expect(archived.request.urls, '[E6] 恢复后 UI 提交同一目标').toEqual([OLD]);
    expect(archived.status, '[E6] 恢复后真实归档返回 200').toBe(200);
    expect(archived.body, '[E6] 恢复后归档一页且没有丢失目标').toMatchObject({ affected: 1, notFound: 0 });
    const ranked = await api.get('/api/pages/ranked?limit=500');
    const cleanup = await api.get('/api/pages/cleanup-suggestions');
    const recs = await api.post('/api/recommendations/next', { currentPage: null, openTabs: [], recentHistory: [] });
    expect([ranked.status, cleanup.status, recs.status], '[E7] 恢复后三份真实回读成功').toEqual([200, 200, 200]);
    expect(ranked.body.total, '[E7] 恢复后归档生效，共九页').toBe(9);
    expect(ranked.body.pages.map((entry) => entry.url), '[E7] 排序移除目标').not.toContain(OLD);
    expect(cleanup.body.suggestions.map((entry) => entry.url), '[E7] 整理建议移除目标').not.toContain(OLD);
    expect(recs.body.recommendations.map((entry) => entry.url), '[E7] 推荐移除目标').not.toContain(OLD);
    await expect(item, '[E8] 整理视图移除目标').toHaveCount(0);
    await expect(popup.getByTestId('cleanup-undo-button'), '[E8] 成功后显示撤销').toBeVisible();
    evidence.note(JSON.stringify({ phase: '恢复归档后', storage: await ext.getStorage('lastCleanupAction') }));
    await ext.snap(popup, '恢复后归档成功');
  });
});
