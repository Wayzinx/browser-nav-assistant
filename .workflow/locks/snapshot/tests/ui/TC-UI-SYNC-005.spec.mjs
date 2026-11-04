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

test('TC-UI-SYNC-005 成功后关闭重开popup：恢复相同同步结果和上次时间且不重复上报', async ({ ext, evidence }) => {
  const network = observeSync(ext, evidence);
  let popup;
  let savedState;
  let firstHHmm;
  try {
    await test.step('S1：独立构造 A/B 标签和真实浏览历史', async () => {
      await prepareTwoPages(ext);
    });

    await test.step('S2：自行同步一次，保存成功状态 Q 和对应 HH:mm', async () => {
      popup = await openIdlePopup(ext, network);
      const clickedAt = Date.now();
      await popup.getByTestId('sync-button').click();
      await expect(popup.getByTestId('sync-status'), '[E1] 首次真实同步成功').toHaveAttribute('data-status', 'success');
      const { syncState } = await waitForBatch(ext, network, clickedAt);
      savedState = syncState;
      expect(savedState, '[E3] 本例成功状态包含上传5条、过滤0条').toMatchObject({
        status: 'success', stats: { uploaded: 5, filtered: 0 },
      });
      expect(savedState.lastSyncAt, '[E2] Q 含本例真实同步时间').toBeGreaterThanOrEqual(clickedAt);
      const expectedHHmm = await popup.evaluate((at) => {
        const d = new Date(at);
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      }, savedState.lastSyncAt);
      await expect(popup.getByTestId('sync-status-time'), '[E2] 首次显示的同步时间可见').toBeVisible();
      await expect(popup.getByTestId('sync-status-time'), '[E2] 首次时间对应 Q 的上次同步时间').toContainText(expectedHHmm);
      const firstText = await popup.getByTestId('sync-status-time').innerText();
      expect(firstText, '[E2] 首次同步时间具有 HH:mm 格式').toMatch(/\b\d{2}:\d{2}\b/);
      firstHHmm = firstText.match(/\b\d{2}:\d{2}\b/)[0];
      expect(firstHHmm, '[E2] 记录的 HH:mm 对应 Q').toBe(expectedHHmm);
      expect(network.posts, '[E4] 重开前真实上报数为1').toHaveLength(1);
      expect(network.responses, '[E4] 本次上报确有真实响应').toHaveLength(1);
      expect(network.responses[0].status, '[E4] 首次上报返回 HTTP 200').toBe(200);
      evidence.note(JSON.stringify({ savedState, firstHHmm, clickedAt }));
      await ext.snap(popup, '关闭前-成功状态和时间');
    });

    await test.step('S3：关闭旧 popup，创建新 popup 并直接读回持久化状态', async () => {
      await popup.close();
      popup = await ext.openPopup();
      await expect(popup.getByTestId('sync-status'), '[E1] 新 popup 恢复 success 状态').toHaveAttribute('data-status', 'success');
      await expect(popup.getByTestId('sync-status'), '[E1] 新 popup 文案包含同步成功').toContainText('同步成功');
      await expect(popup.getByTestId('current-page-url'), '[E1] 新 popup 当前页仍为 B').toHaveText(B);
      await expect(popup.getByTestId('sync-status-time'), '[E2] 新 popup 时间可见').toBeVisible();
      await expect(popup.getByTestId('sync-status-time'), '[E2] 重开后 HH:mm 与首次记录相同').toContainText(firstHHmm);
      await expect(popup.getByTestId('sync-uploaded-count'), '[E3] 重开后上传条数为5').toHaveText('5');
      await expect(popup.getByTestId('sync-filtered-count'), '[E3] 重开后过滤条数为0').toHaveText('0');
      const { syncState } = await ext.getStorage('syncState');
      const preserved = (state) => ({
        lastSyncAt: state.lastSyncAt, lastSuccessAt: state.lastSuccessAt,
        startedAt: state.startedAt, cursor: state.cursor, stats: state.stats,
      });
      expect(preserved(syncState), '[E3] 所有持久化时间、游标与统计均等于 Q').toEqual(preserved(savedState));
      await ext.snap(popup, '重开后-成功统计和时间恢复');
      await network.drain();
      expect(network.posts, '[E4] 从首次点击到新 popup 读回结束始终只有一次 POST').toHaveLength(1);
      expect(network.responses, '[E4] 没有额外同步响应').toHaveLength(1);
      expect(network.failures, '[E4] 没有被忽略的重复失败请求').toHaveLength(0);
      evidence.note(JSON.stringify({ restoredState: syncState, firstHHmm, posts: network.posts.length }));
    });
  } finally {
    await network.stop();
  }
});

