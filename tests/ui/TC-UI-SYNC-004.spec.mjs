// TDD 草稿：按 docs/trace/cases/UI-SYNC.json 与 ui-contract 编写；本轮仅做静态/加载检查。
import { test, expect } from '../fixtures/extension.mjs';

const A = 'https://github.com/org/repo/pull/456';
const B = 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API';
const urlsOf = (items) => items.map((item) => item.url).sort();

async function resetBrowser(ext) {
  // 保留一个空白页，避免关闭最后一个 tab 导致整个测试 context 被关闭。
  const blank = await ext.context.newPage();
  for (const page of ext.context.pages()) {
    if (page !== blank) await page.close();
  }
  await ext.swEval(async () => {
    await chrome.history.deleteAll();
    await chrome.storage.local.remove(['syncState', 'cache', 'connection']);
  });
  return blank;
}

// 仅观察真实 BrowserContext 网络事件；不 route 后端，不访问 SW request.frame()。
// 异步响应读取的拒绝会在 drain 中重新抛出，不能把取证失败当作测试通过。
function observeSync(ext, evidence, baseURL = ext.baseURL) {
  const origin = new URL(baseURL).origin;
  const pending = new Set();
  const entries = new Map();
  const posts = [];
  const responses = [];
  const failures = [];
  const reads = [];
  const onRequest = (request) => {
    const url = new URL(request.url());
    if (url.origin === origin && url.pathname.startsWith('/api/')) {
      pending.add(request);
      if (request.method() === 'POST' && url.pathname === '/api/sync') {
        const entry = {
          reqId: evidence.caseId + '-SW-' + String(posts.length + 1).padStart(2, '0'),
          setup: false, method: request.method(), url: request.url(),
          requestHeaders: request.headers(), requestBody: request.postDataJSON(),
          status: null, responseHeaders: null, responseBody: null,
          startedAt: performance.now(),
        };
        entries.set(request, entry);
        posts.push(entry);
      }
    }
  };
  const onResponse = (response) => {
    const entry = entries.get(response.request());
    if (entry) {
      const read = (async () => {
        const text = await response.text();
        const headers = response.headers();
        Object.assign(entry, {
          status: response.status(), responseHeaders: headers,
          responseBody: /json/i.test(headers['content-type'] || '') ? JSON.parse(text) : text,
          ms: Number((performance.now() - entry.startedAt).toFixed(1)),
        });
        responses.push(entry);
        evidence.recordApi({ ...entry });
      })();
      reads.push(Promise.allSettled([read]));
    }
  };
  const onFinished = (request) => pending.delete(request);
  const onFailed = (request) => {
    pending.delete(request);
    const entry = entries.get(request);
    if (entry) {
      Object.assign(entry, {
        failure: request.failure()?.errorText,
        ms: Number((performance.now() - entry.startedAt).toFixed(1)),
      });
      failures.push(entry);
      // 连接失败没有 HTTP 响应，status/responseBody 保持 null。
      evidence.recordApi({ ...entry });
    }
  };
  ext.context.on('request', onRequest);
  ext.context.on('response', onResponse);
  ext.context.on('requestfinished', onFinished);
  ext.context.on('requestfailed', onFailed);
  const drain = async () => {
    await expect.poll(() => pending.size, {
      message: '[network] 本区间的真实后端请求均已结束', timeout: 12_000,
    }).toBe(0);
    const settled = (await Promise.all(reads)).flat();
    for (const result of settled) {
      if (result.status === 'rejected') throw result.reason;
    }
  };
  return {
    posts, responses, failures, drain,
    async stop() {
      try {
        await drain();
      } finally {
        ext.context.off('request', onRequest);
        ext.context.off('response', onResponse);
        ext.context.off('requestfinished', onFinished);
        ext.context.off('requestfailed', onFailed);
      }
    },
  };
}

async function openIdlePopup(ext, network, contextUrl = B) {
  const popup = await ext.openPopup();
  await expect(popup.getByTestId('sync-status'), '[setup] 首次打开为未同步').toHaveAttribute('data-status', 'idle');
  await expect(popup.getByTestId('sync-button'), '[setup] 同步按钮就绪').toBeEnabled();
  await expect.poll(async () => {
    const { cache, connection } = await ext.getStorage(['cache', 'connection']);
    return {
      ranked: cache?.ranked?.data != null,
      recommendations: cache?.recommendations?.[contextUrl]?.data != null,
      config: cache?.config?.data != null,
      connection: connection?.status,
      recoverPending: connection?.recoverPending === true,
    };
  }, { message: '[setup] 首屏真实请求和缓存加载结束，无自动恢复标记' }).toEqual({
    ranked: true, recommendations: true, config: true, connection: 'online', recoverPending: false,
  });
  await network.drain();
  expect(network.posts, '[setup] 点击前没有自发同步请求').toHaveLength(0);
  await ext.snap(popup, '首次打开-同步前');
  return popup;
}

test('TC-UI-SYNC-004 真实连接失败：展示原因和诊断入口并保留排序、推荐、整理数据', async ({ ext, api, evidence }) => {
  const healthyNetwork = observeSync(ext, evidence);
  let failedNetwork;
  let popup;
  let baseline;
  try {
    await test.step('S1：真实导入10页样例，加载各页签并记录非空 UI 和缓存基线', async () => {
      const blank = await resetBrowser(ext);
      await api.loadSample();
      await ext.mockSites({ [A]: 'Refactor auth middleware (#456)' });
      const [tab] = await ext.openTabs([A]);
      await blank.close();
      await tab.bringToFront();
      await ext.seedHistory([A]);
      await expect.poll(async () => ext.swEval(async () =>
        (await chrome.history.search({ text: '', startTime: 0, maxResults: 500 }))
          .filter((item) => /^https?:/.test(item.url)).map((item) => item.url).sort()),
      { message: '[setup] 浏览器仅含当前 A 的真实历史，旧页只在后端' }).toEqual([A]);
      popup = await openIdlePopup(ext, healthyNetwork, A);
      await popup.getByTestId('tab-ranked').click();
      await expect(popup.getByTestId('ranked-item').first(), '[setup] 完整排序有真实数据').toBeVisible();
      await healthyNetwork.drain();
      await popup.getByTestId('tab-cleanup').click();
      await expect(popup.getByTestId('cleanup-item').first(), '[setup] 整理建议非空').toBeVisible();
      await expect.poll(async () => (await ext.getStorage('cache')).cache?.cleanup?.data != null,
        { message: '[setup] 整理数据已写入真实缓存' }).toBe(true);
      await healthyNetwork.drain();
      const cleanupTexts = await popup.getByTestId('cleanup-item').allTextContents();
      await ext.snap(popup, '失败前-整理基线');
      await popup.getByTestId('tab-home').click();
      await expect(popup.getByTestId('home-ranked-item').first(), '[setup] 首页排序非空').toBeVisible();
      await expect(popup.getByTestId('rec-item').first(), '[setup] 首页推荐非空').toBeVisible();
      await healthyNetwork.drain();
      const { cache } = await ext.getStorage('cache');
      baseline = {
        rankedTexts: await popup.getByTestId('home-ranked-item').allTextContents(),
        recommendationTexts: await popup.getByTestId('rec-item').allTextContents(),
        cleanupTexts,
        cache: {
          ranked: cache.ranked.data,
          recommendations: Object.fromEntries(Object.entries(cache.recommendations)
            .map(([key, entry]) => [key, entry.data])),
          cleanup: cache.cleanup.data,
        },
      };
      expect(baseline.rankedTexts.length, '[E4] 对照排序基线非空').toBeGreaterThan(0);
      expect(baseline.recommendationTexts.length, '[E4] 对照推荐基线非空').toBeGreaterThan(0);
      expect(baseline.cleanupTexts.length, '[E4] 对照整理基线非空').toBeGreaterThan(0);
      expect(Object.keys(baseline.cache.recommendations), '[E5] 对照推荐缓存包含 A').toContain(A);
      evidence.note(JSON.stringify({ baseline }));
      await ext.snap(popup, '失败前-首页排序与推荐基线');
      expect(healthyNetwork.posts, '[setup] 后端样例导入不计作 UI 同步，popup 没有自动上报').toHaveLength(0);
      await healthyNetwork.stop();
    });

    await test.step('S2：保持 popup 打开，切到真实无服务端口后同步一次', async () => {
      failedNetwork = observeSync(ext, evidence, 'http://127.0.0.1:9');
      await ext.useUnreachableBackend();
      await popup.getByTestId('sync-button').click();
      await expect(popup.getByTestId('sync-status'), '[E1] 真实连接失败进入 error').toHaveAttribute('data-status', 'error');
      await expect(popup.getByTestId('sync-status'), '[E1] 状态显示同步失败').toContainText('同步失败');
      await expect(popup.getByTestId('sync-error-message'), '[E1] 真实失败原因可见').toBeVisible();
      await expect(popup.getByTestId('sync-error-message'), '[E1] 真实失败原因非空').toHaveText(/\S/);
      await failedNetwork.drain();
      await ext.snap(popup, '真实连接失败');
    });

    await test.step('S3：读回错误原因、诊断入口和三组未丢失的业务数据', async () => {
      const { syncState } = await ext.getStorage('syncState');
      expect(syncState.status, '[E2] 错误状态已持久化').toBe('error');
      expect(syncState.lastError.code, '[E2] 网络错误码来自真实连接失败').toBe('BACKEND_UNREACHABLE');
      expect(syncState.lastError.message, '[E2] 持久化错误原因非空').toMatch(/\S/);
      await expect(popup.getByTestId('sync-error-message'), '[E1] UI 展示持久化的真实连接失败原因').toContainText(syncState.lastError.message);
      expect(failedNetwork.posts, '[E2] 有一次真实同步连接尝试').toHaveLength(1);
      expect(failedNetwork.failures, '[E2] 取得一次真实 requestfailed 证据').toHaveLength(1);
      expect(failedNetwork.failures[0].failure, '[E2] 网络层失败原因非空').toMatch(/\S/);
      expect(failedNetwork.responses, '[E2] 连接失败没有虚构 HTTP 响应').toHaveLength(0);
      expect(failedNetwork.failures[0].status, '[E2] 无 HTTP 响应时 status 为 null').toBeNull();
      expect(failedNetwork.failures[0].responseBody, '[E2] 无 HTTP 响应时 body 为 null').toBeNull();
      await expect(popup.getByTestId('sync-diag-link'), '[E3] 诊断入口可见').toBeVisible();
      await expect(popup.getByTestId('sync-diag-link'), '[E3] 诊断入口含诊断文案').toContainText('诊断');
      await expect(popup.getByTestId('sync-button'), '[E3] 失败后同步按钮恢复 enabled').toBeEnabled();
      await expect(popup.getByTestId('home-ranked-item'), '[E4] 首页排序文本序列保持 R0').toHaveText(baseline.rankedTexts);
      await expect(popup.getByTestId('rec-item'), '[E4] 首页推荐文本序列保持 N0').toHaveText(baseline.recommendationTexts);
      await ext.snap(popup, '失败后-首页排序与推荐保留');
      await popup.getByTestId('tab-ranked').click();
      await expect(popup.getByTestId('ranked-item').first(), '[E4] 离线完整排序仍有数据').toBeVisible();
      await failedNetwork.drain();
      await popup.getByTestId('tab-cleanup').click();
      await expect(popup.getByTestId('cleanup-item'), '[E4] 整理文本序列保持 C0').toHaveText(baseline.cleanupTexts);
      await failedNetwork.drain();
      await ext.snap(popup, '失败后-整理建议保留');
      const { cache } = await ext.getStorage('cache');
      expect(cache.ranked.data, '[E5] 排序缓存业务数据与 K0 深度相等').toEqual(baseline.cache.ranked);
      expect(cache.cleanup.data, '[E5] 整理缓存业务数据与 K0 深度相等').toEqual(baseline.cache.cleanup);
      for (const [key, data] of Object.entries(baseline.cache.recommendations)) {
        expect(cache.recommendations?.[key]?.data, '[E5] 每个既有推荐缓存项的业务数据均保留').toEqual(data);
      }
      const health = await api.get('/api/health');
      expect(health.status, '[E6] 夹具仍向原真实后端读回').toBe(200);
      expect(health.body.pageCount, '[E6] 失败点击没有写入或清空原后端10页').toBe(10);
      await popup.getByTestId('tab-home').click();
      await expect(popup.getByTestId('sync-status'), '[E1] 业务页签切换后同步仍为 error').toHaveAttribute('data-status', 'error');
      await failedNetwork.drain();
      expect(failedNetwork.posts, '[E2] 失败不重试出第二次同步 POST').toHaveLength(1);
      expect(failedNetwork.responses, '[E2] 整个失败区间均未伪造 HTTP 响应').toHaveLength(0);
      evidence.note(JSON.stringify({ syncState, cache, failedRequests: failedNetwork.failures }));
      await ext.snap(popup, '失败与缓存读回一致');
    });
  } finally {
    await healthyNetwork.stop();
    if (failedNetwork) await failedNetwork.stop();
  }
});
