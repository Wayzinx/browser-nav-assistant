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

const FRESH = 'https://example.org/fresh';
const BLOCKS = ['ranked', 'recommendations', 'cleanup'];
const rankedProjection = (body, limit = body.pages.length) => body.pages.slice(0, limit).map((page) => ({
  url: page.url, title: page.title || page.url, score: Number(page.score).toFixed(2),
}));
const recommendationProjection = (body) => body.recommendations.slice(0, 3).map((item) => ({
  title: item.title || item.url, score: Number(item.score).toFixed(2), reason: item.reason,
}));
const homeProjection = (bodies) => ({
  ranked: rankedProjection(bodies.ranked, 5),
  recommendations: recommendationProjection(bodies.recommendations),
  cleanup: { archive: bodies.cleanup.summary.archive, merge: bodies.cleanup.summary.merge, keep: bodies.cleanup.summary.keep },
});
const sortCleanup = (items) => [...items].sort((left, right) =>
  `${left.action}:${left.urls.join('\n')}`.localeCompare(`${right.action}:${right.urls.join('\n')}`));
const cleanupProjection = (body) => sortCleanup(body.suggestions.map((item) => ({
  action: item.action, urls: [...(item.action === 'merge' ? item.urls : [item.url])].sort(),
})));

function roundCacheData(observer, baseline) {
  return Object.fromEntries(FIVE.map((name) => [name, observer.latest(name)?.responseBody ?? cachedData(baseline)[name]]));
}

async function waitForCache(ext, observer, baseline) {
  const expected = roundCacheData(observer, baseline);
  await expect.poll(async () => cachedData((await ext.getStorage('cache')).cache),
    { message: '等待本次 popup 实际响应的完整 cache.data 落盘，包含动态时间' }).toEqual(expected);
  await observer.settle();
  return (await ext.getStorage('cache')).cache;
}

// Runs before popup.goto. This probe only reads registered data-testid elements and DOM state.
// It neither replaces application functions nor wraps messaging/fetch or modifies application DOM.
function installHomeProbe({ rankedCount, recommendationCount }) {
  const events = [];
  let sequence = 0;
  const last = new Map();
  const elements = (root, id) => [...root.getElementsByTagName('*')]
    .filter((element) => element.getAttribute('data-testid') === id);
  const visible = (element) => {
    let shown = Boolean(element?.isConnected && element.getClientRects().length);
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      shown = shown && !ancestor.hidden && ancestor.getAttribute('aria-hidden') !== 'true'
        && style.display !== 'none' && style.visibility !== 'hidden'
        && style.visibility !== 'collapse' && Number(style.opacity) !== 0;
    }
    return shown;
  };
  const idle = (element) => {
    let ready = true;
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
      ready = ready && ancestor.getAttribute('aria-busy') !== 'true';
    }
    return ready;
  };
  const field = (root, id) => {
    const nodes = elements(root, id).filter(visible);
    return { complete: nodes.length === 1 && idle(nodes[0]) && nodes[0].textContent.trim().length > 0,
      value: nodes.length === 1 ? nodes[0].textContent.trim() : null };
  };
  const isLoading = (id) => elements(document, id).some(visible);
  const list = (rootId, itemId, loadingId, expectedCount, fields) => {
    let projection = null;
    const roots = elements(document, rootId).filter(visible);
    if (roots.length === 1 && idle(roots[0]) && !isLoading(loadingId)) {
      const items = elements(roots[0], itemId).filter(visible);
      const values = items.map((item) => Object.fromEntries(fields.map(([key, id]) => [key, field(item, id)])));
      const complete = items.length === expectedCount && values.every((value) =>
        Object.values(value).every((part) => part.complete)
        && /^\d+\.\d{2}$/.test(value.score.value)
        && (!value.url || /^https?:\/\/\S+$/.test(value.url.value)));
      if (complete) projection = values.map((value) => Object.fromEntries(
        Object.entries(value).map(([key, part]) => [key, part.value])));
    }
    return projection;
  };
  const summary = () => {
    let projection = null;
    const roots = elements(document, 'home-cleanup-summary').filter(visible);
    if (roots.length === 1 && idle(roots[0]) && !isLoading('home-cleanup-loading')) {
      const fields = [
        ['archive', 'home-cleanup-archive-count', /^(?:归档\s*)?(\d+)$/],
        ['merge', 'home-cleanup-merge-count', /^(?:重复\s*)?(\d+)$/],
        ['keep', 'home-cleanup-keep-count', /^(?:保留\s*)?(\d+)$/],
      ].map(([key, id, pattern]) => { const part = field(roots[0], id); return { key, part, match: part.value?.match(pattern) }; });
      if (fields.every(({ part, match }) => part.complete && match)) {
        projection = Object.fromEntries(fields.map(({ key, match }) => [key, Number(match[1])]));
      }
    }
    return projection;
  };
  const record = (block, projection) => {
    if (projection !== null) {
      const signature = JSON.stringify(projection);
      if (last.get(block) !== signature) {
        events.push({ sequence: ++sequence, time: performance.now(), block, signature, projection });
        last.set(block, signature);
      }
    }
  };
  const scan = () => {
    record('ranked', list('home-ranked-list', 'home-ranked-item', 'home-ranked-loading', rankedCount, [
      ['url', 'ranked-item-url'], ['title', 'ranked-item-title'], ['score', 'ranked-item-score'],
    ]));
    record('recommendations', list('rec-list', 'rec-item', 'rec-loading', recommendationCount, [
      ['title', 'rec-item-title'], ['score', 'rec-item-score'], ['reason', 'rec-item-reason'],
    ]));
    record('cleanup', summary());
  };
  const observer = new MutationObserver(scan);
  observer.observe(document, { childList: true, subtree: true, characterData: true, attributes: true });
  globalThis.__cacheUiProbe = { events, observer };
  scan();
}

async function readCleanup(page) {
  const items = page.getByTestId('cleanup-item');
  const projection = [];
  for (let index = 0; index < await items.count(); index += 1) {
    const item = items.nth(index);
    const lines = await item.getByTestId('cleanup-item-url').allInnerTexts();
    projection.push({ action: await item.getAttribute('data-action'),
      urls: lines.flatMap((text) => text.split(/\r?\n/).map((url) => url.trim()).filter(Boolean)).sort() });
  }
  return sortCleanup(projection);
}

function assertCacheTimes(cache, A) {
  const actual = [cache.cachedAt, cache.ranked.cachedAt, cache.recommendations[DOCS].cachedAt,
    cache.cleanup.cachedAt, cache.rules.cachedAt, cache.config.cachedAt];
  const previous = [A.cachedAt, A.ranked.cachedAt, A.recommendations[DOCS].cachedAt,
    A.cleanup.cachedAt, A.rules.cachedAt, A.config.cachedAt];
  expect(actual.map((value) => Number.isInteger(value) && value > 0), '[E4] 所有最终缓存时间是正整数毫秒').toEqual(actual.map(() => true));
  for (let index = 0; index < actual.length; index += 1) {
    expect(actual[index], '[E4] 顶层与每一类 cachedAt 均不早于 A').toBeGreaterThanOrEqual(previous[index]);
  }
}

test('TC-UI-CACHE-002 有缓存时三个首页区块先显示 A，再显示本次真实刷新 B′', async ({ ext, api, evidence }) => {
  await prepare(ext, api);
  let preparation;
  let manual;
  let refresh;
  let popup;
  let A;
  let ADisplay;
  let BHome;
  let archivedUrl;
  let domSequence;
  try {
    // This test independently creates A by a real UI sync, including all five persisted result types.
    preparation = observeBackend(ext, evidence, 'initial');
    popup = await ext.openPopup();
    await expect(popup.getByTestId('current-page-url'), '前置：普通当前页始终不变').toHaveText(CURRENT);
    await preparation.waitFor(popup, ['ranked', 'recommendations', 'cleanup', 'config']);
    const initialData = preparation.bodies();
    await expect.poll(async () => {
      const data = cachedData((await ext.getStorage('cache')).cache);
      return { ranked: data.ranked, recommendations: data.recommendations, cleanup: data.cleanup, config: data.config };
    }, { message: '前置：首开全部后台响应已写入 storage 才开始准备 A' }).toEqual({
      ranked: initialData.ranked, recommendations: initialData.recommendations,
      cleanup: initialData.cleanup, config: initialData.config,
    });
    await preparation.close();
    preparation = null;
    manual = observeBackend(ext, evidence, 'prepare-A');
    await popup.getByTestId('sync-button').click();
    await expect(popup.getByTestId('sync-status'), '前置：真实同步准备 A 成功').toHaveAttribute('data-status', 'success');
    await manual.waitFor(popup, FIVE);
    await expect.poll(async () => cachedData((await ext.getStorage('cache')).cache),
      { message: '前置：A 五类缓存完整等于本例真实同步响应' }).toEqual(manual.bodies());
    A = (await ext.getStorage('cache')).cache;
    const recommendationRequest = JSON.parse(manual.latest('recommendations').requestBody);
    expect(withoutHash(recommendationRequest.currentPage.url), '前置：A 推荐 key 为普通当前 URL').toBe(DOCS);
    ADisplay = homeProjection(cachedData(A));
    expect(ADisplay.ranked, '前置：A 首页排序是完整 Top 5').toHaveLength(5);
    expect(ADisplay.recommendations, '前置：A 推荐非空且有完整 Top 3').toHaveLength(3);
    const archiveSuggestions = A.cleanup.data.suggestions.filter((item) => item.action === 'archive');
    expect(archiveSuggestions.length, '前置：A 含可归档的真实旧建议').toBeGreaterThan(0);
    archivedUrl = archiveSuggestions[0].url;
    await ext.snap(popup, '独立真实同步准备缓存A');
    await popup.close();
    await manual.close();
    manual = null;

    // Only real APIs modify the backend. Browser context and the recommendation key stay unchanged.
    const now = await ext.swEval(() => Date.now());
    await api.seed({ activeTab: { url: CURRENT, title: 'Docs current' }, openTabs: [{ url: CURRENT, title: 'Docs current' }],
      history: [{ url: FRESH, title: 'Fresh B', lastVisitTime: now, visitCount: 100 }], mode: 'incremental' });
    const archived = await api.post('/api/pages/archive', { urls: [archivedUrl] }, { setup: true });
    expect(archived.status, '前置：真实归档 A 的一条旧建议成功').toBe(200);
    expect(archived.body, '前置：真实归档恰好影响一个已存在页面').toMatchObject({ ok: true, affected: 1, notFound: 0 });
    const [rankedB, recommendationsB, cleanupB] = await Promise.all([
      api.get('/api/pages/ranked', { params: { limit: 50 }, setup: true }),
      api.post('/api/recommendations/next', recommendationRequest, { setup: true }),
      api.get('/api/pages/cleanup-suggestions', { setup: true }),
    ]);
    expect([rankedB.status, recommendationsB.status, cleanupB.status], '前置：预读 B 的三个业务接口均成功').toEqual([200, 200, 200]);
    const preview = homeProjection({ ranked: rankedB.body, recommendations: recommendationsB.body, cleanup: cleanupB.body });
    expect(preview.ranked, '前置：B 排序有完整 Top 5').toHaveLength(5);
    expect(preview.recommendations, '前置：B 推荐非空且有完整 Top 3').toHaveLength(3);
    for (const block of BLOCKS) expect(preview[block], '前置：A/B 三类首页业务投影必须各自不同').not.toEqual(ADisplay[block]);
    expect(rankedB.body.pages.find((item) => item.url === FRESH), '前置：新增页高频、标题正确且未打开').toMatchObject({ title: 'Fresh B', visitCount: 100, isOpen: false });
    expect(cleanupB.body.suggestions.flatMap((item) => item.urls || [item.url]), '前置：被归档旧建议已离开 B').not.toContain(archivedUrl);
    expect((await ext.getStorage('cache')).cache, '前置：真实 API 预读不能改动本地 A').toEqual(A);
    expect((await ext.getStorage('connection')).connection, '前置：在线且没有自动恢复标记').toMatchObject({ status: 'online', recoverPending: false });
    evidence.note(`A cache: ${JSON.stringify(A)}`);
    evidence.note(`pre-read B business projections only: ${JSON.stringify(preview)}`);

    await test.step('S1：popup.goto 之前安装只读 MutationObserver，逐块记录完整非 loading 业务快照', async () => {
      popup = await ext.context.newPage();
      ext.popup = popup;
      await popup.addInitScript(installHomeProbe, { rankedCount: 5, recommendationCount: 3 });
      // The request ledger begins before navigation; it sees the real service-worker requests.
      refresh = observeBackend(ext, evidence, 'popup-refresh');
    });

    await test.step('S2：打开首页保存各区块第一条完整 A，以及本轮实际刷新响应 B′ 和后续 DOM 顺序', async () => {
      await popup.goto(ext.popupUrl);
      await refresh.waitFor(popup, ['ranked', 'recommendations', 'cleanup', 'config']);
      await waitForCache(ext, refresh, A);
      BHome = homeProjection(refresh.bodies());
      for (const block of BLOCKS) expect(BHome[block], '前置：本轮真实 B′ 的三个业务投影仍分别与 A 不同').not.toEqual(ADisplay[block]);
      await expect.poll(async () => popup.evaluate((expected) => Object.fromEntries(
        Object.keys(expected).map((block) => [block, globalThis.__cacheUiProbe.events.some((event) =>
          event.block === block && event.signature === JSON.stringify(expected[block]))])), BHome),
      { message: '等待三个首页区块各自出现本轮实际 B′，不拿预读时间字段固定期望' }).toEqual({ ranked: true, recommendations: true, cleanup: true });
      domSequence = await popup.evaluate(() => globalThis.__cacheUiProbe.events);
      evidence.note(`home ordered DOM snapshots: ${JSON.stringify(domSequence)}`);
      for (const block of BLOCKS) {
        const blockEvents = domSequence.filter((event) => event.block === block);
        expect(blockEvents.length, '[E1] 每块都记录到首次完整数据和后续刷新变化').toBeGreaterThan(1);
        expect(blockEvents[0].projection, '[E1] 每个区块第一条完整非 loading 数据恰好为 A，拒绝先 B′ 再 A').toEqual(ADisplay[block]);
        const refreshed = blockEvents.filter((event) => event.signature === JSON.stringify(BHome[block]));
        expect(refreshed.length, '[E1] A 之后至少出现一次对应本轮实际 B′ 签名').toBeGreaterThan(0);
        expect(blockEvents[0].sequence, '[E1] 各块 A 的记录序号严格小于实际 B′').toBeLessThan(refreshed[0].sequence);
        expect(blockEvents[0].time, '[E1] 各块 A 的 performance.now 不晚于实际 B′').toBeLessThanOrEqual(refreshed[0].time);
      }
      for (let index = 1; index < domSequence.length; index += 1) {
        expect(domSequence[index].sequence, '[E1] 所有 DOM 记录按严格递增序号留痕').toBeGreaterThan(domSequence[index - 1].sequence);
        expect(domSequence[index].time, '[E1] DOM performance.now 按同一时钟单调记录').toBeGreaterThanOrEqual(domSequence[index - 1].time);
      }
      await ext.snap(popup, '缓存A后收到真实B撇的首页');
    });

    await test.step('S3：检查最新完整排序与整理 URL/action，最终缓存深度对应本轮实际响应并保存有序 DOM 序列', async () => {
      await popup.getByTestId('tab-ranked').click();
      await popup.waitForLoadState('networkidle');
      await refresh.settle();
      const ranked = rankedProjection(refresh.latest('ranked').responseBody);
      const rankedItems = popup.getByTestId('ranked-item');
      await expect(rankedItems, '[E2] 排序页展示本轮完整列表').toHaveCount(ranked.length);
      await expect(rankedItems.getByTestId('ranked-item-url'), '[E2] 排序页完整 URL 顺序等于本轮实际 B′').toHaveText(ranked.map((item) => item.url));
      await expect(rankedItems.getByTestId('ranked-item-title'), '[E2] 排序页所有标题等于实际 B′').toHaveText(ranked.map((item) => item.title));
      await expect(rankedItems.getByTestId('ranked-item-score'), '[E2] 排序页所有分数保留两位小数并等于实际 B′').toHaveText(ranked.map((item) => item.score));
      expect(ranked.find((item) => item.url === FRESH), '[E2] 排序包含 Fresh B 的新 URL 与标题').toMatchObject({ url: FRESH, title: 'Fresh B' });
      await ext.snap(popup, '真实B撇完整排序');

      await popup.getByTestId('tab-cleanup').click();
      await popup.waitForLoadState('networkidle');
      await refresh.settle();
      const expectedCleanup = cleanupProjection(refresh.latest('cleanup').responseBody);
      await expect(popup.getByTestId('cleanup-item'), '[E3] 整理页展示所有实际建议项').toHaveCount(expectedCleanup.length);
      await expect.poll(() => readCleanup(popup), { message: '等待整理 URL/action 集合完整显示' }).toEqual(expectedCleanup);
      const actualCleanup = await readCleanup(popup);
      expect(actualCleanup, '[E3] 整理页 URL/action 集合逐项等于本轮实际 B′，merge 保留组内所有 URL').toEqual(expectedCleanup);
      expect(actualCleanup.flatMap((item) => item.urls), '[E3] 被归档的 A 旧建议 URL 不再出现').not.toContain(archivedUrl);
      await ext.snap(popup, '真实B撇整理建议');

      domSequence = await popup.evaluate(() => globalThis.__cacheUiProbe.events);
      evidence.note(`final ordered DOM snapshots: ${JSON.stringify(domSequence)}`);
      // End the source window, then settle every pending response and its final storage write.
      await popup.close();
      await refresh.settle();
      const cache = await waitForCache(ext, refresh, A);
      const refreshedRecommendationKeys = refresh.rows.filter((row) => row.type === 'recommendations')
        .map((row) => withoutHash(JSON.parse(row.requestBody).currentPage.url));
      expect(refreshedRecommendationKeys, '[E4] 本轮推荐仍以同一普通当前 URL 为 key').toEqual(refreshedRecommendationKeys.map(() => DOCS));
      expect(cachedData(cache), '[E4] 每类更新后的 data 深度等于本轮对应最后实际响应，含 generatedAt/createdAt；未刷新类保留 A').toEqual(roundCacheData(refresh, A));
      assertCacheTimes(cache, A);
      evidence.note(`popup final cache: ${JSON.stringify(cache)}`);
      evidence.note(`popup actual B′ bodies: ${JSON.stringify(refresh.bodies())}`);
      expect(refresh.rows.map((row) => row.origin), '[E5] 观察区间每次真实 API 响应均来自测试后端').toEqual(refresh.rows.map(() => new URL(ext.baseURL).origin));
      const syncRequests = refresh.rows.filter((row) => row.origin === new URL(ext.baseURL).origin
        && row.method === 'POST' && row.path === '/api/sync');
      expect(syncRequests, '[E5] 新 popup 刷新区间真实 POST /api/sync 精确为零').toHaveLength(0);
    });
  } finally {
    if (preparation) await preparation.close();
    if (manual) await manual.close();
    if (refresh) await refresh.close();
    await Promise.all(ext.context.pages().map((page) => page.close()));
  }
});
