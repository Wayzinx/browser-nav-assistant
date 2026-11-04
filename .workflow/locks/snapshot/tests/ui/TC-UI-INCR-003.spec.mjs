import { test, expect } from '../fixtures/extension.mjs';

// TC-UI-INCR-003（模块 INCR / F-INCR-01）：TDD 草稿，断言按 docs/07 用例 expected 完整表达，插件实现后由 UI 探索核实固化。
// ---- 本例内联取证工具（每个 INCR 脚本各自携带，不依赖其他用例或新夹具能力）----
// TDD 草稿：只观察真实插件与真实后端（SW 发出的 POST /api/sync），不 route 后端、不替换浏览器 API / 业务模块。
const DAY = 24 * 60 * 60 * 1000;
const LOOKBACK_MS = 30 * DAY; // 2592000000：historyLookbackDays=30
const OVERLAP_MS = 5 * 60 * 1000; // 300000：增量重叠窗口
const STATE_KEYS = ['syncState', 'cache', 'connection'];

/** 清空浏览历史与 syncState / cache / connection，保留 apiBaseUrl */
async function resetBrowserState(ext) {
  await ext.swEval(async (keys) => {
    await chrome.history.deleteAll();
    await chrome.storage.local.remove(keys);
  }, STATE_KEYS);
  expect(await ext.getStorage(STATE_KEYS), '前置：storage 中没有 syncState / cache / connection').toEqual({});
}

/** 读取浏览器真实历史（http(s)），按 lastVisitTime 升序 */
async function readBrowserHistory(ext) {
  const items = await ext.swEval(() => chrome.history.search({ text: '', startTime: 0, maxResults: 500 }));
  return items.filter((h) => /^https?:/.test(h.url || '')).sort((a, b) => a.lastVisitTime - b.lastVisitTime);
}

/** 只保留本例指定的普通标签页（最后一个为活动页），并用 chrome.history.addUrl 写当前访问 */
async function openOnly(ext, urls) {
  const previous = [...ext.context.pages()];
  const pages = await ext.openTabs(urls);
  await ext.seedHistory(urls);
  await Promise.all(previous.map((p) => p.close()));
  await pages.at(-1).bringToFront();
  await expect.poll(async () => (await readBrowserHistory(ext)).map((h) => h.url).sort(),
    { message: '前置：浏览器 http(s) 历史恰为本例 URL' }).toEqual([...urls].sort());
  await expect.poll(async () => (await ext.swEval(() => chrome.tabs.query({ windowType: 'normal' })))
    .map((t) => t.url).filter((u) => /^https?:/.test(u || '')).sort(),
  { message: '前置：普通窗口只有本例页面' }).toEqual([...urls].sort());
  return pages;
}

/** 读取 SW 日志环形缓冲中 [from, to] 区间内 event=history.query 的实际查询参数 */
async function historyQueriesBetween(ext, from, to) {
  const logs = await ext.swEval(() => (globalThis.__navLogs || []).filter((l) => l && l.event === 'history.query'));
  // logger（C-FE-CORE-05）条目为 { ts: ISO 字符串, event, details: { startTime, maxResults } }
  return logs
    .map((l) => ({ ...l, ts: typeof l.ts === "string" ? Date.parse(l.ts) : l.ts }))
    .filter((l) => l.ts >= from && l.ts <= to)
    .map((l) => ({ ts: l.ts, startTime: l.details?.startTime ?? l.startTime ?? l.historyQuery?.startTime, maxResults: l.details?.maxResults ?? l.maxResults ?? l.historyQuery?.maxResults }));
}

/** 等待 storage.syncState 进入终态（success / error）且 startedAt 不早于 since */
async function waitSyncSettled(ext, since, status = 'success') {
  await expect.poll(async () => {
    const { syncState } = await ext.getStorage(['syncState']);
    return syncState && syncState.startedAt >= since ? syncState.status : 'pending';
  }, { message: `等待 syncState 变为 ${status}`, timeout: 20000 }).toBe(status);
  return (await ext.getStorage(['syncState'])).syncState;
}

/**
 * 只读观察 SW 发往目标后端的 POST /api/sync：记录真实请求体、响应状态 / 体与 requestfailed，写入 evidence.recordApi。
 * 事件回调只收集；异步错误由 settle() 统一重新抛出，不吞异常。
 */
function observeSync(ext, evidence, origins = [new URL(ext.baseURL).origin]) {
  const posts = [];
  const tasks = [];
  const inFlight = new Set();
  const byRequest = new Map();
  let seq = 0;
  const isSync = (req) => Boolean(req.serviceWorker()) && req.method() === 'POST'
    && origins.includes(new URL(req.url()).origin) && new URL(req.url()).pathname === '/api/sync';
  const collect = (p) => tasks.push(p.then((value) => ({ value }), (error) => ({ error })));
  const onRequest = (req) => collect((async () => {
    const hit = isSync(req);
    const entry = hit ? { seq: ++seq, url: req.url(), sentAt: Date.now(), body: req.postDataJSON(), status: null, response: null, errorText: null } : null;
    posts.push(...(hit ? [entry] : []));
    hit && byRequest.set(req, entry);
    hit && inFlight.add(req);
  })());
  const onResponse = (res) => collect((async () => {
    const entry = byRequest.get(res.request());
    const body = entry ? await res.json() : null;
    entry && Object.assign(entry, { status: res.status(), response: body });
    entry && evidence.recordApi({
      reqId: `${evidence.caseId}-sw-sync-${entry.seq}`, setup: false, observed: true, method: 'POST', url: entry.url,
      requestHeaders: res.request().headers(), requestBody: entry.body, status: entry.status,
      responseHeaders: res.headers(), responseBody: body, ms: Date.now() - entry.sentAt,
    });
  })());
  const onDone = (req) => { inFlight.delete(req); };
  const onFailed = (req) => collect((async () => {
    inFlight.delete(req);
    const entry = byRequest.get(req);
    entry && Object.assign(entry, { errorText: req.failure()?.errorText || 'failed' });
    entry && evidence.note(`SW POST /api/sync 真实连接失败（无 HTTP 状态码）：${JSON.stringify({ url: entry.url, errorText: entry.errorText })}`);
  })());
  ext.context.on('request', onRequest);
  ext.context.on('response', onResponse);
  ext.context.on('requestfinished', onDone);
  ext.context.on('requestfailed', onFailed);
  async function drain() {
    let consumed = 0;
    const errors = [];
    while (consumed < tasks.length) {
      const end = tasks.length;
      const settled = await Promise.all(tasks.slice(consumed, end));
      consumed = end;
      errors.push(...settled.filter((x) => Object.hasOwn(x, 'error')).map((x) => x.error));
    }
    expect(errors, 'SW 网络取证本身没有出错').toEqual([]);
  }
  return {
    posts,
    async waitPosts(n) {
      await expect.poll(() => posts.length, { message: `等待第 ${n} 次真实 POST /api/sync`, timeout: 20000 }).toBeGreaterThanOrEqual(n);
      await expect.poll(() => inFlight.size, { message: '等待已发出的 SW 同步请求结束' }).toBe(0);
      await drain();
      return posts[n - 1];
    },
    async settle() {
      await expect.poll(() => inFlight.size, { message: '等待已发出的 SW 同步请求结束' }).toBe(0);
      await drain();
    },
    close() {
      ext.context.off('request', onRequest);
      ext.context.off('response', onResponse);
      ext.context.off('requestfinished', onDone);
      ext.context.off('requestfailed', onFailed);
    },
  };
}

const urlsOf = (list) => (list || []).map((x) => x.url).sort();
// ---- 内联取证工具结束 ----

const HISTORY_URLS = Array.from({ length: 101 }, (_, i) => `https://example.com/h/${String(i + 1).padStart(3, '0')}`);
const NEWEST_100 = HISTORY_URLS.slice(1);

test('TC-UI-INCR-003 首次全量有101条浏览器历史：只上传最新100条并省略cursor', async ({ ext, api, evidence }) => {
  const browserHistory = await test.step('S1：只保留系统页，用 addUrl 逐条写 /001..101 并确认 lastVisitTime 严格递增', async () => {
    await resetBrowserState(ext);
    const httpTabs = await ext.swEval(async () => (await chrome.tabs.query({})).filter((t) => /^https?:/.test(t.url || '')).length);
    expect(httpTabs, '前置：没有 http(s) 标签页').toBe(0);
    // 逐条写入；同毫秒时等待到下一毫秒再写下一条，保证 lastVisitTime 严格递增
    await ext.swEval(async (urls) => {
      let prev = 0;
      for (const url of urls) {
        while (Date.now() <= prev) await new Promise((r) => setTimeout(r, 1));
        await chrome.history.addUrl({ url });
        const visits = await chrome.history.getVisits({ url });
        prev = Math.max(...visits.map((v) => v.visitTime));
      }
    }, HISTORY_URLS);
    const items = await readBrowserHistory(ext);
    expect(items.map((h) => h.url), '前置：共 101 条，按构造顺序排列').toEqual(HISTORY_URLS);
    expect(items.filter((h, i) => i > 0 && h.lastVisitTime <= items[i - 1].lastVisitTime), '前置：lastVisitTime 严格递增').toEqual([]);
    return new Map(items.map((h) => [h.url, h.lastVisitTime]));
  });

  let popup;
  let obs;
  const run = await test.step('S2：打开 popup，记录 t0 后点击 sync-button，记录 t1 与本批 history.query', async () => {
    popup = await ext.openPopup();
    obs = observeSync(ext, evidence);
    expect(obs.posts, '前置：打开 popup 后没有自发 POST /api/sync').toHaveLength(0);
    await ext.snap(popup, '打开popup');
    const t0 = Date.now();
    await popup.getByTestId('sync-button').click();
    const post = await obs.waitPosts(1);
    const state = await waitSyncSettled(ext, t0);
    const queries = await historyQueriesBetween(ext, t0, post.sentAt);
    evidence.note(`t0=${t0} t1=${post.sentAt} history.query=${JSON.stringify(queries)} syncState=${JSON.stringify(state)}`);
    return { t0, t1: post.sentAt, post, queries };
  });

  await test.step('S3：读取实际 POST.history、syncState、sync-uploaded-count 与真实 health', async () => {
    const { t0, t1, post, queries } = run;
    expect(post.body.mode, '[E1] 首次实际 POST.mode = full').toBe('full');
    expect(Object.hasOwn(post.body, 'cursor'), '[E1] 首次 POST 不含 cursor').toBe(false);
    expect(post.body.activeTab, '[E1] activeTab = null').toBeNull();
    expect(post.body.openTabs, '[E1] openTabs = []').toEqual([]);

    expect(queries, '[E2] 本批同步只采集一次历史').toHaveLength(1);
    expect(queries[0].maxResults, '[E2] history.query.maxResults = 100').toBe(100);
    expect(queries[0].startTime, '[E2] startTime >= t0 − 30 天').toBeGreaterThanOrEqual(t0 - LOOKBACK_MS);
    expect(queries[0].startTime, '[E2] startTime <= t1 − 30 天').toBeLessThanOrEqual(t1 - LOOKBACK_MS);

    expect(post.body.history, '[E3] POST.history.length = 100').toHaveLength(100);
    expect(urlsOf(post.body.history), '[E3] URL 集合恰为 /002..101').toEqual([...NEWEST_100].sort());
    expect(urlsOf(post.body.history), '[E3] 不包含最旧的 /001').not.toContain(HISTORY_URLS[0]);
    expect(post.body.history.filter((h) => h.lastVisitTime !== browserHistory.get(h.url)), '[E3] 每条 lastVisitTime 都等于真实浏览器记录').toEqual([]);
    expect(post.body.history.filter((h) => h.lastVisitTime < t0 - LOOKBACK_MS), '[E3] 每条都在 30 天范围内').toEqual([]);

    expect(post.status, '[E4] HTTP 200').toBe(200);
    expect(post.response.received, '[E4] received = 100').toBe(100);
    expect(post.response.created, '[E4] created = 100').toBe(100);
    expect(post.response.pageCount, '[E4] pageCount = 100').toBe(100);
    const health = await api.get('/api/health');
    expect(health.body.pageCount, '[E4] GET /api/health.pageCount = 100').toBe(100);
    await expect(popup.getByTestId('sync-uploaded-count'), '[E4] sync-uploaded-count = "100"').toHaveText('100');
    await ext.snap(popup, '首次全量同步成功');
    obs.close();
  });
});
