import { test, expect } from '../fixtures/extension.mjs';

// TC-UI-INCR-007（模块 INCR / F-INCR-01）：TDD 草稿，断言按 docs/07 用例 expected 完整表达，插件实现后由 UI 探索核实固化。
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

const A = 'https://github.com/org/repo/pull/456';
const B = 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API';

test('TC-UI-INCR-007 后端真实reset但本地仍有游标：server_empty触发全量恢复', async ({ ext, api, evidence }) => {
  const popup = await test.step('S1：离线登记 A/B，打开 A、B（B 最后活动）并写入历史，打开 popup', async () => {
    await resetBrowserState(ext);
    await ext.mockSites({ [A]: 'Refactor auth middleware (#456)', [B]: 'Fetch API - Web APIs | MDN' });
    await openOnly(ext, [A, B]);
    const page = await ext.openPopup();
    await expect(page.getByTestId('current-page-url'), '前置：当前页面排除插件自身，回退到 B').toHaveText(B);
    await ext.snap(page, '打开popup');
    return page;
  });
  const obs = observeSync(ext, evidence);

  const T = await test.step('S2：点击 sync-button 成功并记录 T，随后真实 reset 后端', async () => {
    expect(obs.posts, '前置：打开 popup 后没有自发 POST /api/sync').toHaveLength(0);
    const clickAt = Date.now();
    await popup.getByTestId('sync-button').click();
    await obs.waitPosts(1);
    const state = await waitSyncSettled(ext, clickAt);
    await obs.settle();
    await api.reset();
    const health = await api.get('/api/health');
    expect(health.body.pageCount, '前置：reset 后 pageCount = 0').toBe(0);
    expect(health.body.lastSyncAt, '前置：reset 后 lastSyncAt = null').toBeNull();
    const after = (await ext.getStorage(['syncState'])).syncState;
    expect(after.cursor, '[E1] reset 后本地 cursor 仍为 T').toBe(state.cursor);
    evidence.note(`reset 前 syncState=${JSON.stringify(state)}`);
    return state.cursor;
  });

  await test.step('S3：在同一 popup 点击 sync-button，记录实际 POST、历史窗口、fullReason，并核对 health / ranked', async () => {
    const t0 = Date.now();
    await popup.getByTestId('sync-button').click();
    const post = await obs.waitPosts(2);
    const t1 = post.sentAt;
    const state = await waitSyncSettled(ext, t0);
    const queries = await historyQueriesBetween(ext, t0, t1);
    evidence.note(`t0=${t0} t1=${t1} history.query=${JSON.stringify(queries)} syncState=${JSON.stringify(state)}`);

    expect(post.body.mode, '[E1] 恢复 POST.mode = full').toBe('full');
    expect(Object.hasOwn(post.body, 'cursor'), '[E1] 恢复 POST 省略 cursor').toBe(false);
    expect(state.fullReason, '[E1] fullReason = server_empty').toBe('server_empty');

    expect(queries, '[E2] 恢复批只采集一次历史').toHaveLength(1);
    expect(queries[0].maxResults, '[E2] maxResults = 100').toBe(100);
    expect(queries[0].startTime, '[E2] startTime >= t0 − 30 天').toBeGreaterThanOrEqual(t0 - LOOKBACK_MS);
    expect(queries[0].startTime, '[E2] startTime <= t1 − 30 天').toBeLessThanOrEqual(t1 - LOOKBACK_MS);
    expect(urlsOf(post.body.history), '[E2] 请求 history URL 集合恰为 {A,B}').toEqual([A, B].sort());

    expect(post.status, '[E3] 恢复 POST HTTP 200').toBe(200);
    expect(post.response.created, '[E3] created = 2').toBe(2);
    expect(post.response.pageCount, '[E3] pageCount = 2').toBe(2);
    const ranked = await api.get('/api/pages/ranked');
    expect(urlsOf(ranked.body.pages), '[E3] GET /api/pages/ranked URL 集合恰为 {A,B}').toEqual([A, B].sort());
    const health = await api.get('/api/health');
    expect(health.body.pageCount, '[E3] GET /api/health.pageCount = 2').toBe(2);

    await expect(popup.getByTestId('sync-status'), '[E4] sync-status.data-status = success').toHaveAttribute('data-status', 'success');
    expect(state.cursor, '[E4] cursor = 恢复批 startedAt').toBe(state.startedAt);
    expect(state.cursor, '[E4] 不再保留失效旧游标 T').not.toBe(T);
    await ext.snap(popup, 'server_empty全量恢复成功');
    obs.close();
  });
});
