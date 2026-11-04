import { test, expect } from '../fixtures/extension.mjs';

const DOCS = 'https://example.com/docs';

// Observe the popup's own calls. Return the native Promise unchanged and forward
// callbacks with their original this/arguments; never consume runtime.lastError.
async function observeMessages(ext) {
  await ext.context.addInitScript(() => {
    if (location.protocol === 'chrome-extension:' && chrome.runtime?.sendMessage) {
      const state = { records: [], pending: 0 };
      globalThis.__cacheUiMessages = state;
      const nativeSend = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = function (...args) {
        const message = args.find((arg) => arg && typeof arg === 'object' && typeof arg.type === 'string');
        const row = { request: structuredClone(message), settled: false, response: null, error: null };
        state.records.push(row);
        state.pending += 1;
        const finish = (response, error) => {
          if (!row.settled) {
            row.response = response === undefined ? null : structuredClone(response);
            row.error = error;
            row.settled = true;
            state.pending -= 1;
          }
        };
        const forwarded = [...args];
        const last = forwarded.length - 1;
        const callback = typeof forwarded[last] === 'function' ? forwarded[last] : null;
        if (callback) {
          forwarded[last] = function (...values) {
            finish(values[0], null);
            return Reflect.apply(callback, this, values);
          };
        }
        let returned = false;
        try {
          const result = Reflect.apply(nativeSend, this, forwarded);
          returned = true;
          if (result && typeof result.then === 'function') {
            result.then((value) => finish(value, null), (error) => finish(null, { name: error?.name, message: String(error?.message || error) }));
          } else if (!callback) {
            finish(null, { message: 'runtime.sendMessage returned neither a Promise nor a callback result' });
          }
          return result;
        } finally {
          if (!returned) finish(null, { message: 'runtime.sendMessage threw synchronously' });
        }
      };
    }
  });
}

// These listeners only observe actual traffic; no request is intercepted or sent.
function observeBackend(ext, evidence) {
  const origins = new Set([new URL(ext.baseURL).origin, 'http://127.0.0.1:9']);
  const records = [];
  const requests = new Map();
  const pending = new Set();
  const parsing = new Set();
  const errors = [];
  const recordEvidence = (row) => evidence.recordApi({
    reqId: row.reqId, method: row.method, url: row.url, setup: false,
    requestHeaders: row.requestHeaders, requestBody: row.requestBody,
    status: row.status, responseHeaders: row.responseHeaders || {},
    responseBody: row.responseBody, failure: row.failure || null, ms: Date.now() - row.startedAt,
  });
  ext.context.on('request', (request) => {
    const url = new URL(request.url());
    if (origins.has(url.origin) && url.pathname.startsWith('/api/')) {
      const text = request.postData();
      const row = {
        method: request.method(), url: request.url(), path: url.pathname,
        requestHeaders: request.headers(), requestBody: text ? JSON.parse(text) : null,
        reqId: request.headers()['x-request-id'] || `observed-${records.length + 1}`,
        startedAt: Date.now(), status: null, responseBody: null,
      };
      requests.set(request, row);
      records.push(row);
      pending.add(request);
    }
  });
  ext.context.on('response', (response) => {
    const row = requests.get(response.request());
    if (row) {
      const task = (async () => {
        const failure = await response.finished();
        if (failure) throw failure;
        row.status = response.status();
        row.responseHeaders = response.headers();
        const text = await response.text();
        row.responseBody = text ? JSON.parse(text) : null;
        recordEvidence(row);
      })();
      parsing.add(task);
      task.then(() => parsing.delete(task), (error) => {
        errors.push(String(error?.stack || error));
        parsing.delete(task);
      });
    }
  });
  ext.context.on('requestfinished', (request) => pending.delete(request));
  ext.context.on('requestfailed', (request) => {
    const row = requests.get(request);
    if (row) {
      row.status = 0;
      row.failure = request.failure()?.errorText || 'requestfailed';
      recordEvidence(row);
      pending.delete(request);
    }
  });
  return { records, pending, parsing, errors };
}

async function settle(traffic, popup) {
  let previous = null;
  let stable = 0;
  await expect.poll(async () => {
    const messages = await popup.evaluate(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return globalThis.__cacheUiMessages;
    });
    const signature = JSON.stringify([traffic.records.length, messages.records.length]);
    const idle = traffic.pending.size === 0 && traffic.parsing.size === 0 && messages.pending === 0;
    stable = idle && signature === previous ? stable + 1 : 0;
    previous = signature;
    return stable >= 1;
  }, { message: 'Real requests, response parsing and popup messages all settle', timeout: 20_000 }).toBe(true);
  expect(traffic.errors, 'Every observed response body is successfully parsed').toEqual([]);
  const messages = await popup.evaluate(() => globalThis.__cacheUiMessages.records);
  expect(messages.filter((row) => row.error), 'The passive message observer reports no transport or instrumentation errors').toEqual([]);
}

async function resetProfile(ext) {
  for (const page of ext.context.pages()) await page.close();
  await ext.swEval(async () => {
    await chrome.storage.local.clear();
    await chrome.history.deleteAll();
  });
  await ext.setStorage({ apiBaseUrl: ext.baseURL, connection: { status: 'online', recoverPending: false } });
}

test('TC-UI-CACHE-004 无缓存且后端不可达：首页提示及诊断入口可用、上下文仍可读', async ({ ext, evidence }) => {
  const HISTORY_ONE = 'https://example.com/history-one';
  let popup;
  let traffic;

  await test.step('S1：从无缓存开始，只打开docs、构造唯一历史后真实离线打开首页', async () => {
    await resetProfile(ext);
    expect(await ext.getStorage('cache'), '[E5] The cache key is genuinely absent before the offline attempt').toEqual({});
    await ext.mockSites({ [DOCS]: 'Cache docs' });
    const [docs] = await ext.openTabs([DOCS]);
    await ext.swEval(async (url) => {
      await chrome.history.deleteAll();
      await chrome.history.addUrl({ url });
    }, HISTORY_ONE);
    await docs.bringToFront();
    await observeMessages(ext);
    traffic = observeBackend(ext, evidence);
    await ext.useUnreachableBackend();
    popup = await ext.openPopup();
    await expect(popup.getByTestId('connection-status'), 'The real unreachable backend is detected').toHaveAttribute('data-state', 'offline');
    await settle(traffic, popup);
    expect(traffic.records.some((row) => new URL(row.url).port === '9' && row.status === 0 && row.failure), 'At least one actual port-9 request failed').toBe(true);
    await ext.snap(popup, 'no-cache-home-offline');
  });

  await test.step('S2：逐个作用域核对三类错误区块与诊断入口，并实际进入诊断页签', async () => {
    const errorIds = ['rec-error', 'home-ranked-error', 'home-cleanup-error'];
    for (const id of errorIds) {
      const error = popup.getByTestId(id);
      await expect(error, '[E1] Each home data block exposes its error state').toBeVisible();
      await expect(error, '[E1] Every home block explains that the backend is disconnected').toContainText('后端未连接');
      await expect(error.getByTestId('error-diag-link'), '[E1] Each scoped diagnostic link is visible').toBeVisible();
      await expect(error.getByTestId('error-diag-link'), '[E1] Each scoped link includes the diagnostic label').toContainText('诊断');
    }
    await ext.snap(popup, 'three-scoped-error-blocks');
    for (const id of errorIds) {
      await popup.getByTestId(id).getByTestId('error-diag-link').click();
      await expect(popup.getByTestId('tab-diag'), '[E2] Clicking each scoped diagnostic link selects the diagnostic tab').toHaveAttribute('aria-selected', 'true');
      await settle(traffic, popup);
      await ext.snap(popup, `diagnostic-from-${id}`);
      await popup.getByTestId('tab-home').click();
    }
  });

  await test.step('S3：核对规则禁用、上下文独立可读以及缓存仍完全不存在', async () => {
    await expect(popup.getByTestId('home-rule-parse-button'), '[E3] Home rule parsing is disabled while disconnected').toBeDisabled();
    await expect(popup.getByTestId('offline-banner-home'), '[E5] No cachedAt means no fabricated home cache-time banner').toBeHidden();
    await ext.snap(popup, 'no-cache-home-rule-disabled');
    await popup.getByTestId('tab-rules').click();
    await expect(popup.getByTestId('rule-offline-hint'), '[E3] The rules tab exposes its offline explanation').toBeVisible();
    await expect(popup.getByTestId('rule-offline-hint'), '[E3] The explanation states that parsing requires a backend connection').toContainText('后端未连接，暂时无法解析');
    await ext.snap(popup, 'rules-disconnected');
    await popup.getByTestId('tab-context').click();
    await expect(popup.getByTestId('context-tabs-list').getByTestId('context-tab-url'), '[E4] The context tab list contains only the declared docs page').toHaveText([DOCS]);
    await expect(popup.getByTestId('context-history-list').getByTestId('context-history-url'), '[E4] History contains only history-one after clearing real browser history').toHaveText([HISTORY_ONE]);
    await expect(popup.getByTestId('context-error'), '[E4] Browser context remains readable without the backend').toBeHidden();
    await settle(traffic, popup);
    expect(await ext.getStorage('cache'), '[E5] Settled failures have created no cache key, data or cachedAt').toEqual({});
    await ext.snap(popup, 'browser-context-without-backend');
    await popup.getByTestId('tab-home').click();
    await settle(traffic, popup);
    await expect(popup.getByTestId('offline-banner-home'), '[E5] The final home view still has no invented cached time').toBeHidden();
    expect(await ext.getStorage('cache'), '[E5] Returning home does not fabricate a cache').toEqual({});
  });
});
