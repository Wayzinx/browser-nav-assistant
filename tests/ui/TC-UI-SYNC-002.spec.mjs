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

test('TC-UI-SYNC-002 普通页面旁有chrome系统页：请求不含系统URL且系统跳过不增加过滤计数', async ({ ext, api, evidence }) => {
  const network = observeSync(ext, evidence);
  let tabs;
  let popup;
  try {
    await test.step('S1：构造仅含 A/B 的普通标签和真实历史', async () => {
      tabs = await prepareTwoPages(ext);
      await ext.snap(tabs[1], '普通页面B');
    });

    await test.step('S2：保留系统页并以 B 为当前普通页执行一次同步', async () => {
      const systemPage = await ext.context.newPage();
      await systemPage.goto('chrome://version/');
      // 系统页仍然存在；把 B 激活，以固定 activeTab=B 的前置条件。
      await tabs[1].bringToFront();
      popup = await openIdlePopup(ext, network);
      const clickedAt = Date.now();
      await popup.getByTestId('sync-button').click();
      await expect(popup.getByTestId('sync-status'), '[E3] 系统页存在时仍同步成功').toHaveAttribute('data-status', 'success');
      await waitForBatch(ext, network, clickedAt);
      await ext.snap(popup, '含系统页的同步成功');
    });

    await test.step('S3：核对浏览器快照、真实请求、后端页面和过滤计数', async () => {
      const browserTabs = await ext.swEval(() => chrome.tabs.query({}));
      expect(browserTabs.map((tab) => tab.url), '[E1] 浏览器中确有系统页').toContain('chrome://version/');
      expect(network.posts, '[E2] 本例只有一次 UI 同步上报').toHaveLength(1);
      expect(network.responses, '[E2] 真实上报收到一次响应').toHaveLength(1);
      expect(network.failures, '[E2] 没有连接失败').toHaveLength(0);
      const body = network.posts[0].requestBody;
      const uploaded = [body.activeTab, ...body.openTabs, ...body.history].filter(Boolean);
      expect(uploaded.filter((item) => item.url.startsWith('chrome://')), '[E1] 三个字段均无 chrome 系统 URL').toHaveLength(0);
      expect(uploaded.filter((item) => item.url.startsWith('chrome-extension://')), '[E1] 三个字段均无扩展自身 URL').toHaveLength(0);
      expect(body.activeTab.url, '[E2] 当前上报页面为 B').toBe(B);
      expect(urlsOf(body.openTabs), '[E2] 仅上传 A/B 两个普通标签').toEqual([A, B].sort());
      expect(network.responses[0].status, '[E2] 真实 POST 返回200').toBe(200);
      expect(network.responses[0].responseBody.pageCount, '[E2] 同步后总数为2').toBe(2);
      const ranked = await api.get('/api/pages/ranked');
      const health = await api.get('/api/health');
      expect(ranked.status, '[E2] 排序接口读回成功').toBe(200);
      expect(urlsOf(ranked.body.pages), '[E2] 后端只保存 A/B').toEqual([A, B].sort());
      expect(health.status, '[E2] 健康读回成功').toBe(200);
      expect(health.body.pageCount, '[E2] 后端页面总数为2').toBe(2);
      await expect(popup.getByTestId('sync-status'), '[E3] 状态为 success').toHaveAttribute('data-status', 'success');
      await expect(popup.getByTestId('sync-status'), '[E3] 文案包含同步成功').toContainText('同步成功');
      await expect(popup.getByTestId('sync-filtered-count'), '[E3] 系统页跳过不增加过滤计数').toHaveText('0');
      await network.drain();
      expect(network.posts, '[E2] 读回结束仍只有一次同步').toHaveLength(1);
      evidence.note(JSON.stringify({ browserTabs, uploadedUrls: urlsOf(uploaded), storage: await ext.getStorage(['syncState']) }));
      await ext.snap(popup, '系统页未上报且过滤为零');
    });
  } finally {
    await network.stop();
  }
});

