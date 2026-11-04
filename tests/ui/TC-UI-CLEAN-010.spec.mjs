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

const RULES = [
  { rawText: '把 7 天没访问过的 GitHub issue 建议归档', type: 'archive_candidate', domain: 'github.com', urlPattern: '/issues/', inactiveDays: 7, action: 'suggest_archive', enabled: true },
  { rawText: 'docs.internal.com 的页面永远不要归档', type: 'never_archive', domain: 'docs.internal.com', action: 'keep', enabled: true },
];

test("TC-UI-CLEAN-010 无缓存且后端不可达：首页和整理页显示错误与诊断入口", async ({ ext, api, evidence }) => {
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
  await test.step('S3：先验证正常基线，再清缓存并切到不可达地址', async () => {
    const marker = traffic.requests.length;
    const popup = await ext.openPopup();
    await waitForCleanup(ext, marker);
    await expect(popup.getByTestId('home-cleanup-archive-count'), '[E1] 正常基线归档二项').toHaveText('归档 2');
    await expect(popup.getByTestId('home-cleanup-merge-count'), '[E1] 正常基线重复一项').toHaveText('重复 1');
    await expect(popup.getByTestId('home-cleanup-keep-count'), '[E1] 正常基线保留一项').toHaveText('保留 1');
    await ext.snap(popup, '断网前基线');
    await popup.close();
    await ext.swEval(() => chrome.storage.local.remove('cache'));
    await ext.useUnreachableBackend();
    const storage = await ext.getStorage(['apiBaseUrl', 'cache']);
    expect(storage.apiBaseUrl, '真实故障地址').toBe('http://127.0.0.1:9');
    expect(storage, '故障前移除了缓存').not.toHaveProperty('cache');
    evidence.note(JSON.stringify({ phase: '无缓存故障注入后', storage }));
  });
  await test.step('S4：打开无缓存故障首页和整理页，核对错误和诊断入口', async () => {
    const failedRequest = ext.context.waitForEvent('requestfailed', { predicate: (item) => item.url() === 'http://127.0.0.1:9/api/pages/cleanup-suggestions' && item.method() === 'GET' });
    const popup = await ext.reopenPopup();
    const failed = await failedRequest;
    await expect(popup.getByTestId('home-cleanup-error'), '[E2] 首页错误可见').toBeVisible();
    await expect(popup.getByTestId('home-cleanup-error'), '[E2] 首页显示实际故障地址').toContainText('无法连接后端 http://127.0.0.1:9');
    await expect(popup.getByTestId('home-cleanup-error').getByTestId('error-diag-link'), '[E2] 首页诊断入口可见').toBeVisible();
    await expect(popup.getByTestId('home-cleanup-error').getByTestId('error-diag-link'), '[E2] 首页诊断入口文案').toHaveText('诊断');
    await expect(popup.getByTestId('home-cleanup-empty'), '[E4] 首页不把连接失败显示为空库').toBeHidden();
    await ext.snap(popup, '无缓存首页错误');
    await popup.getByTestId('tab-cleanup').click();
    await expect(popup.getByTestId('cleanup-error'), '[E3] 整理错误可见').toBeVisible();
    await expect(popup.getByTestId('cleanup-error'), '[E3] 整理显示实际故障地址').toContainText('无法连接后端 http://127.0.0.1:9');
    await expect(popup.getByTestId('cleanup-error').getByTestId('error-diag-link'), '[E3] 整理诊断入口可见').toBeVisible();
    await expect(popup.getByTestId('cleanup-error').getByTestId('error-diag-link'), '[E3] 整理诊断入口文案').toHaveText('诊断');
    await expect(popup.getByTestId('cleanup-empty'), '[E4] 整理页不把连接失败显示为空库').toBeHidden();
    await expect.poll(async () => (await ext.getStorage('connection')).connection).toMatchObject({ status: 'offline', lastErrorCode: 'BACKEND_UNREACHABLE' });
    const storage = await ext.getStorage('connection');
    expect(storage.connection, '[E5] storage 记录离线状态及错误码').toMatchObject({ status: 'offline', lastErrorCode: 'BACKEND_UNREACHABLE' });
    expect(await failed.response(), '[E5] 真实网络失败没有 HTTP 响应').toBeNull();
    expect(failed.failure()?.errorText, '[E5] 保留实际网络错误').toMatch(/\S/);
    evidence.note(JSON.stringify({ phase: '无缓存故障后', storage, networkError: failed.failure(), httpResponse: null }));
    await ext.snap(popup, '无缓存整理错误');
  });
  await test.step('S5：经原 TEST_PORT 回读数据，地址恢复及清理由 afterEach 保证', async () => {
    const cleanup = await api.get('/api/pages/cleanup-suggestions');
    const health = await api.get('/api/health');
    expect([cleanup.status, health.status], '[E6] 原地址真实后端仍可达').toEqual([200, 200]);
    expect(health.body.pageCount, '[E6] 后端页面数未变').toBe(10);
    expect(health.body.ruleCount, '[E6] 后端规则数未变').toBe(2);
    expect(cleanup.body.summary, '[E6] 后端建议不因插件断网而改变').toEqual({ archive: 2, merge: 1, keep: 1 });
  });
});
