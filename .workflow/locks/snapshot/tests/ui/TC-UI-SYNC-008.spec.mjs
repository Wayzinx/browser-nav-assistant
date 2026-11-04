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

test('TC-UI-SYNC-008 无普通标签和历史：未同步空态经一次同步变为上传0条的成功态', async ({ ext, api, evidence }) => {
  const network = observeSync(ext, evidence);
  let popup;
  try {
    await test.step('S1：仅保留系统页与 popup，核对零历史和未同步空态', async () => {
      const blank = await resetBrowser(ext);
      const systemPage = await ext.context.newPage();
      await systemPage.goto('chrome://version/');
      await blank.close();
      await ext.swEval(() => chrome.history.deleteAll());
      await expect.poll(async () => ext.swEval(() =>
        chrome.history.search({ text: '', startTime: 0, maxResults: 500 })),
      { message: '[setup] 清空后真实浏览器历史为零' }).toEqual([]);
      const browserTabs = await ext.swEval(() => chrome.tabs.query({}));
      expect(browserTabs.filter((tab) => /^https?:/.test(tab.url || '')), '[setup] 不存在普通 http(s) 标签').toHaveLength(0);
      expect(browserTabs.map((tab) => tab.url), '[setup] 系统页仍然存在').toContain('chrome://version/');
      popup = await ext.openPopup();
      await expect(popup.getByTestId('sync-status'), '[E1] 首次空态为 idle').toHaveAttribute('data-status', 'idle');
      await expect(popup.getByTestId('sync-status'), '[E1] 初始文案包含尚未同步').toContainText('尚未同步');
      await expect(popup.getByTestId('sync-button'), '[setup] 空上下文仍允许同步').toBeEnabled();
      // 等待策略（探索固化）：首屏请求是否结束由 network.drain() 判定；不要求 RANK/REC 缓存成功写入
      await expect.poll(async () => {
        const { cache, connection } = await ext.getStorage(['cache', 'connection']);
        return {
          config: cache?.config?.data != null,
          status: connection?.status, recoverPending: connection?.recoverPending === true,
        };
      }, { message: '[setup] 无当前页的首屏真实请求均完成，无恢复标记' }).toEqual({
        config: true, status: 'online', recoverPending: false,
      });
      await network.drain();
      expect(network.posts, '[setup] 空态初次打开没有自动同步').toHaveLength(0);
      evidence.note(JSON.stringify({ browserTabs, history: await ext.swEval(() =>
        chrome.history.search({ text: '', startTime: 0, maxResults: 500 })) }));
      await ext.snap(popup, '同步前-尚未同步空态');
    });

    await test.step('S2：执行一次空上下文同步，读回零上传成功态与真实后端', async () => {
      const clickedAt = Date.now();
      await popup.getByTestId('sync-button').click();
      await expect(popup.getByTestId('sync-status'), '[E4] 空上下文同步最终成功').toHaveAttribute('data-status', 'success');
      await waitForBatch(ext, network, clickedAt, '__none__');
      expect(network.posts, '[E2] 空上下文也只上报一次').toHaveLength(1);
      const body = network.posts[0].requestBody;
      expect(body, '[E2] activeTab 字段存在且显式 null').toHaveProperty('activeTab', null);
      expect(body, '[E2] openTabs 字段存在且为空数组').toHaveProperty('openTabs', []);
      expect(body, '[E2] history 字段存在且为空数组').toHaveProperty('history', []);
      expect(body.mode, '[E2] 首次空同步是 full').toBe('full');
      expect(body, '[E2] full 请求不携带 cursor').not.toHaveProperty('cursor');
      expect(network.responses, '[E3] 真实空同步取得一次响应').toHaveLength(1);
      expect(network.responses[0].status, '[E3] 空同步返回 HTTP200').toBe(200);
      expect(network.responses[0].responseBody, '[E3] 接收、新建、更新、拒收及页面数全部为0').toMatchObject({
        received: 0, created: 0, updated: 0, rejected: 0, pageCount: 0,
      });
      const health = await api.get('/api/health');
      expect(health.status, '[E3] 健康读回成功').toBe(200);
      expect(health.body.pageCount, '[E3] 空同步不生成页面').toBe(0);
      await expect(popup.getByTestId('sync-status'), '[E4] 状态属性为 success').toHaveAttribute('data-status', 'success');
      await expect(popup.getByTestId('sync-status'), '[E4] 文案包含同步成功').toContainText('同步成功');
      await expect(popup.getByTestId('sync-uploaded-count'), '[E4] 上传条数为纯数字0').toHaveText('0');
      await expect(popup.getByTestId('sync-filtered-count'), '[E4] 过滤条数为纯数字0').toHaveText('0');
      await network.drain();
      expect(network.posts, '[E2] 完成后没有额外空同步批次').toHaveLength(1);
      expect(network.failures, '[E3] 空同步无网络失败').toHaveLength(0);
      evidence.note(JSON.stringify({ storage: await ext.getStorage(['syncState', 'cache']) }));
      await ext.snap(popup, '同步后-上传零条的成功态');
    });
  } finally {
    await network.stop();
  }
});

