import { test, expect } from '../fixtures/extension.mjs';

// TC-UI-INCR-004（模块 INCR / F-INCR-01）：TDD 草稿，断言按 docs/07 用例 expected 完整表达，插件实现后由 UI 探索核实固化。
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
    .map((l) => ({ ...l, ts: typeof l.ts === 'string' ? Date.parse(l.ts) : l.ts }))
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

const M = 'https://example.com/window-marker';
const SENTINEL = 'https://example.com/server-sentinel';

/** 写入完整 success 状态的 syncState：未来游标是显式测试输入（持久态夹具），不伪造历史访问时间 */
function successState(cursor, base) {
  return {
    status: 'success', startedAt: cursor, lastSyncAt: cursor, lastSuccessAt: cursor, lastError: null,
    cursor, cursorBase: base, fullReason: null, mode: 'incremental', trigger: 'manual',
    stats: { uploaded: 0, filtered: 0, received: 0, created: 0, updated: 0, rejected: 0 },
  };
}

test('TC-UI-INCR-004 以真实历史时间夹住增量窗口：5分钟前后1分钟分别纳入和排除同一记录', async ({ ext, api, evidence }) => {
  const ctx = await test.step('S1：真实 POST 导入 sentinel；只保留系统页，addUrl M 并读取真实 H；打开 popup', async () => {
    await api.seed({ activeTab: null, openTabs: [], history: [{ url: SENTINEL, lastVisitTime: Date.now(), visitCount: 1 }] });
    await resetBrowserState(ext);
    const httpTabs = await ext.swEval(async () => (await chrome.tabs.query({})).filter((t) => /^https?:/.test(t.url || '')).length);
    expect(httpTabs, '前置：没有 http(s) 标签页').toBe(0);
    await ext.seedHistory([M]);
    const items = await readBrowserHistory(ext);
    expect(items.map((h) => h.url), '前置：http(s) 历史只有 M').toEqual([M]);
    const H = items[0].lastVisitTime;
    const health = await api.get('/api/health');
    expect(health.body.pageCount, '前置：后端只有 sentinel').toBe(1);
    const { apiBaseUrl } = await ext.getStorage(['apiBaseUrl']);
    const base = { apiBaseUrl, serverStartedAt: health.body.startedAt };
    const popup = await ext.openPopup();
    const obs = observeSync(ext, evidence);
    await ext.snap(popup, '打开popup');
    evidence.note(`H=${H} base=${JSON.stringify(base)}`);
    return { H, base, popup, obs, T_in: H + 240000, T_out: H + 360000 };
  });
  const { H, base, popup, obs, T_in, T_out } = ctx;

  const branchA = await test.step('S2：写入 cursor=T_in 的完整 success 状态，点击 sync-button', async () => {
    expect(obs.posts, '前置：打开 popup 后没有自发 POST /api/sync').toHaveLength(0);
    await ext.setStorage({ syncState: successState(T_in, base) });
    const clickAt = Date.now();
    await popup.getByTestId('sync-button').click();
    const post = await obs.waitPosts(1);
    await waitSyncSettled(ext, clickAt);
    const queries = await historyQueriesBetween(ext, clickAt, post.sentAt);
    evidence.note(`分支A history.query=${JSON.stringify(queries)}`);
    expect(post.body.mode, '[E1] 分支A POST.mode = incremental').toBe('incremental');
    expect(post.body.cursor, '[E1] 分支A POST.cursor = T_in').toBe(T_in);
    expect(queries, '[E1] 分支A 只采集一次历史').toHaveLength(1);
    expect(queries[0].startTime, '[E1] 分支A startTime = T_in − 300000 = H − 60000').toBe(H - 60000);
    expect(urlsOf(post.body.history), '[E1] 分支A history URL 集合恰为 {M}').toEqual([M]);
    await ext.snap(popup, '分支A同步成功');
    return post;
  });

  await test.step('S3：只把 cursor / lastSuccessAt 改为 T_out，再次点击 sync-button 并核对两分支服务端结果', async () => {
    await ext.setStorage({ syncState: successState(T_out, base) });
    const clickAt = Date.now();
    await popup.getByTestId('sync-button').click();
    const post = await obs.waitPosts(2);
    await waitSyncSettled(ext, clickAt);
    const queries = await historyQueriesBetween(ext, clickAt, post.sentAt);
    evidence.note(`分支B history.query=${JSON.stringify(queries)}`);
    expect(post.body.mode, '[E2] 分支B POST.mode = incremental').toBe('incremental');
    expect(post.body.cursor, '[E2] 分支B POST.cursor = T_out').toBe(T_out);
    expect(queries, '[E2] 分支B 只采集一次历史').toHaveLength(1);
    expect(queries[0].startTime, '[E2] 分支B startTime = T_out − 300000 = H + 60000').toBe(H + 60000);
    expect(post.body.history, '[E2] 分支B history = []').toEqual([]);

    for (const p of [branchA, post]) {
      expect(p.body.openTabs, '[E3] 实际 openTabs = []').toEqual([]);
      expect(p.body.activeTab, '[E3] 实际 activeTab = null').toBeNull();
      expect(urlsOf(p.body.history), '[E3] 请求 history 不含只存在于后端的 sentinel').not.toContain(SENTINEL);
    }

    expect(branchA.status, '[E4] 分支A HTTP 200').toBe(200);
    expect(branchA.response.created, '[E4] 分支A created = 1').toBe(1);
    expect(branchA.response.pageCount, '[E4] 分支A pageCount = 2').toBe(2);
    expect(post.status, '[E4] 分支B HTTP 200').toBe(200);
    expect(post.response.received, '[E4] 分支B received = 0').toBe(0);
    expect(post.response.created, '[E4] 分支B created = 0').toBe(0);
    expect(post.response.pageCount, '[E4] 分支B pageCount = 2').toBe(2);
    const health = await api.get('/api/health');
    expect(health.body.pageCount, '[E4] 最终 GET /api/health.pageCount = 2').toBe(2);
    await ext.snap(popup, '分支B同步成功');
    obs.close();
  });
});
