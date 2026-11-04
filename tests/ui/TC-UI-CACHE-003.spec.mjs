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

async function cacheReady(ext, key) {
  await expect.poll(async () => {
    const { cache } = await ext.getStorage('cache');
    const items = ['ranked', 'cleanup', 'rules', 'config'].map((name) => cache?.[name]);
    items.push(cache?.recommendations?.[key]);
    return Number.isInteger(cache?.cachedAt) && cache.cachedAt > 0
      && items.every((item) => item && Object.hasOwn(item, 'data') && Number.isInteger(item.cachedAt) && item.cachedAt > 0);
  }, { message: 'All five real result caches and top-level cachedAt are persisted' }).toBe(true);
}

async function preparePopulated(ext, api, evidence) {
  await resetProfile(ext);
  await api.loadSample();
  await ext.mockSites({ [DOCS]: 'Cache docs' });
  const [docs] = await ext.openTabs([DOCS]);
  await ext.swEval(async (url) => {
    await chrome.history.deleteAll();
    await chrome.history.addUrl({ url });
  }, DOCS);
  await docs.bringToFront();
  await observeMessages(ext);
  const traffic = observeBackend(ext, evidence);
  const popup = await ext.openPopup();
  await settle(traffic, popup);
  await popup.getByTestId('sync-button').click();
  await expect(popup.getByTestId('sync-status'), 'The independent preparation sync succeeds').toHaveAttribute('data-status', 'success');
  await settle(traffic, popup);
  await cacheReady(ext, DOCS);
  return { popup, traffic, cache: (await ext.getStorage('cache')).cache };
}

async function bannerText(popup, timestamp) {
  const time = await popup.evaluate((value) => {
    const date = new Date(value);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }, timestamp);
  return `以下为 ${time} 同步时缓存的结果`;
}

async function assertRedBanner(banner, expectedText) {
  await expect(banner, '[E1] The banner is visible on its own page').toBeVisible();
  await expect(banner, '[E1] The complete banner text uses A.cachedAt in the browser local timezone').toHaveText(expectedText);
  const colors = await banner.evaluate((element) => {
    const style = getComputedStyle(element);
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d');
    return [style.color, style.backgroundColor].map((color) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return { css: color, rgba: [...context.getImageData(0, 0, 1, 1).data] };
    });
  });
  expect(colors.some(({ rgba: [red, green, blue, alpha] }) => alpha > 0 && red > green && red > blue), '[E2] Actual computed text or background color has visible alpha and a dominant red channel').toBe(true);
}

const cleanupProjection = (suggestions) => suggestions.map((item) => ({
  action: item.action, urls: (item.action === 'merge' ? item.urls : [item.url]).slice().sort(),
})).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

async function displayedCleanup(items) {
  const rows = [];
  for (let index = 0; index < await items.count(); index += 1) {
    const item = items.nth(index);
    const lines = await item.getByTestId('cleanup-item-url').allInnerTexts();
    rows.push({ action: await item.getAttribute('data-action'), urls: lines.flatMap((line) => line.split(/\r?\n/)).map((line) => line.trim()).filter(Boolean).sort() });
  }
  return rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

test('TC-UI-CACHE-003 已有缓存后连接拒绝：三个红色时间横幅与离线数据均等于缓存', async ({ ext, api, evidence }) => {
  const prepared = await preparePopulated(ext, api, evidence);
  const A = prepared.cache;
  const traffic = prepared.traffic;
  let popup;
  let expectedBanner;

  await test.step('S1：保存独立同步的完整缓存A，改到端口9后重开并等待真实连接失败', async () => {
    await ext.snap(prepared.popup, 'online-cache-A');
    await prepared.popup.close();
    const start = traffic.records.length;
    await ext.useUnreachableBackend();
    popup = await ext.openPopup();
    await expect(popup.getByTestId('connection-status'), 'A real failed connection is reported').toHaveAttribute('data-state', 'offline');
    await settle(traffic, popup);
    expect(traffic.records.slice(start).some((row) => new URL(row.url).port === '9' && row.status === 0 && row.failure), 'At least one actual port-9 request failed').toBe(true);
    expectedBanner = await bannerText(popup, A.cachedAt);
    await ext.snap(popup, 'offline-home-ready');
  });

  await test.step('S2：逐页核对时间横幅、实际红色和缓存数据的显示投影', async () => {
    await assertRedBanner(popup.getByTestId('offline-banner-home'), expectedBanner);
    const home = popup.getByTestId('home-ranked-list').getByTestId('home-ranked-item');
    const ranked = A.ranked.data.pages.slice(0, 5);
    await expect(home, '[E3] Home ranking contains exactly the cached first five results').toHaveCount(ranked.length);
    await expect(home.getByTestId('ranked-item-url'), '[E3] Home ranking URL order equals A').toHaveText(ranked.map((row) => row.url));
    await expect(home.getByTestId('ranked-item-title'), '[E3] Home ranking titles equal A').toHaveText(ranked.map((row) => row.title));
    await expect(home.getByTestId('ranked-item-score'), '[E3] Home ranking scores equal A formatted to two decimals').toHaveText(ranked.map((row) => Number(row.score).toFixed(2)));
    await expect(home.getByTestId('ranked-item-reason'), '[E3] Home ranking reasons equal A').toHaveText(ranked.map((row) => row.reason));
    const recommendations = A.recommendations[DOCS].data.recommendations.slice(0, 3);
    const rec = popup.getByTestId('rec-list').getByTestId('rec-item');
    await expect(rec, '[E3] Home recommendations contain exactly the cached first three results').toHaveCount(recommendations.length);
    await expect(rec.getByTestId('rec-item-title'), '[E3] Recommendation titles equal A').toHaveText(recommendations.map((row) => row.title));
    await expect(rec.getByTestId('rec-item-score'), '[E3] Recommendation scores equal A').toHaveText(recommendations.map((row) => Number(row.score).toFixed(2)));
    await expect(rec.getByTestId('rec-item-reason'), '[E3] Recommendation reasons equal A').toHaveText(recommendations.map((row) => row.reason));
    await expect(popup.getByTestId('home-cleanup-archive-count'), '[E3] Home archive summary equals A').toHaveText(`归档 ${A.cleanup.data.summary.archive}`);
    await expect(popup.getByTestId('home-cleanup-merge-count'), '[E3] Home merge summary equals A').toHaveText(`重复 ${A.cleanup.data.summary.merge}`);
    await expect(popup.getByTestId('home-cleanup-keep-count'), '[E3] Home keep summary equals A').toHaveText(`保留 ${A.cleanup.data.summary.keep}`);
    await ext.snap(popup, 'offline-home-projection');

    await popup.getByTestId('tab-ranked').click();
    await assertRedBanner(popup.getByTestId('offline-banner-ranked'), expectedBanner);
    await expect(popup.getByTestId('ranked-list').getByTestId('ranked-item-url'), '[E3] Full ranked URL order equals A without recomputing scores').toHaveText(A.ranked.data.pages.map((row) => row.url));
    await ext.snap(popup, 'offline-ranked-projection');

    await popup.getByTestId('tab-cleanup').click();
    await assertRedBanner(popup.getByTestId('offline-banner-cleanup'), expectedBanner);
    const items = popup.getByTestId('panel-cleanup').getByTestId('cleanup-item');
    await expect(items, '[E3] Cleanup suggestion count equals A').toHaveCount(A.cleanup.data.suggestions.length);
    const projected = await displayedCleanup(items);
    expect(projected, '[E3] Cleanup action and complete URL sets equal A, including every merge URL').toEqual(cleanupProjection(A.cleanup.data.suggestions));
    await ext.snap(popup, 'offline-cleanup-projection');
  });

  await test.step('S3：等待所有失败请求、响应解析与消息完成后核对完整缓存及连接状态', async () => {
    await settle(traffic, popup);
    const storage = await ext.getStorage(['cache', 'connection']);
    expect(storage.cache, '[E4] Failed network refreshes preserve every cache value and cachedAt').toEqual(A);
    expect(storage.connection.status, '[E5] Connection status is offline').toBe('offline');
    expect(storage.connection.recoverPending, '[E5] A failed connection sets the recovery marker').toBe(true);
    await ext.snap(popup, 'settled-cache-preserved');
  });
});
