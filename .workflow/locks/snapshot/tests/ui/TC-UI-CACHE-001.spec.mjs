import { test, expect } from '../fixtures/extension.mjs';

const DOCS = 'https://example.com/docs';
const CURRENT = DOCS;
const NEW_HISTORY = 'https://example.com/cache-one-history';
const TYPES = {
  'GET /api/pages/ranked': 'ranked',
  'POST /api/recommendations/next': 'recommendations',
  'GET /api/pages/cleanup-suggestions': 'cleanup',
  'GET /api/rules': 'rules',
  'GET /api/config': 'config',
};
const FIVE = ['ranked', 'recommendations', 'cleanup', 'rules', 'config'];

const withoutHash = (value) => { const url = new URL(value); url.hash = ''; return url.href; };
const cachedData = (cache) => ({
  ranked: cache?.ranked?.data,
  recommendations: cache?.recommendations?.[DOCS]?.data,
  cleanup: cache?.cleanup?.data,
  rules: cache?.rules?.data,
  config: cache?.config?.data,
});

// Passive BrowserContext observation: requests keep their original destination, body and timing.
// Both transport termination and every response JSON promise are settled explicitly.
function observeBackend(ext, evidence, phase) {
  const origin = new URL(ext.baseURL).origin;
  const rows = [];
  const byRequest = new Map();
  const active = new Set();
  const parsing = [];
  let sequence = 0;
  const onRequest = (request) => {
    const url = new URL(request.url());
    if (request.serviceWorker() && /^https?:$/.test(url.protocol) && url.pathname.startsWith('/api/')) {
      const row = {
        sequence: ++sequence, phase, method: request.method(), url: request.url(), origin: url.origin,
        path: url.pathname, query: [...url.searchParams], startedAt: Date.now(),
        requestHeaders: request.headers(), requestBody: request.postData(),
        type: url.origin === origin ? TYPES[`${request.method()} ${url.pathname}`] || null : null,
        transport: 'pending', parsed: false,
      };
      rows.push(row);
      byRequest.set(request, row);
      active.add(request);
    }
  };
  const onResponse = (response) => {
    const row = byRequest.get(response.request());
    if (row) {
      row.status = response.status();
      row.responseHeaders = response.headers();
      const task = response.text().then((body) => {
        row.responseBody = JSON.parse(body);
        row.parsed = true;
      });
      // A rejection is retained as data until settle asserts it, never silently discarded.
      parsing.push(task.then(() => ({ status: 'fulfilled' }), (error) => {
        row.parseError = String(error);
        return { status: 'rejected', reason: String(error) };
      }));
    }
  };
  const onFinished = (request) => {
    const row = byRequest.get(request);
    if (row) { row.transport = 'finished'; row.endedAt = Date.now(); active.delete(request); }
  };
  const onFailed = (request) => {
    const row = byRequest.get(request);
    if (row) {
      row.transport = 'failed'; row.failure = request.failure()?.errorText || 'requestfailed';
      row.endedAt = Date.now(); active.delete(request);
    }
  };
  ext.context.on('request', onRequest);
  ext.context.on('response', onResponse);
  ext.context.on('requestfinished', onFinished);
  ext.context.on('requestfailed', onFailed);
  const latest = (name) => rows.filter((row) => {
    const params = new URLSearchParams(row.query);
    const defaultRanked = params.get('limit') === '50' && !params.get('domain') && params.get('openOnly') !== 'true';
    return row.type === name && row.parsed && row.status === 200 && (name !== 'ranked' || defaultRanked);
  }).at(-1);
  async function settle() {
    await expect.poll(() => active.size, { message: `${phase}：等待全部真实请求结束` }).toBe(0);
    let consumed = 0;
    const outcomes = [];
    while (consumed < parsing.length) {
      const end = parsing.length;
      outcomes.push(...await Promise.all(parsing.slice(consumed, end)));
      consumed = end;
    }
    for (const row of rows.filter((item) => !item.persisted)) {
      evidence.recordApi({
        reqId: `${evidence.caseId}-${phase}-sw-${row.sequence}`, observed: true, setup: phase === 'initial',
        method: row.method, url: row.url, requestHeaders: row.requestHeaders, requestBody: row.requestBody,
        status: row.status ?? null, responseHeaders: row.responseHeaders ?? {},
        responseBody: row.responseBody ?? { failure: row.failure, parseError: row.parseError },
        transport: row.transport, ms: (row.endedAt || Date.now()) - row.startedAt,
      });
      row.persisted = true;
    }
    evidence.note(`${phase} ordered network: ${JSON.stringify(rows)}`);
    expect(outcomes.filter((item) => item.status === 'rejected'), `${phase}：每个响应都成功解析为 JSON`).toEqual([]);
    expect(rows.filter((row) => row.transport !== 'finished'), `${phase}：没有未完成或失败请求`).toEqual([]);
    expect(rows.map((row) => row.origin), `${phase}：真实 API 请求只指向测试后端`).toEqual(rows.map(() => origin));
    expect(rows.map((row) => row.status), `${phase}：每次实际响应均成功`).toEqual(rows.map(() => 200));
  }
  async function waitFor(popup, names) {
    await expect.poll(() => names.filter((name) => latest(name)),
      { message: `${phase}：等待各类真实响应，不能用单个 HTTP 200 代替` }).toEqual(names);
    await popup.waitForLoadState('networkidle');
    await settle();
  }
  async function close() {
    try { await settle(); }
    finally {
      ext.context.off('request', onRequest);
      ext.context.off('response', onResponse);
      ext.context.off('requestfinished', onFinished);
      ext.context.off('requestfailed', onFailed);
    }
  }
  return { rows, latest, settle, waitFor, close,
    bodies: () => Object.fromEntries(FIVE.map((name) => [name, latest(name)?.responseBody])) };
}

async function prepare(ext, api) {
  await ext.swEval(async (base) => {
    await chrome.storage.local.clear();
    await chrome.history.deleteAll();
    const now = Date.now();
    await chrome.storage.local.set({ apiBaseUrl: base,
      connection: { status: 'online', recoverPending: false, since: now, lastCheckedAt: now, lastErrorCode: null } });
  }, ext.baseURL);
  await api.loadSample({ now: await ext.swEval(() => Date.now()) });
  const previous = [...ext.context.pages()];
  await ext.mockSites({ [CURRENT]: 'Docs current' });
  const [docs] = await ext.openTabs([CURRENT]);
  await Promise.all(previous.map((page) => page.close()));
  await ext.swEval(async (url) => { await chrome.history.deleteAll(); await chrome.history.addUrl({ url }); }, NEW_HISTORY);
  await docs.bringToFront();
  const tabs = await ext.swEval(() => chrome.tabs.query({ windowType: 'normal' }));
  expect(tabs.filter((tab) => /^https?:/.test(tab.url || '')).map((tab) => tab.url),
    '前置：仅保留本例 docs 普通当前页').toEqual([CURRENT]);
  expect((await ext.swEval(() => chrome.history.search({ text: '', startTime: 0 }))).map((item) => item.url),
    '前置：打开页面后清历史，仅新增本例当前时间的历史').toEqual([NEW_HISTORY]);
  return docs;
}

test('TC-UI-CACHE-001 同步成功后五类真实响应及时间完整写入本地缓存', async ({ ext, api, evidence }) => {
  await prepare(ext, api);
  let popup;
  let initial;
  let round;
  let cache;
  let responses;
  let T0;
  let T1;
  try {
    // First-open traffic finishes before the manual-sync observation interval starts.
    initial = observeBackend(ext, evidence, 'initial');
    popup = await ext.openPopup();
    await expect(popup.getByTestId('current-page-url'), '前置：当前普通 URL 为本例固定 docs').toHaveText(CURRENT);
    await initial.waitFor(popup, ['ranked', 'recommendations', 'cleanup', 'config']);
    const initialData = initial.bodies();
    await expect.poll(async () => {
      const data = cachedData((await ext.getStorage('cache')).cache);
      return { ranked: data.ranked, recommendations: data.recommendations, cleanup: data.cleanup, config: data.config };
    }, { message: '前置：首开后台刷新已经写入 storage' }).toEqual({
      ranked: initialData.ranked, recommendations: initialData.recommendations,
      cleanup: initialData.cleanup, config: initialData.config,
    });
    await initial.close();
    initial = null;

    await test.step('S1：点击前被动记录真实响应，手动同步并等待全部刷新落盘，记录同一浏览器时钟 T0/T1', async () => {
      round = observeBackend(ext, evidence, 'manual-sync');
      T0 = await ext.swEval(() => Date.now());
      await popup.getByTestId('sync-button').click();
      await expect(popup.getByTestId('sync-status'), '[E5] 手动同步状态为 success').toHaveAttribute('data-status', 'success');
      await round.waitFor(popup, FIVE);
      expect(round.rows.filter((row) => row.origin === new URL(ext.baseURL).origin
        && row.method === 'POST' && row.path === '/api/sync'), '前置：本轮只有一次真实手动同步').toHaveLength(1);
      responses = round.bodies();
      await expect.poll(async () => cachedData((await ext.getStorage('cache')).cache),
        { message: '五类 cache.data 等待本轮真实响应全部落盘' }).toEqual(responses);
      await round.settle();
      cache = (await ext.getStorage('cache')).cache;
      T1 = await ext.swEval(() => Date.now());
      evidence.note(`browser-clock manual interval: ${JSON.stringify({ T0, T1 })}`);
      await ext.snap(popup, '手动同步全部落盘');
    });

    await test.step('S2：读取真实 chrome.storage.local.cache，逐项核对本轮五类响应和全部缓存时间', async () => {
      expect(Object.keys(cache).sort(), '[E1] cache 同时具有五类结果与顶层 cachedAt').toEqual([...FIVE, 'cachedAt'].sort());
      for (const name of ['ranked', 'cleanup', 'rules', 'config']) {
        expect(Object.keys(cache[name]).sort(), '[E1] 每个普通缓存项恰有 data 与 cachedAt').toEqual(['cachedAt', 'data']);
      }
      expect(Object.keys(cache.recommendations), '[E2] recommendations 为按规范化当前 URL 建索引的 map').toEqual([DOCS]);
      expect(Object.keys(cache.recommendations[DOCS]).sort(), '[E2] 去 hash URL 对应 data/cachedAt 缓存项').toEqual(['cachedAt', 'data']);
      expect(round.rows.filter((row) => row.type === 'recommendations').map((row) => withoutHash(JSON.parse(row.requestBody).currentPage.url)),
        '[E2] 本轮真实推荐请求的普通当前 URL 规范化后就是缓存 key').toEqual(
        round.rows.filter((row) => row.type === 'recommendations').map(() => DOCS));
      expect(cachedData(cache), '[E3] 五类 data 深度等于本轮真实成功响应体，包含全部时间字段').toEqual(responses);
      expect(Array.isArray(cache.ranked.data.pages), '[E3] ranked.data.pages 是数组').toBe(true);
      expect(Array.isArray(cache.cleanup.data.suggestions), '[E3] cleanup.data.suggestions 是数组').toBe(true);
      expect(cache.rules.data.rules, '[E3] reset 后规则缓存为空数组').toEqual([]);
      const stamps = [cache.cachedAt, cache.ranked.cachedAt, cache.recommendations[DOCS].cachedAt,
        cache.cleanup.cachedAt, cache.rules.cachedAt, cache.config.cachedAt];
      expect(stamps.map((value) => Number.isInteger(value) && value > 0), '[E4] 所有缓存时间都是正整数毫秒').toEqual(stamps.map(() => true));
      for (const value of stamps) {
        expect(value, '[E4] 所有缓存时间不早于点击前浏览器 T0').toBeGreaterThanOrEqual(T0);
        expect(value, '[E4] 所有缓存时间不晚于刷新后浏览器 T1').toBeLessThanOrEqual(T1);
      }
      await expect(popup.getByTestId('sync-status'), '[E5] 读取缓存后同步状态仍为 success').toHaveAttribute('data-status', 'success');
      evidence.note(`manual-sync final cache: ${JSON.stringify(cache)}`);
      await ext.snap(popup, '五类缓存与真实响应一致');
    });
  } finally {
    if (initial) await initial.close();
    if (round) await round.close();
    await Promise.all(ext.context.pages().map((page) => page.close()));
  }
});
