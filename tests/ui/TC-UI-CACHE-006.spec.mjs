import { test, expect } from '../fixtures/extension.mjs';

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

async function cacheReady(ext, key) {
  await expect.poll(async () => {
    const { cache } = await ext.getStorage('cache');
    const items = ['ranked', 'cleanup', 'rules', 'config'].map((name) => cache?.[name]);
    items.push(cache?.recommendations?.[key]);
    return Number.isInteger(cache?.cachedAt) && cache.cachedAt > 0
      && items.every((item) => item && Object.hasOwn(item, 'data') && Number.isInteger(item.cachedAt) && item.cachedAt > 0);
  }, { message: 'All five real result caches and top-level cachedAt are persisted' }).toBe(true);
}

async function bannerText(popup, timestamp) {
  const time = await popup.evaluate((value) => {
    const date = new Date(value);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }, timestamp);
  return `以下为 ${time} 同步时缓存的结果`;
}

test('TC-UI-CACHE-006 空集合与无缓存边界：已缓存的空结果离线显示空态及缓存时间', async ({ ext, evidence }) => {
  let popup;
  let traffic;
  let A;

  await test.step('S1：无普通标签和历史时点击真实同步，被动核对空输入及五类空缓存', async () => {
    await resetProfile(ext);
    await ext.context.newPage();
    const browserInput = await ext.swEval(async () => ({
      webTabs: (await chrome.tabs.query({})).filter((tab) => /^https?:/.test(tab.url || '')).map((tab) => tab.url),
      history: await chrome.history.search({ text: '', startTime: 0, maxResults: 100 }),
    }));
    expect(browserInput.webTabs, '[E1] No http(s) page is open before synchronization').toEqual([]);
    expect(browserInput.history, '[E1] Browser history is genuinely empty').toEqual([]);
    await observeMessages(ext);
    traffic = observeBackend(ext, evidence);
    popup = await ext.openPopup();
    await settle(traffic, popup);
    const start = traffic.records.length;
    await popup.getByTestId('sync-button').click();
    await expect(popup.getByTestId('sync-status'), '[E1] The real empty synchronization succeeds').toHaveAttribute('data-status', 'success');
    await settle(traffic, popup);
    await cacheReady(ext, '__none__');
    const sync = traffic.records.slice(start).filter((row) => row.method === 'POST' && row.path === '/api/sync');
    expect(sync, '[E1] One manual UI action produces exactly one real synchronization request').toHaveLength(1);
    expect({ activeTab: sync[0].requestBody.activeTab, openTabs: sync[0].requestBody.openTabs, history: sync[0].requestBody.history }, '[E1] Actual uploaded browser input is null and two empty arrays').toEqual({ activeTab: null, openTabs: [], history: [] });
    expect(sync[0].status, '[E1] The observed real synchronization response has HTTP status 200').toBe(200);
    expect({ received: sync[0].responseBody.received, pageCount: sync[0].responseBody.pageCount }, '[E1] The real response received zero inputs and stores zero pages').toEqual({ received: 0, pageCount: 0 });
    A = (await ext.getStorage('cache')).cache;
    expect(A.ranked.data.pages, '[E2] Ranked cache stores a legitimate empty result').toEqual([]);
    expect(A.cleanup.data.suggestions, '[E2] Cleanup cache stores a legitimate empty result').toEqual([]);
    expect(A.cleanup.data.summary, '[E2] Empty cleanup results have no archive, merge or keep suggestions').toEqual({ archive: 0, merge: 0, keep: 0 });
    expect(A.rules.data.rules, '[E2] Rules cache stores a legitimate empty result').toEqual([]);
    expect(Object.keys(A.recommendations), '[E3] The no-current-page recommendation cache uses only the __none__ key').toEqual(['__none__']);
    expect(A.recommendations.__none__.data.recommendations, '[E3] The __none__ recommendation entry contains an empty recommendation array').toEqual([]);
    expect(Object.keys(A).sort(), '[E4] All five cache categories and the top-level timestamp exist').toEqual(['ranked', 'recommendations', 'cleanup', 'rules', 'config', 'cachedAt'].sort());
    const items = [A.ranked, A.cleanup, A.rules, A.config, A.recommendations.__none__];
    for (const item of items) {
      expect(Object.keys(item).sort(), '[E4] Every cached result retains its data and cachedAt wrapper even when empty').toEqual(['cachedAt', 'data']);
      expect(item.data, '[E4] A valid empty cache still has an actual response object').toEqual(expect.any(Object));
    }
    const times = [...items.map((item) => item.cachedAt), A.cachedAt];
    expect(times.map((value) => Number.isInteger(value) && value > 0), '[E4] Every item timestamp and the top-level timestamp is a positive integer in milliseconds').toEqual([true, true, true, true, true, true]);
    await ext.snap(popup, 'online-empty-cache-A');
  });

  await test.step('S2：端口9真实失败后逐页核对五个空态、精确缓存时间及完整缓存未变化', async () => {
    await popup.close();
    const start = traffic.records.length;
    await ext.useUnreachableBackend();
    popup = await ext.openPopup();
    await expect(popup.getByTestId('connection-status'), 'The unreachable backend causes an actual offline state').toHaveAttribute('data-state', 'offline');
    await settle(traffic, popup);
    expect(traffic.records.slice(start).some((row) => new URL(row.url).port === '9' && row.status === 0 && row.failure), 'The offline branch follows a real failed backend request').toBe(true);
    const expectedBanner = await bannerText(popup, A.cachedAt);
    await expect(popup.getByTestId('home-ranked-empty'), '[E5] Home ranking shows the cached empty state').toBeVisible();
    await expect(popup.getByTestId('rec-empty'), '[E5] Recommendations show the cached empty state').toBeVisible();
    await expect(popup.getByTestId('home-cleanup-empty'), '[E5] Home cleanup shows the cached empty state').toBeVisible();
    await expect(popup.getByTestId('home-ranked-error'), '[E5] Empty ranking cache is not treated as an error').toBeHidden();
    await expect(popup.getByTestId('rec-error'), '[E5] Empty recommendation cache is not treated as an error').toBeHidden();
    await expect(popup.getByTestId('home-cleanup-error'), '[E5] Empty cleanup cache is not treated as an error').toBeHidden();
    await expect(popup.getByTestId('offline-banner-home'), '[E6] Home displays a cache-time banner for a valid empty result').toBeVisible();
    await expect(popup.getByTestId('offline-banner-home'), '[E6] Home uses the exact local time from A.cachedAt').toHaveText(expectedBanner);
    await ext.snap(popup, 'offline-empty-home');
    await popup.getByTestId('tab-ranked').click();
    await expect(popup.getByTestId('ranked-empty'), '[E5] The complete ranked page shows its cached empty state').toBeVisible();
    await expect(popup.getByTestId('ranked-error'), '[E5] The complete ranked page has no error state').toBeHidden();
    await expect(popup.getByTestId('ranked-list').getByTestId('ranked-item'), '[E6] Ranked data remains empty offline').toHaveCount(0);
    await expect(popup.getByTestId('offline-banner-ranked'), '[E6] The ranked page displays its cache-time banner').toBeVisible();
    await expect(popup.getByTestId('offline-banner-ranked'), '[E6] Ranked time equals the exact local time from A.cachedAt').toHaveText(expectedBanner);
    await ext.snap(popup, 'offline-empty-ranked');
    await popup.getByTestId('tab-cleanup').click();
    await expect(popup.getByTestId('cleanup-empty'), '[E5] The cleanup page shows its cached empty state').toBeVisible();
    await expect(popup.getByTestId('cleanup-error'), '[E5] The cleanup page has no error state').toBeHidden();
    await expect(popup.getByTestId('panel-cleanup').getByTestId('cleanup-item'), '[E6] Cleanup data remains empty offline').toHaveCount(0);
    await expect(popup.getByTestId('offline-banner-cleanup'), '[E6] The cleanup page displays its cache-time banner').toBeVisible();
    await expect(popup.getByTestId('offline-banner-cleanup'), '[E6] Cleanup time equals the exact local time from A.cachedAt').toHaveText(expectedBanner);
    await settle(traffic, popup);
    expect((await ext.getStorage('cache')).cache, '[E6] All settled failures preserve the entire empty cache A including every timestamp').toEqual(A);
    await ext.snap(popup, 'offline-empty-cleanup-cache-preserved');
  });
});
