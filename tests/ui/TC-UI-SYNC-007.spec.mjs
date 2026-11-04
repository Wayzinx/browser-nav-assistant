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
  // 门禁高负载下 SW 刚注册时 chrome.history/storage 绑定可能尚未就绪；只等待就绪，不改变前置语义。
  await expect.poll(() => ext.swEval(() => typeof chrome.history?.deleteAll === 'function'
    && typeof chrome.storage?.local?.remove === 'function'), { // expect.poll 遇到抛错会自动重试
    message: '[setup] SW 扩展 API 绑定已就绪', timeout: 10_000,
  }).toBe(true);
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

test('TC-UI-SYNC-007 冷态SW遗留31秒syncing：判为SYNC_INTERRUPTED并持久化失败', async ({ ext, api, evidence }) => {
  const network = observeSync(ext, evidence);
  let popup;
  try {
    await test.step('S1：在从未同步的独立 SW 写入31秒前的完整中断持久态', async () => {
      await resetBrowser(ext);
      const prepared = await ext.swEval(async () => {
        const writtenAt = Date.now();
        const syncState = {
          status: 'syncing', startedAt: writtenAt - 31_000,
          lastSyncAt: null, lastSuccessAt: null, lastError: null,
          cursor: null, cursorBase: null, fullReason: null,
          mode: 'full', trigger: 'user',
          stats: { uploaded: 0, filtered: 0, received: 0, created: 0, updated: 0, rejected: 0 },
        };
        await chrome.storage.local.set({
          syncState,
          connection: {
            status: 'unknown', since: writtenAt, lastCheckedAt: null,
            lastErrorCode: null, recoverPending: false,
          },
        });
        const stored = await chrome.storage.local.get(['syncState', 'connection']);
        return { writtenAt, readAt: Date.now(), ...stored };
      });
      expect(prepared.readAt - prepared.syncState.startedAt, '[setup] 真实读取时遗留状态已过31秒').toBeGreaterThanOrEqual(31_000);
      expect(prepared.syncState.status, '[setup] 写入的是 syncing，中断判定由产品加载执行').toBe('syncing');
      expect(prepared.connection.recoverPending, '[setup] 无网络自动恢复标记').toBe(false);
      expect(network.posts, '[setup] 从未启动真实同步，无未决同步批次').toHaveLength(0);
      evidence.note(JSON.stringify({ coldState: prepared, syncNowSent: false }));
    });

    await test.step('S2：仅打开 popup，由正常 GET_SYNC_STATE 触发中断检测', async () => {
      popup = await ext.openPopup();
      await expect(popup.getByTestId('sync-status'), '[E1] 首次加载将超时 syncing 变为 error').toHaveAttribute('data-status', 'error');
      await expect(popup.getByTestId('sync-status'), '[E1] 首次显示同步失败').toContainText('同步失败');
      await expect(popup.getByTestId('sync-error-message'), '[E1] 首次失败原因包含中断').toContainText('中断');
      const { syncState } = await ext.getStorage('syncState');
      expect(syncState.status, '[E2] 中断失败已写入 storage').toBe('error');
      expect(syncState.lastError.code, '[E2] 中断错误码符合契约').toBe('SYNC_INTERRUPTED');
      expect(syncState.lastError.message, '[E2] 持久化原因包含中断').toContain('中断');
      await expect(popup.getByTestId('sync-diag-link'), '[E3] 中断时诊断入口可见').toBeVisible();
      await expect(popup.getByTestId('sync-diag-link'), '[E3] 入口含诊断文案').toContainText('诊断');
      await expect(popup.getByTestId('sync-button'), '[E3] 不再维持 syncing 禁用状态').toBeEnabled();
      await network.drain();
      evidence.note(JSON.stringify({ firstReadback: syncState, posts: network.posts.length }));
      await ext.snap(popup, '首次加载-中断已判定并持久化');
    });

    await test.step('S3：关闭重开后读回相同中断错误，核对零同步请求', async () => {
      popup = await ext.reopenPopup();
      await expect(popup.getByTestId('sync-status'), '[E4] 重开后仍为 error').toHaveAttribute('data-status', 'error');
      await expect(popup.getByTestId('sync-status'), '[E4] 重开后仍显示同步失败').toContainText('同步失败');
      await expect(popup.getByTestId('sync-error-message'), '[E4] 重开后仍显示中断原因').toContainText('中断');
      const { syncState } = await ext.getStorage('syncState');
      expect(syncState.status, '[E4] 重开未把持久态重置为成功').toBe('error');
      expect(syncState.lastError.code, '[E4] 重开后错误码仍为 SYNC_INTERRUPTED').toBe('SYNC_INTERRUPTED');
      expect(syncState.lastError.message, '[E4] 重开后持久化原因仍包含中断').toContain('中断');
      const health = await api.get('/api/health');
      expect(health.status, '[E5] 真实健康接口读回成功').toBe(200);
      expect(health.body.pageCount, '[E5] 中断恢复未写入任何页面').toBe(0);
      await ext.snap(popup, '重开后-中断错误保留');
      await network.drain();
      expect(network.posts, '[E5] 中断检测及重开均未发送同步 POST').toHaveLength(0);
      expect(network.responses, '[E5] 没有伪造成功的同步响应').toHaveLength(0);
      evidence.note(JSON.stringify({ reopenedReadback: syncState, posts: network.posts.length }));
    });
  } finally {
    await network.stop();
  }
});

