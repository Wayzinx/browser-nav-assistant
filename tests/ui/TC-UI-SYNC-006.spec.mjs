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

test('TC-UI-SYNC-006 点击后立即关闭popup：3秒后重开显示后台完成的成功状态', async ({ ext, api, evidence }) => {
  const network = observeSync(ext, evidence);
  let popup;
  let closedAt;
  try {
    await test.step('S1：准备 A/B 并等待 popup 初始请求结束', async () => {
      await prepareTwoPages(ext);
      popup = await openIdlePopup(ext, network);
    });

    await test.step('S2：原生点击返回后立即关闭 popup，不等同步完成', async () => {
      const clickedAt = performance.now();
      await popup.getByTestId('sync-button').evaluate((button) => button.click());
      const clickReturnedAt = performance.now();
      await popup.close();
      closedAt = performance.now();
      evidence.note(JSON.stringify({
        clickedAt, clickReturnedAt, closedAt,
        clickToCloseMs: closedAt - clickedAt,
        clickReturnToCloseMs: closedAt - clickReturnedAt,
        completionWasNotAwaited: true,
      }));
      expect(popup.isClosed(), '[E1] 仅 popup tab 已关闭').toBe(true);
      expect(ext.context.serviceWorkers().map((worker) => worker.url()), '[E1] 同一 context 的插件 SW 仍存在').toContain(ext.sw.url());
      const ordinaryUrls = ext.context.pages().filter((page) => /^https?:/.test(page.url())).map((page) => page.url()).sort();
      expect(ordinaryUrls, '[E1] 两个普通页面仍保留 A/B').toEqual([A, B].sort());
    });

    await test.step('S3：在关闭后3秒的检查点立即读回，再创建新 popup', async () => {
      // 用例规定的3秒检查点；只调度到该期限，不轮询/等待成功。
      const deadline = closedAt + 3000;
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.ceil(deadline - performance.now()))));
      const sampledAt = performance.now();
      const stateRead = ext.getStorage('syncState');
      const reopenRequestedAt = performance.now();
      const popupRead = ext.openPopup();
      const [stored, health, reopened] = await Promise.all([stateRead, api.get('/api/health'), popupRead]);
      popup = reopened;
      const stateAtDeadline = stored.syncState;
      evidence.note(JSON.stringify({
        closedAt, sampledAt, reopenRequestedAt, reopenAfterMs: reopenRequestedAt - closedAt,
        schedulingDriftMs: sampledAt - deadline,
        stateAtDeadline, pageCountAtDeadline: health.body.pageCount,
      }));
      // 检查点使用一次性原始快照：不能靠重开后的 UI 自动重试补成成功。
      expect(stateAtDeadline.status, '[E2] 3秒时后台已持久化 success').toBe('success');
      expect(health.status, '[E2] 3秒检查点真实健康接口成功').toBe(200);
      expect(health.body.pageCount, '[E2] popup 关闭后后台已写入2页').toBe(2);
      await expect(popup.getByTestId('sync-status'), '[E3] 新 popup 显示后台成功状态').toHaveAttribute('data-status', 'success');
      await expect(popup.getByTestId('sync-status'), '[E3] 新 popup 包含同步成功文案').toContainText('同步成功');
      await expect(popup.getByTestId('sync-uploaded-count'), '[E3] 新 popup 上传条数为5').toHaveText('5');
      await expect(popup.getByTestId('sync-filtered-count'), '[E3] 新 popup 过滤条数为0').toHaveText('0');
      await ext.snap(popup, '关闭3秒后重开-后台已完成');
      await network.drain();
      expect(network.posts, '[E4] 整个区间只有一次 POST，重开未补做同步').toHaveLength(1);
      expect(network.responses, '[E4] 仅有一次真实同步响应').toHaveLength(1);
      expect(network.responses[0].status, '[E4] 关闭 popup 后的原批次返回200').toBe(200);
      expect(network.failures, '[E4] 关闭 popup 没有中止该请求').toHaveLength(0);
    });
  } finally {
    await network.stop();
  }
});
