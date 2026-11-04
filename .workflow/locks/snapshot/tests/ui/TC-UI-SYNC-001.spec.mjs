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

async function prepareTwoPages(ext) {
  const blank = await resetBrowser(ext);
  await ext.mockSites({ [A]: 'Refactor auth middleware (#456)', [B]: 'Fetch API - Web APIs | MDN' });
  const tabs = await ext.openTabs([A, B]);
  await blank.close();
  await tabs[1].bringToFront();
  await ext.seedHistory([A, B]);
  await expect.poll(async () => ext.swEval(async () =>
    (await chrome.history.search({ text: '', startTime: 0, maxResults: 500 }))
      .filter((item) => /^https?:/.test(item.url)).map((item) => item.url).sort()),
  { message: '[setup] 浏览器真实历史仅含 A/B' }).toEqual([A, B].sort());
  return tabs;
}

async function openIdlePopup(ext, network, contextUrl = B) {
  const popup = await ext.openPopup();
  await expect(popup.getByTestId('sync-status'), '[setup] 首次打开为未同步').toHaveAttribute('data-status', 'idle');
  await expect(popup.getByTestId('sync-button'), '[setup] 同步按钮就绪').toBeEnabled();
  // 等待策略（探索固化）：首屏请求是否结束由 network.drain() 判定；不要求 RANK/REC 缓存成功写入（不属于本用例前置）
  void contextUrl;
  await expect.poll(async () => {
    const { cache, connection } = await ext.getStorage(['cache', 'connection']);
    return {
      config: cache?.config?.data != null,
      connection: connection?.status,
      recoverPending: connection?.recoverPending === true,
    };
  }, { message: '[setup] 首屏真实请求和缓存加载结束，无自动恢复标记' }).toEqual({
    config: true, connection: 'online', recoverPending: false,
  });
  await network.drain();
  expect(network.posts, '[setup] 点击前没有自发同步请求').toHaveLength(0);
  await ext.snap(popup, '首次打开-同步前');
  return popup;
}

async function waitForBatch(ext, network, clickedAt, contextUrl = B) {
  // 等待策略（探索固化）：成功后插件并行发起全部缓存刷新；以 cleanup 刷新落盘作为刷新已发出的信号，
  // 再用 network.drain() 等本批所有真实刷新请求结束。各缓存内容是否正确由对应 [En] 断言判定，不在等待中要求。
  void contextUrl;
  await expect.poll(async () => {
    const { syncState, cache } = await ext.getStorage(['syncState', 'cache']);
    return {
      status: syncState?.status,
      refreshStarted: cache?.cleanup?.cachedAt >= clickedAt,
    };
  }, { message: '[network] 本批同步成功且缓存刷新已发出', timeout: 12_000 })
    .toEqual({ status: 'success', refreshStarted: true });
  await network.drain();
  return ext.getStorage(['syncState', 'cache']);
}

test('TC-UI-SYNC-001 两条普通页面首次同步：真实上报三个上下文字段并展示上传5条、过滤0条', async ({ ext, api, evidence }) => {
  const network = observeSync(ext, evidence);
  let popup;
  let clickedAt;
  try {
    await test.step('S1：离线打开 A/B 并核对真实浏览器历史', async () => {
      await prepareTwoPages(ext);
    });

    await test.step('S2：首次打开 popup，点击一次并等待本批同步与缓存刷新', async () => {
      popup = await openIdlePopup(ext, network);
      await expect(popup.getByTestId('current-page-url'), '[E1] popup 排除自身，当前页面为 B').toHaveText(B);
      clickedAt = Date.now();
      await popup.getByTestId('sync-button').click();
      await expect(popup.getByTestId('sync-status'), '[E4] 最终同步成功').toHaveAttribute('data-status', 'success');
      await waitForBatch(ext, network, clickedAt);
      expect(network.posts, '[E1] 被测区间只有一次真实同步请求').toHaveLength(1);
      expect(network.responses, '[E2] 本批恰有一次真实 HTTP 响应').toHaveLength(1);
      expect(network.failures, '[E2] 本批没有网络失败').toHaveLength(0);
      const requestBody = network.posts[0].requestBody;
      expect(requestBody, '[E1] activeTab 字段存在且当前 URL 为 B').toHaveProperty('activeTab.url', B);
      expect(requestBody, '[E1] openTabs 字段存在').toHaveProperty('openTabs');
      expect(requestBody, '[E1] history 字段存在').toHaveProperty('history');
      expect(urlsOf(requestBody.openTabs), '[E1] 打开页面恰为 A/B').toEqual([A, B].sort());
      expect(urlsOf(requestBody.history), '[E1] 历史页面恰为 A/B').toEqual([A, B].sort());
      expect(requestBody.mode, '[E2] 首次同步采用 full').toBe('full');
      expect(requestBody, '[E2] 全量请求省略 cursor').not.toHaveProperty('cursor');
      expect(network.responses[0].status, '[E2] 真实 POST 返回 200').toBe(200);
      expect(network.responses[0].responseBody, '[E2] 去重前5条观察合并为2页').toMatchObject({
        received: 5, created: 2, updated: 3, rejected: 0, pageCount: 2,
      });
      await ext.snap(popup, '首次同步成功');
    });

    await test.step('S3：核对后端、数字状态、持久化时间和本批缓存', async () => {
      const ranked = await api.get('/api/pages/ranked');
      const health = await api.get('/api/health');
      expect(ranked.status, '[E3] 排序读回成功').toBe(200);
      expect(urlsOf(ranked.body.pages), '[E3] 后端页面集合恰为 A/B').toEqual([A, B].sort());
      expect(health.status, '[E3] 健康接口读回成功').toBe(200);
      expect(health.body.pageCount, '[E3] 后端页面总数为2').toBe(2);
      await expect(popup.getByTestId('sync-status'), '[E4] 状态文案包含同步成功').toContainText('同步成功');
      await expect(popup.getByTestId('sync-status'), '[E4] 状态属性为 success').toHaveAttribute('data-status', 'success');
      await expect(popup.getByTestId('sync-uploaded-count'), '[E4] 上传条数是纯数字5').toHaveText('5');
      await expect(popup.getByTestId('sync-filtered-count'), '[E4] 过滤条数是纯数字0').toHaveText('0');
      const { syncState, cache } = await ext.getStorage(['syncState', 'cache']);
      expect(syncState, '[E5] 成功状态、统计和空错误持久化').toMatchObject({
        status: 'success', stats: { uploaded: 5, filtered: 0 }, lastError: null,
      });
      expect(syncState.startedAt, '[E5] startedAt 属于本次点击').toBeGreaterThanOrEqual(clickedAt);
      expect(syncState.cursor, '[E5] 游标等于本次开始时间').toBe(syncState.startedAt);
      expect(syncState.lastSuccessAt, '[E5] 成功时间等于本次开始时间').toBe(syncState.startedAt);
      expect(syncState.lastSyncAt, '[E5] 上次同步时间为有效毫秒时间戳').toBeGreaterThanOrEqual(clickedAt);
      const hhmm = await popup.evaluate((at) => {
        const d = new Date(at);
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      }, syncState.lastSyncAt);
      await expect(popup.getByTestId('sync-status-time'), '[E5] 上次同步时间可见').toBeVisible();
      await expect(popup.getByTestId('sync-status-time'), '[E5] 时间与本例持久化时间对应').toContainText(hhmm);
      expect(urlsOf(cache.ranked.data.pages), '[E6] 排序缓存包含 A/B').toEqual(expect.arrayContaining([A, B]));
      expect(Object.keys(cache.recommendations), '[E6] 推荐缓存含当前 B 对应项').toContain(B);
      for (const entry of [cache.ranked, cache.cleanup, cache.rules, cache.config, cache.recommendations[B]]) {
        expect(entry.data, '[E6] 本批各缓存业务数据非 null').not.toEqual(null);
        expect(entry.data, '[E6] 本批各缓存业务数据已定义').not.toEqual(undefined);
        expect(entry.cachedAt, '[E6] 各项 cachedAt 不早于本次点击').toBeGreaterThanOrEqual(clickedAt);
        expect(entry.cachedAt, '[E6] 各项 cachedAt 不晚于当前读回时间').toBeLessThanOrEqual(Date.now());
      }
      await network.drain();
      expect(network.posts, '[E1] 读回结束仍只有本批一次上报').toHaveLength(1);
      evidence.note(JSON.stringify({ clickedAt, hhmm, syncState, cache }));
      await ext.snap(popup, '后端与持久化读回一致');
    });
  } finally {
    await network.stop();
  }
});
