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

const S = 'https://example.com/private-token-marker'; // 合成 URL，不含真实凭证。

test('TC-UI-SYNC-009 历史中一条敏感记录被过滤：成功状态展示上传5条、过滤1条', async ({ ext, api, evidence }) => {
  const network = observeSync(ext, evidence);
  let popup;
  try {
    await test.step('S1：构造两个普通标签 A/B 和对应真实浏览历史', async () => {
      const tabs = await prepareTwoPages(ext);
      await ext.snap(tabs[1], '普通当前页B');
    });

    await test.step('S2：仅向真实历史添加一次敏感 S，确认标签和配置', async () => {
      await ext.seedHistory([S]);
      await expect.poll(async () => ext.swEval(async () =>
        (await chrome.history.search({ text: '', startTime: 0, maxResults: 500 }))
          .map((item) => item.url).sort()),
      { message: '[setup] 敏感 URL 只在历史出现一次' }).toEqual([A, B, S].sort());
      const tabs = await ext.swEval(() => chrome.tabs.query({}));
      expect(urlsOf(tabs.filter((tab) => /^https?:/.test(tab.url || ''))), '[setup] 普通标签仍只有 A/B，S 未打开').toEqual([A, B].sort());
      const config = await api.get('/api/config');
      expect(config.status, '[setup] 真实隐私配置读回成功').toBe(200);
      expect(config.body.enablePrivacyFilter, '[setup] 隐私过滤处于开启状态').toBe(true);
      expect(config.body.privacySensitiveKeywords.map((keyword) => keyword.toLowerCase()), '[setup] 有效关键词包含 token').toContain('token');
      evidence.note(JSON.stringify({ browserTabs: tabs, config: config.body, syntheticHistoryOnlyUrl: S }));
    });

    await test.step('S3：真实同步一次，检查发送前过滤、后端页面和两个数字计数', async () => {
      popup = await openIdlePopup(ext, network);
      const clickedAt = Date.now();
      await popup.getByTestId('sync-button').click();
      await expect(popup.getByTestId('sync-status'), '[E3] 过滤一条历史后仍同步成功').toHaveAttribute('data-status', 'success');
      await waitForBatch(ext, network, clickedAt);
      expect(network.posts, '[E1] UI 同步只发一次 POST').toHaveLength(1);
      const body = network.posts[0].requestBody;
      expect(body, '[E1] activeTab 字段存在且当前 URL 为 B').toHaveProperty('activeTab.url', B);
      expect(body, '[E1] openTabs 字段存在').toHaveProperty('openTabs');
      expect(body, '[E1] history 字段存在').toHaveProperty('history');
      expect(urlsOf(body.openTabs), '[E1] 上报普通标签集合恰为 A/B').toEqual([A, B].sort());
      expect(urlsOf(body.history), '[E1] 上报历史集合恰为 A/B，敏感 S 已在发送前过滤').toEqual([A, B].sort());
      expect(urlsOf([body.activeTab, ...body.openTabs, ...body.history]), '[E1] 三个上报字段均不含敏感 S').not.toContain(S);
      expect(network.responses, '[E2] 本批有一次真实响应').toHaveLength(1);
      expect(network.responses[0].status, '[E2] 真实 POST 返回200').toBe(200);
      expect(network.responses[0].responseBody, '[E2] 后端接收5条、拒收0条且只有2页').toMatchObject({
        received: 5, rejected: 0, pageCount: 2,
      });
      expect(network.failures, '[E2] 同步没有连接失败').toHaveLength(0);
      const ranked = await api.get('/api/pages/ranked');
      expect(ranked.status, '[E2] 真实排序读回成功').toBe(200);
      expect(urlsOf(ranked.body.pages), '[E2] 后端只有 A/B，不含敏感 S').toEqual([A, B].sort());
      await expect(popup.getByTestId('sync-status'), '[E3] 最终状态为 success').toHaveAttribute('data-status', 'success');
      await expect(popup.getByTestId('sync-status'), '[E3] 文案包含同步成功').toContainText('同步成功');
      await expect(popup.getByTestId('sync-uploaded-count'), '[E3] 去重前上传条数为5').toHaveText('5');
      await expect(popup.getByTestId('sync-filtered-count'), '[E3] 只过滤一次敏感历史，计数为1').toHaveText('1');
      const { syncState } = await ext.getStorage('syncState');
      expect(syncState.stats.uploaded, '[E4] 持久化上传数为5').toBe(5);
      expect(syncState.stats.filtered, '[E4] 持久化过滤数为1').toBe(1);
      const observedUploadCount = (body.activeTab ? 1 : 0) + body.openTabs.length + body.history.length;
      expect(syncState.stats.uploaded, '[E4] 上传统计等于真实请求的去重前条数').toBe(observedUploadCount);
      const history = await ext.swEval(() => chrome.history.search({ text: '', startTime: 0, maxResults: 500 }));
      const sensitiveCount = history.filter((item) => item.url === S).length;
      expect(sensitiveCount, '[E4] 敏感历史在真实浏览器仅出现一次').toBe(1);
      expect(syncState.stats.filtered, '[E4] 过滤统计等于这唯一一条敏感历史').toBe(sensitiveCount);
      await network.drain();
      expect(network.posts, '[E1] 读回结束仍只发送一次同步 POST').toHaveLength(1);
      evidence.note(JSON.stringify({ syncState, observedUploadCount, sensitiveCount }));
      await ext.snap(popup, '上传5条-过滤1条-后端已读回');
    });
  } finally {
    await network.stop();
  }
});

