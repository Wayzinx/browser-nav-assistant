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

async function filteredReplies(popup, start, openOnly, domain) {
  const records = await popup.evaluate(() => globalThis.__cacheUiMessages.records);
  return records.slice(start).filter((row) => row.request?.type === 'GET_RANKED'
    && Boolean(row.request.payload?.openOnly) === openOnly
    && (row.request.payload?.domain || '') === domain);
}

function assertNoCacheReplies(rows) {
  expect(rows.length, '[E1] The actual UI filter action produces at least one observed GET_RANKED response').toBeGreaterThanOrEqual(1);
  const network = rows.filter((row) => (row.request.payload?.source || 'network') === 'network');
  expect(network.length, '[E1] The UI action includes a real network-source GET_RANKED attempt').toBeGreaterThanOrEqual(1);
  for (const row of rows) {
    expect(row.settled, '[E1] Every UI-triggered filtered message is fully settled').toBe(true);
    expect(row.response?.ok, '[E1] The actual UI-triggered filtered response has ok=false').toBe(false);
    expect(row.response?.error?.code, '[E1] The actual UI-triggered filtered response reports NO_CACHE').toBe('NO_CACHE');
    expect(row.response?.error?.message, '[E1] The actual UI-triggered filtered response reports the exact online requirement').toBe('筛选需要在线');
  }
}

test('TC-UI-CACHE-007 离线筛选反例：不冒用默认缓存，清除筛选后恢复默认缓存', async ({ ext, api, evidence }) => {
  const prepared = await preparePopulated(ext, api, evidence);
  const A = prepared.cache;
  const traffic = prepared.traffic;
  let popup;
  const urls = A.ranked.data.pages.map((row) => row.url);
  expect(A.ranked.data.domains, 'Independent default cache A includes github.com').toContain('github.com');
  expect(A.ranked.data.domains.length, 'Independent default cache A has at least two domains').toBeGreaterThanOrEqual(2);
  expect(traffic.records.some((row) => {
    const url = new URL(row.url);
    return row.method === 'GET' && row.path === '/api/pages/ranked' && row.status === 200
      && url.searchParams.get('limit') === '50' && url.searchParams.get('openOnly') !== 'true' && !url.searchParams.get('domain');
  }), 'A is populated through an actual default-limit unfiltered ranked request').toBe(true);

  await test.step('S1：保存独立默认缓存A，改为端口9后重开排序页并读取默认离线列表', async () => {
    await ext.snap(prepared.popup, 'online-default-cache-A');
    await prepared.popup.close();
    const start = traffic.records.length;
    await ext.useUnreachableBackend();
    popup = await ext.openPopup();
    await expect(popup.getByTestId('connection-status'), 'The unreachable backend is detected through real traffic').toHaveAttribute('data-state', 'offline');
    await popup.getByTestId('tab-ranked').click();
    await expect(popup.getByTestId('ranked-filter-open'), 'The open filter starts disabled as a filter value').toHaveAttribute('aria-pressed', 'false');
    await expect(popup.getByTestId('ranked-filter-domain'), 'The domain filter starts at the registered empty no-filter value').toHaveValue('');
    await expect(popup.getByTestId('ranked-list').getByTestId('ranked-item-url'), '[E4] The initial default offline URL order equals cache A').toHaveText(urls);
    await settle(traffic, popup);
    expect(traffic.records.slice(start).some((row) => new URL(row.url).port === '9' && row.status === 0 && row.failure), 'The default offline view follows actual connection failure').toBe(true);
    expect((await ext.getStorage('cache')).cache.ranked, '[E3] Opening the default offline ranked view preserves A.ranked').toEqual(A.ranked);
    const values = await popup.getByTestId('ranked-filter-domain').evaluate((select) => [...select.options].map((option) => option.value));
    expect(values, 'The live registered domain control contains github.com').toContain('github.com');
    expect(values, 'The live registered control exposes the contract-defined empty no-filter option').toContain('');
    await ext.snap(popup, 'offline-default-ranked');
  });

  await test.step('S2：分别实际启用打开中筛选和github域名筛选，被动核对各自消息及缓存', async () => {
    const openStart = await popup.evaluate(() => globalThis.__cacheUiMessages.records.length);
    const openTrafficStart = traffic.records.length;
    await popup.getByTestId('ranked-filter-open').click();
    await expect(popup.getByTestId('ranked-filter-offline-hint'), '[E1] The open-only filter displays its offline requirement').toBeVisible();
    await expect(popup.getByTestId('ranked-filter-offline-hint'), '[E1] The open-only hint includes the exact online requirement').toContainText('筛选需要在线');
    await settle(traffic, popup);
    const openReplies = await filteredReplies(popup, openStart, true, '');
    evidence.note(`open-only actual GET_RANKED replies: ${JSON.stringify(openReplies)}`);
    assertNoCacheReplies(openReplies);
    expect(traffic.records.slice(openTrafficStart).some((row) => {
      const url = new URL(row.url);
      return row.path === '/api/pages/ranked' && url.port === '9' && url.searchParams.get('openOnly') === 'true' && !url.searchParams.get('domain') && row.status === 0 && Boolean(row.failure);
    }), '[E1] The open-only subscenario reaches the real unreachable backend with no domain filter').toBe(true);
    await expect(popup.getByTestId('ranked-filter-open'), '[E2] The failed open-only control keeps its requested pressed state').toHaveAttribute('aria-pressed', 'true');
    await expect(popup.getByTestId('ranked-filter-open'), '[E2] The failed open-only control remains enabled').toBeEnabled();
    await expect(popup.getByTestId('ranked-filter-domain'), '[E2] The open-only subscenario has no domain filter').toHaveValue('');
    expect((await ext.getStorage('cache')).cache.ranked, '[E3] The settled open-only failure preserves all ranked data and its cachedAt').toEqual(A.ranked);
    await ext.snap(popup, 'offline-open-filter-error');

    await popup.getByTestId('ranked-filter-open').click();
    await expect(popup.getByTestId('ranked-filter-open'), '[E4] Clearing the open-only filter restores openOnly=false').toHaveAttribute('aria-pressed', 'false');
    await expect(popup.getByTestId('ranked-filter-domain'), '[E4] Both filter values are clear between independent subscenarios').toHaveValue('');
    await expect(popup.getByTestId('ranked-filter-offline-hint'), '[E4] The hint disappears after clearing the open-only filter').toBeHidden();
    await expect(popup.getByTestId('ranked-list').getByTestId('ranked-item-url'), '[E4] Clearing open-only restores the complete A URL order').toHaveText(urls);
    await settle(traffic, popup);
    expect((await ext.getStorage('cache')).cache.ranked, '[E4] Clearing open-only preserves A.ranked including its timestamp').toEqual(A.ranked);
    await ext.snap(popup, 'open-filter-cleared-default-restored');

    const domainStart = await popup.evaluate(() => globalThis.__cacheUiMessages.records.length);
    const domainTrafficStart = traffic.records.length;
    await popup.getByTestId('ranked-filter-domain').selectOption('github.com');
    await expect(popup.getByTestId('ranked-filter-offline-hint'), '[E1] The domain-only filter displays its offline requirement').toBeVisible();
    await expect(popup.getByTestId('ranked-filter-offline-hint'), '[E1] The domain-only hint includes the exact online requirement').toContainText('筛选需要在线');
    await settle(traffic, popup);
    const domainReplies = await filteredReplies(popup, domainStart, false, 'github.com');
    evidence.note(`domain-only actual GET_RANKED replies: ${JSON.stringify(domainReplies)}`);
    assertNoCacheReplies(domainReplies);
    expect(traffic.records.slice(domainTrafficStart).some((row) => {
      const url = new URL(row.url);
      return row.path === '/api/pages/ranked' && url.port === '9' && url.searchParams.get('domain') === 'github.com' && url.searchParams.get('openOnly') !== 'true' && row.status === 0 && Boolean(row.failure);
    }), '[E1] The independent domain subscenario reaches the actual unreachable backend without openOnly').toBe(true);
    await expect(popup.getByTestId('ranked-filter-domain'), '[E2] The failed domain filter retains github.com as its selected value').toHaveValue('github.com');
    await expect(popup.getByTestId('ranked-filter-domain'), '[E2] The failed domain control remains enabled').toBeEnabled();
    await expect(popup.getByTestId('ranked-filter-open'), '[E2] The domain subscenario keeps the previous open-only filter cleared').toHaveAttribute('aria-pressed', 'false');
    expect((await ext.getStorage('cache')).cache.ranked, '[E3] The settled domain failure preserves all ranked data and its cachedAt').toEqual(A.ranked);
    await ext.snap(popup, 'offline-domain-filter-error');
  });

  await test.step('S3：用已登记下拉框的真实空值选项清除筛选，核对默认顺序和缓存时间恢复', async () => {
    await popup.getByTestId('ranked-filter-domain').selectOption('');
    await expect(popup.getByTestId('ranked-filter-open'), '[E4] The final default view has openOnly=false').toHaveAttribute('aria-pressed', 'false');
    await expect(popup.getByTestId('ranked-filter-domain'), '[E4] The final domain selection is the actual empty no-filter option').toHaveValue('');
    await expect(popup.getByTestId('ranked-filter-offline-hint'), '[E4] Clearing the domain filter removes the offline filter hint').toBeHidden();
    await expect(popup.getByTestId('ranked-list').getByTestId('ranked-item-url'), '[E4] Clearing all filters restores the complete cached URL order').toHaveText(urls);
    await settle(traffic, popup);
    expect((await ext.getStorage('cache')).cache.ranked, '[E4] Both ranked data and cachedAt remain deeply equal to A after all filtering attempts settle').toEqual(A.ranked);
    await ext.snap(popup, 'all-filters-cleared-cache-preserved');
  });
});
