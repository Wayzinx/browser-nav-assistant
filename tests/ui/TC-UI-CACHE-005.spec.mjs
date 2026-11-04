import { test, expect } from '../fixtures/extension.mjs';

// TDD 草稿：只观察真实 popup 消息、BrowserContext 网络和 storage，不替换业务结果。
const CURRENT_URL = 'https://example.com/docs';
const UNREACHABLE_ORIGIN = 'http://127.0.0.1:9';
const CACHE_APIS = {
  ranked: ['GET', '/api/pages/ranked'],
  recommendations: ['POST', '/api/recommendations/next'],
  cleanup: ['GET', '/api/pages/cleanup-suggestions'],
  rules: ['GET', '/api/rules'],
  config: ['GET', '/api/config'],
};
const CACHE_MESSAGES = ['GET_RANKED', 'GET_RECOMMENDATIONS', 'GET_CLEANUP', 'LIST_RULES'];

function canonical(value) {
  let result = value;
  if (Array.isArray(value)) result = value.map(canonical);
  else if (value && typeof value === 'object') result = Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return result;
}
const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

// BrowserContext 事件包含 SW 发出的请求；不能只监听 popup，否则会漏掉 /api/sync。
function observeBackend(ext, evidence) {
  const origin = new URL(ext.baseURL).origin;
  const origins = new Set([origin, UNREACHABLE_ORIGIN]);
  const entries = [];
  const byRequest = new Map();
  const inFlight = new Set();
  const bodies = new Set();
  const errors = [];
  let phase = 'initial-popup';
  let countFrom = null;
  let sequence = 0;
  const matches = (request) => {
    const url = new URL(request.url());
    return origins.has(url.origin) && url.pathname.startsWith('/api/');
  };
  const collect = (task) => {
    const settled = task.then(
      () => { bodies.delete(settled); },
      (error) => { errors.push(error); bodies.delete(settled); },
    );
    bodies.add(settled);
  };
  const onRequest = (request) => {
    if (matches(request)) {
      const url = new URL(request.url());
      const entry = {
        sequence: ++sequence, phase, origin: url.origin, path: url.pathname,
        method: request.method(), url: request.url(), requestBody: request.postData(),
        source: request.serviceWorker() ? 'service-worker' : 'page', startedAt: Date.now(),
        status: null, responseBody: null, finished: false,
      };
      entries.push(entry);
      byRequest.set(request, entry);
      inFlight.add(request);
    }
  };
  const onResponse = (response) => {
    const request = response.request();
    if (byRequest.has(request)) collect((async () => {
      const entry = byRequest.get(request);
      const [requestHeaders, responseHeaders, responseText, completionError] = await Promise.all([
        request.allHeaders(), response.allHeaders(), response.text(), response.finished(),
      ]);
      let responseBody = responseText;
      let parseError = null;
      if (/json/i.test(responseHeaders['content-type'] || '')) {
        const [parsed] = await Promise.allSettled([response.json()]);
        if (parsed.status === 'fulfilled') responseBody = parsed.value;
        else { parseError = String(parsed.reason); errors.push(parsed.reason); }
      }
      Object.assign(entry, { status: response.status(), responseBody, completedAt: Date.now(), finished: true });
      evidence.recordApi({
        source: entry.source, phase: entry.phase, observationSequence: entry.sequence,
        reqId: responseHeaders['x-request-id'] || requestHeaders['x-request-id'] || null,
        method: entry.method, url: entry.url, requestHeaders, requestBody: entry.requestBody,
        status: entry.status, responseHeaders, responseBody, responseText, parseError,
        ms: entry.completedAt - entry.startedAt, setup: countFrom === null,
      });
      if (completionError) errors.push(completionError);
    })());
  };
  const onFinished = (request) => { inFlight.delete(request); };
  const onFailed = (request) => {
    inFlight.delete(request);
    if (byRequest.has(request)) collect((async () => {
      const entry = byRequest.get(request);
      const requestHeaders = await request.allHeaders();
      Object.assign(entry, { networkError: request.failure()?.errorText, completedAt: Date.now(), finished: true });
      evidence.recordApi({
        source: entry.source, phase: entry.phase, observationSequence: entry.sequence,
        reqId: requestHeaders['x-request-id'] || null, method: entry.method, url: entry.url,
        requestHeaders, requestBody: entry.requestBody, status: null, responseHeaders: null,
        responseBody: null, networkError: entry.networkError,
        ms: entry.completedAt - entry.startedAt, setup: countFrom === null,
      });
    })());
  };
  ext.context.on('request', onRequest);
  ext.context.on('response', onResponse);
  ext.context.on('requestfinished', onFinished);
  ext.context.on('requestfailed', onFailed);
  return {
    entries, origin,
    get pendingRequests() { return inFlight.size; },
    get pendingBodies() { return bodies.size; },
    get sequence() { return sequence; },
    mark(name) { phase = name; evidence.note(JSON.stringify({ event: 'network-window', name, afterSequence: sequence, at: Date.now() })); return sequence; },
    beginRecovery() { countFrom = sequence; return this.mark('recovery-first'); },
    syncs() { return entries.filter((entry) => countFrom !== null && entry.sequence > countFrom && entry.origin === origin && entry.method === 'POST' && entry.path === '/api/sync'); },
    async drain() {
      while (bodies.size) await Promise.all([...bodies]);
      if (errors.length) throw new AggregateError(errors, '被动网络取证失败，不能把未完成或未解析的请求算作完成');
    },
    async close() {
      await this.drain();
      ext.context.off('request', onRequest);
      ext.context.off('response', onResponse);
      ext.context.off('requestfinished', onFinished);
      ext.context.off('requestfailed', onFailed);
    },
  };
}

async function installMessageObserver(ext) {
  await ext.context.addInitScript(({ popupUrl }) => {
    if (location.href === popupUrl) {
      const state = { records: [], storageEvents: [], errors: [], eventSequence: 0 };
      globalThis.__cache005Observation = state;
      const clone = (value) => {
        let copy;
        try { copy = structuredClone(value); }
        catch (error) { state.errors.push({ operation: 'snapshot', message: String(error) }); } // lint-allow-catch: 观察器序列化失败会在完成门禁断言失败，不改变原生调用
        return copy;
      };
      const completed = (entry) => {
        if (entry.returned && entry.callbackDone && entry.promiseDone) {
          entry.completedAt = Date.now();
          entry.completedSequence = ++state.eventSequence;
        }
      };
      const nativeSend = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = new Proxy(nativeSend, {
        apply(target, receiver, originalArgs) {
          const message = originalArgs[typeof originalArgs[0] === 'string' ? 1 : 0];
          const callbackIndex = originalArgs.length - 1;
          const hasCallback = typeof originalArgs[callbackIndex] === 'function';
          const entry = {
            sequence: ++state.eventSequence, startedAt: Date.now(), message: clone(message),
            returned: false, callbackDone: !hasCallback, promiseDone: true,
          };
          state.records.push(entry);
          const nativeArgs = originalArgs.slice();
          if (hasCallback) {
            nativeArgs[callbackIndex] = new Proxy(originalArgs[callbackIndex], {
              apply(callback, callbackThis, callbackArgs) {
                entry.callbackArgs = clone(callbackArgs);
                entry.response = clone(callbackArgs[0]);
                // 不读取 lastError，保留原 callback 对 runtime.lastError 的原生访问与告警语义。
                try { return Reflect.apply(callback, callbackThis, callbackArgs); }
                finally { entry.callbackDone = true; completed(entry); }
              },
            });
          }
          let nativeResult;
          try { nativeResult = Reflect.apply(target, receiver, nativeArgs); }
          catch (error) { // lint-allow-catch: 记录同步抛错后原对象重新抛出，绝不改变原生错误语义
            entry.nativeThrow = { name: error.name, message: error.message };
            entry.returned = true;
            entry.callbackDone = true;
            completed(entry);
            throw error;
          }
          if (nativeResult instanceof Promise) {
            entry.promiseDone = false;
            // 返回同一个原生 Promise；旁路只记结局，不替换响应，不改变调用方收到的拒绝对象。
            Promise.prototype.then.call(nativeResult,
              (response) => { entry.response = clone(response); entry.promiseDone = true; completed(entry); },
              (error) => { entry.promiseError = { name: error?.name, message: error?.message }; entry.promiseDone = true; completed(entry); },
            );
          } else if (!hasCallback) {
            state.errors.push({ operation: 'sendMessage', message: '没有 Promise 或 callback，无法观察原生完成边界' });
          }
          entry.returned = true;
          completed(entry);
          return nativeResult;
        },
      });
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') state.storageEvents.push({ sequence: ++state.eventSequence, at: Date.now(), changes: clone(changes) });
      });
    }
  }, { popupUrl: ext.popupUrl });
}

async function messageSnapshot(popup) {
  return popup.evaluate(async () => {
    // 只读 storage 的往返以及真正的渲染帧，给消息 continuation 与 storage:onChanged 交付执行机会。
    // 不发送额外 GET/RECOVER 消息，不用计时器或“空闲若干毫秒”充当产品完成。
    await chrome.storage.local.get(['cache', 'connection', 'syncState']);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const state = globalThis.__cache005Observation;
    return { ready: document.readyState === 'complete', ...structuredClone(state) };
  });
}

function cacheFirstComplete(records) {
  const cached = records.filter((record) => CACHE_MESSAGES.includes(record.message?.type) && record.message.payload?.source === 'cache');
  const signature = (record) => {
    const { source, ...payload } = record.message.payload || {};
    void source;
    return JSON.stringify(canonical([record.message.type, payload]));
  };
  const used = new Set();
  return cached.every((cachedRecord) => {
    const network = records.find((record) => !used.has(record.sequence)
      && record.sequence > cachedRecord.sequence && record.completedAt
      && record.message?.payload?.source === 'network' && signature(record) === signature(cachedRecord));
    if (network) used.add(network.sequence);
    return Boolean(network);
  });
}

function cacheResponses(cache, traffic, since) {
  return Object.fromEntries(Object.entries(CACHE_APIS).map(([name, [method, path]]) => {
    const item = name === 'recommendations' ? cache?.recommendations?.[CURRENT_URL] : cache?.[name];
    const actual = traffic.entries.findLast((entry) => entry.sequence > since && entry.origin === traffic.origin
      && entry.method === method && entry.path === path && entry.finished && entry.status >= 200 && entry.status < 300
      && Number.isInteger(item?.cachedAt) && item.cachedAt >= entry.startedAt && same(item.data, entry.responseBody));
    return [name, actual ?? null];
  }));
}

async function settlePopup(popup, ext, traffic, evidence, { cacheSince, requireCaches = true, label }) {
  let snapshot;
  let storage;
  await expect.poll(async () => {
    snapshot = await messageSnapshot(popup);
    expect(snapshot.errors, '被动消息观察器没有丢失完成信号或更改原生语义').toEqual([]);
    await traffic.drain();
    storage = await ext.getStorage(['cache', 'connection', 'syncState']);
    const records = snapshot.records || [];
    const recovery = records.filter((record) => record.message?.type === 'RECOVER_IF_NEEDED');
    const initialReads = ['GET_RANKED', 'GET_RECOMMENDATIONS', 'GET_CLEANUP'].every((type) =>
      records.some((record) => record.message?.type === type && record.message.payload?.source === 'network' && record.completedAt));
    const responses = cacheResponses(storage.cache, traffic, cacheSince);
    return Boolean(snapshot.ready && recovery.length && recovery.every((record) => record.completedAt)
      && records.every((record) => record.completedAt) && initialReads && cacheFirstComplete(records)
      && !traffic.pendingRequests && !traffic.pendingBodies
      && (!requireCaches || (Object.values(responses).every(Boolean) && Number.isInteger(storage.cache?.cachedAt))));
  }, { message: `${label}：等待实际恢复、cache-first 成对刷新、全部消息/网络/body 以及五缓存落盘` }).toBe(true);
  evidence.note(JSON.stringify({ event: 'popup-settled', label, at: Date.now(), snapshot, storage,
    pendingRequests: traffic.pendingRequests, pendingBodies: traffic.pendingBodies, cumulativeSyncCount: traffic.syncs().length }));
  return { snapshot, storage };
}

function latestPopupData(snapshot, traffic, type) {
  const record = snapshot.records.filter((entry) => entry.message?.type === type
    && entry.message.payload?.source === 'network' && entry.response?.ok === true)
    .sort((left, right) => left.completedSequence - right.completedSequence).at(-1);
  expect(record?.response?.ok, '本轮 popup 确实收到对应 network 成功响应').toBe(true);
  const data = record.response.data;
  const name = { GET_RANKED: 'ranked', GET_RECOMMENDATIONS: 'recommendations', GET_CLEANUP: 'cleanup' }[type];
  const [method, path] = CACHE_APIS[name];
  const fields = { ranked: ['pages', 'total', 'domains'], recommendations: ['recommendations'], cleanup: ['summary', 'suggestions'] }[name];
  const matchingRaw = traffic.entries.filter((entry) => entry.startedAt >= record.startedAt && entry.method === method
    && entry.origin === traffic.origin && entry.path === path && entry.status >= 200 && entry.status < 300)
    .some((entry) => fields.every((field) => same(entry.responseBody?.[field], data[field])));
  expect(matchingRaw, 'popup 消息业务数据来自本轮被动捕获的真实成功 HTTP 响应').toBe(true);
  return data;
}

async function assertHome(popup, snapshot, traffic) {
  const ranked = latestPopupData(snapshot, traffic, 'GET_RANKED').pages.slice(0, 5);
  const recommendations = latestPopupData(snapshot, traffic, 'GET_RECOMMENDATIONS').recommendations.slice(0, 3);
  const cleanup = latestPopupData(snapshot, traffic, 'GET_CLEANUP');
  const rows = popup.getByTestId('home-ranked-list').getByTestId('home-ranked-item');
  await expect(rows, '[E6] 首页排序项数等于本轮实际响应前五项').toHaveCount(ranked.length);
  await expect(rows.getByTestId('ranked-item-url'), '[E6] 首页排序 URL 和顺序匹配本轮响应').toHaveText(ranked.map((page) => page.url));
  await expect(rows.getByTestId('ranked-item-title'), '[E6] 首页排序标题匹配本轮响应').toHaveText(ranked.map((page) => page.title));
  await expect(rows.getByTestId('ranked-item-score'), '[E6] 首页排序分数为响应的两位小数').toHaveText(ranked.map((page) => page.score.toFixed(2)));
  await expect(rows.getByTestId('ranked-item-reason'), '[E6] 首页排序理由匹配本轮响应').toHaveText(ranked.map((page) => page.reason));
  const recs = popup.getByTestId('rec-list').getByTestId('rec-item');
  await expect(recs, '[E6] 推荐项数等于本轮响应前三项').toHaveCount(recommendations.length);
  await expect(recs.getByTestId('rec-item-title'), '[E6] 推荐标题与顺序匹配本轮响应').toHaveText(recommendations.map((item) => item.title));
  await expect(recs.getByTestId('rec-item-score'), '[E6] 推荐分数为本轮响应的两位小数').toHaveText(recommendations.map((item) => item.score.toFixed(2)));
  await expect(recs.getByTestId('rec-item-reason'), '[E6] 推荐理由匹配本轮响应').toHaveText(recommendations.map((item) => item.reason));
  await expect(popup.getByTestId('home-cleanup-archive-count'), '[E6] 首页归档摘要匹配本轮响应').toHaveText(`归档 ${cleanup.summary.archive}`);
  await expect(popup.getByTestId('home-cleanup-merge-count'), '[E6] 首页重复摘要匹配本轮响应').toHaveText(`重复 ${cleanup.summary.merge}`);
  await expect(popup.getByTestId('home-cleanup-keep-count'), '[E6] 首页保留摘要匹配本轮响应').toHaveText(`保留 ${cleanup.summary.keep}`);
}

const sortedCleanup = (rows) => rows.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
async function cleanupProjection(popup) {
  const rows = popup.getByTestId('cleanup-item');
  const result = [];
  for (let index = 0; index < await rows.count(); index += 1) {
    const row = rows.nth(index);
    result.push({
      action: await row.getAttribute('data-action'),
      urls: (await row.getByTestId('cleanup-item-url').allInnerTexts()).flatMap((text) => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)).sort(),
      title: await row.getByTestId('cleanup-item-title').allInnerTexts(),
      reason: await row.getByTestId('cleanup-item-reason').allInnerTexts(),
    });
  }
  return sortedCleanup(result);
}

test('TC-UI-CACHE-005 真实离线后恢复自动同步精确一次，再次打开不重复同步', async ({ ext, api, evidence }) => {
  const traffic = observeBackend(ext, evidence);
  let popup;
  let baseline;
  let firstRecovery;
  let countBoundary;
  try {
    await ext.swEval(async (baseURL) => {
      await chrome.storage.local.clear();
      await chrome.history.deleteAll();
      await chrome.storage.local.set({ apiBaseUrl: baseURL, connection: { status: 'online', recoverPending: false } });
    }, ext.baseURL);
    await installMessageObserver(ext);
    const sample = await api.loadSample();
    expect(sample.res.status, '前置：旧页面经真实 /api/sync 成功导入').toBe(200);
    const previousPages = [...ext.context.pages()];
    await ext.mockSites({ [CURRENT_URL]: 'Docs recovery current page' });
    const [currentPage] = await ext.openTabs([CURRENT_URL]);
    await Promise.all(previousPages.map((page) => page.close()));
    await ext.swEval(() => chrome.history.deleteAll());
    await ext.seedHistory([CURRENT_URL]);
    await currentPage.bringToFront();
    expect(await ext.swEval(async () => (await chrome.tabs.query({ windowType: 'normal' }))
      .filter((tab) => /^https?:/.test(tab.url || '')).map((tab) => tab.url)), '前置：只有本例普通当前页').toEqual([CURRENT_URL]);
    popup = await ext.openPopup();
    await settlePopup(popup, ext, traffic, evidence, { cacheSince: 0, requireCaches: false, label: '首次打开，隔离初始请求' });
    const manualBoundary = traffic.mark('manual-setup-sync');
    await popup.getByTestId('sync-button').click();
    await expect(popup.getByTestId('sync-status'), '前置：在线手动同步成功').toHaveAttribute('data-status', 'success');
    const prepared = await settlePopup(popup, ext, traffic, evidence, { cacheSince: manualBoundary, label: '手动同步完成并写入五缓存 A' });
    expect(prepared.storage.syncState.status, '前置：手动同步真实落盘').toBe('success');
    const cacheA = structuredClone(prepared.storage.cache);
    expect(Object.values(cacheResponses(cacheA, traffic, manualBoundary)).map((entry) => entry?.status),
      '前置：五类缓存均逐项核对真实成功响应').toEqual([200, 200, 200, 200, 200]);
    await ext.snap(popup, '在线手动同步与五类缓存A');

    await test.step('S1：端口9真实失败并显示离线横幅，保存旧同步时间', async () => {
      await popup.close();
      const offlineBoundary = traffic.mark('real-offline');
      await ext.useUnreachableBackend();
      popup = await ext.reopenPopup();
      await expect(popup.getByTestId('offline-banner-home'), '前置：真实失败后离线横幅可见').toBeVisible();
      await expect.poll(async () => (await ext.getStorage('connection')).connection,
        { message: '前置：真实请求失败置位粘性恢复标记' }).toMatchObject({ status: 'offline', recoverPending: true });
      await settlePopup(popup, ext, traffic, evidence, { cacheSince: manualBoundary, label: '端口9全部失败请求与离线回退完成' });
      const failed = traffic.entries.filter((entry) => entry.sequence > offlineBoundary && entry.origin === UNREACHABLE_ORIGIN && entry.networkError);
      expect(failed.map((entry) => entry.networkError), '前置：捕获端口9的真实失败，不能手写 recoverPending 冒充离线').toEqual(expect.arrayContaining([expect.stringMatching(/ERR_/)]));
      expect((await ext.getStorage('cache')).cache, '前置：离线失败保留缓存 A').toEqual(cacheA);
      await ext.snap(popup, '真实离线横幅与恢复标记');
      await popup.close();
      await traffic.drain();
      const storage = await ext.getStorage(['syncState', 'connection']);
      const health = await api.get('/api/health');
      expect(health.status, '前置：从真实健康接口记录恢复前时间').toBe(200);
      expect(storage.syncState.lastSuccessAt, '前置：保存真实已成功同步时间').toBe(prepared.storage.syncState.lastSuccessAt);
      baseline = { lastSuccessAt: storage.syncState.lastSuccessAt, healthLastSyncAt: health.body.lastSyncAt };
      evidence.note(JSON.stringify({ event: 'offline-closed-baseline', ...baseline, connection: storage.connection, at: Date.now() }));
    });

    await test.step('S2：计数先于恢复base，重开后等待真实自动同步及全部刷新完成', async () => {
      countBoundary = traffic.beginRecovery();
      await ext.setApiBase(ext.baseURL);
      popup = await ext.reopenPopup();
      firstRecovery = await settlePopup(popup, ext, traffic, evidence, { cacheSince: countBoundary, label: '第一次恢复窗口：首页所有操作完成' });
      await expect(popup.getByTestId('sync-status'), '[E2] 自动恢复同步状态在界面成功').toHaveAttribute('data-status', 'success');
      expect(firstRecovery.storage.syncState.status, '[E2] 真实 storage 的同步状态成功').toBe('success');
      expect(firstRecovery.storage.syncState.trigger, '[E2] 同步由真实自动恢复触发').toBe('auto');
      expect(firstRecovery.storage.syncState.lastSuccessAt, '[E2] 自动成功时间严格晚于离线前').toBeGreaterThan(baseline.lastSuccessAt);
      expect(firstRecovery.storage.connection, '[E3] 恢复后在线且唯一恢复标记被清除').toMatchObject({ status: 'online', recoverPending: false });
      const recoverySucceeded = firstRecovery.snapshot.records.filter((record) => record.message?.type === 'RECOVER_IF_NEEDED')
        .some((record) => record.response?.ok && record.response.data?.resynced === true && record.response.data.reason === 'synced');
      expect(recoverySucceeded, '[E2] popup 收到真实恢复成功的完成响应').toBe(true);
      await ext.snap(popup, '第一次自动恢复同步成功');
    });

    await test.step('S3：核对health与三页展示，再重开并等待所有恢复刷新后精确计数', async () => {
      await expect(popup.getByTestId('offline-banner-home'), '[E5] 首页恢复后横幅消失').toBeHidden();
      await assertHome(popup, firstRecovery.snapshot, traffic);
      await ext.snap(popup, '恢复后的首页投影');
      await popup.getByTestId('tab-ranked').click();
      await expect(popup.getByTestId('tab-ranked'), '排序页选中').toHaveAttribute('aria-selected', 'true');
      const rankedSettled = await settlePopup(popup, ext, traffic, evidence, { cacheSince: countBoundary, label: '第一次恢复窗口：排序页懒加载结束' });
      await expect(popup.getByTestId('offline-banner-ranked'), '[E5] 排序页恢复后横幅消失').toBeHidden();
      const ranked = latestPopupData(rankedSettled.snapshot, traffic, 'GET_RANKED').pages;
      const rankedRows = popup.getByTestId('ranked-item');
      await expect(rankedRows, '[E6] 排序页完整项数匹配实际成功响应').toHaveCount(ranked.length);
      await expect(rankedRows.getByTestId('ranked-item-url'), '[E6] 排序页完整 URL 顺序匹配本轮响应').toHaveText(ranked.map((item) => item.url));
      await expect(rankedRows.getByTestId('ranked-item-title'), '[E6] 排序页完整标题匹配本轮响应').toHaveText(ranked.map((item) => item.title));
      await expect(rankedRows.getByTestId('ranked-item-score'), '[E6] 排序页完整两位分数匹配本轮响应').toHaveText(ranked.map((item) => item.score.toFixed(2)));
      await expect(rankedRows.getByTestId('ranked-item-reason'), '[E6] 排序页理由匹配本轮响应').toHaveText(ranked.map((item) => item.reason));
      await ext.snap(popup, '恢复后的排序页投影');
      await popup.getByTestId('tab-cleanup').click();
      await expect(popup.getByTestId('tab-cleanup'), '整理页选中').toHaveAttribute('aria-selected', 'true');
      const cleanupSettled = await settlePopup(popup, ext, traffic, evidence, { cacheSince: countBoundary, label: '第一次恢复窗口：整理页懒加载结束' });
      await expect(popup.getByTestId('offline-banner-cleanup'), '[E5] 整理页恢复后横幅消失').toBeHidden();
      const cleanup = latestPopupData(cleanupSettled.snapshot, traffic, 'GET_CLEANUP');
      const expectedCleanup = sortedCleanup(cleanup.suggestions.map((item) => ({
        action: item.action, urls: (item.action === 'merge' ? [...item.urls] : [item.url]).sort(), title: [item.title], reason: [item.reason],
      })));
      await expect.poll(() => cleanupProjection(popup), { message: '[E6] 整理页全部 URL/action、merge多行URL、标题与理由匹配本轮响应' }).toEqual(expectedCleanup);
      await ext.snap(popup, '恢复后的整理页投影');
      const firstEnd = await settlePopup(popup, ext, traffic, evidence, { cacheSince: countBoundary, label: '第一次恢复窗口最终边界' });
      expect(traffic.syncs(), '[E1] 全部恢复/刷新消息及在途请求结束后真实 POST /api/sync 恰好一次').toHaveLength(1);
      const [sync] = traffic.syncs();
      expect(sync.status, '[E4] 观察到的唯一同步是实际成功响应').toBe(200);
      const health = await api.get('/api/health');
      expect(health.status, '[E4] 真实 health 接口成功').toBe(200);
      expect(health.body.lastSyncAt, '[E4] health.lastSyncAt 等于唯一真实响应 syncedAt').toBe(sync.responseBody.syncedAt);
      expect(health.body.lastSyncAt, '[E4] health 同步时间晚于恢复前真实值').toBeGreaterThan(baseline.healthLastSyncAt);
      const recoveredAt = firstEnd.storage.syncState.lastSuccessAt;
      evidence.note(JSON.stringify({ event: 'first-recovery-window-end', syncSequences: traffic.syncs().map((entry) => entry.sequence), recoveredAt, syncedAt: sync.responseBody.syncedAt, health: health.body, at: Date.now() }));
      await popup.close();
      traffic.mark('recovery-second');
      popup = await ext.reopenPopup();
      const second = await settlePopup(popup, ext, traffic, evidence, { cacheSince: countBoundary, label: '第二次重开窗口：首页恢复与刷新全部结束' });
      await assertHome(popup, second.snapshot, traffic);
      // 再检查懒加载页，令第二个窗口的 cache-first 刷新同样进入同一个累计计数器。
      await popup.getByTestId('tab-ranked').click();
      await settlePopup(popup, ext, traffic, evidence, { cacheSince: countBoundary, label: '第二次重开窗口：排序页完成' });
      await popup.getByTestId('tab-cleanup').click();
      const secondEnd = await settlePopup(popup, ext, traffic, evidence, { cacheSince: countBoundary, label: '第二次重开窗口最终边界' });
      expect(secondEnd.snapshot.records.filter((record) => record.message?.type === 'RECOVER_IF_NEEDED')
        .every((record) => record.response?.ok && record.response.data?.resynced === false && record.response.data.reason === 'not-needed'),
      '[E7] 第二次实际恢复检查均已完成并确认不需要同步').toBe(true);
      expect(traffic.syncs(), '[E7] 第二次所有恢复/刷新消息和真实网络结束后累计 POST /api/sync 仍精确一次').toHaveLength(1);
      expect(secondEnd.storage.syncState.lastSuccessAt, '[E7] 第二次重开没有推进真实成功时间').toBe(recoveredAt);
      evidence.note(JSON.stringify({ event: 'second-recovery-window-end', syncSequences: traffic.syncs().map((entry) => entry.sequence), lastSuccessAt: secondEnd.storage.syncState.lastSuccessAt, at: Date.now() }));
      await ext.snap(popup, '第二次重开未重复同步');
    });
  } finally {
    try {
      if (popup && !popup.isClosed()) await popup.close();
      await traffic.close();
    } finally {
      await ext.swEval(async () => { await chrome.storage.local.clear(); await chrome.history.deleteAll(); });
      for (const page of ext.context.pages()) await page.close();
      // persistent context 的最终关闭由 ext/context 夹具负责。
    }
  }
});
