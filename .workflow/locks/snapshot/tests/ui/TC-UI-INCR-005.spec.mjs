import { test, expect, UNREACHABLE_BASE } from '../fixtures/extension.mjs';

// TC-UI-INCR-005（模块 INCR / F-INCR-01）：TDD 草稿，断言按 docs/07 用例 expected 完整表达，插件实现后由 UI 探索核实固化。
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
const B = 'https://example.com/retry';

test('TC-UI-INCR-005 增量时真实后端不可达：不推进游标，恢复后按原游标补传', async ({ ext, api, evidence }) => {
  const realBase = (await ext.getStorage(['apiBaseUrl'])).apiBaseUrl;
  const obs = observeSync(ext, evidence, [new URL(ext.baseURL).origin, new URL(UNREACHABLE_BASE).origin]);

  const s1 = await test.step('S1：只打开 A 并写历史，点击 sync-button 成功，记录 T / lastSuccessAt / cursorBase', async () => {
    await resetBrowserState(ext);
    await ext.mockSites({ [A]: 'Refactor auth middleware (#456)', [B]: 'Retry example' });
    await openOnly(ext, [A]);
    const popup = await ext.openPopup();
    expect(obs.posts, '前置：打开 popup 后没有自发 POST /api/sync').toHaveLength(0);
    const clickAt = Date.now();
    await popup.getByTestId('sync-button').click();
    await obs.waitPosts(1);
    const state = await waitSyncSettled(ext, clickAt);
    const health = await api.get('/api/health');
    expect(health.body.pageCount, '前置：首次同步后后端只有 A').toBe(1);
    await ext.snap(popup, '首次同步成功');
    evidence.note(`base0 syncState=${JSON.stringify(state)}`);
    return { popup, T: state.cursor, lastSuccessAt: state.lastSuccessAt, base0: state.cursorBase };
  });
  const { popup, T } = s1;

  const failAt = await test.step('S2：打开 B 并写历史，切到不可达地址后点击 sync-button，读取失败状态', async () => {
    await ext.openTabs([B]);
    await ext.seedHistory([B]);
    await ext.useUnreachableBackend();
    const clickAt = Date.now();
    await popup.getByTestId('sync-button').click();
    const state = await waitSyncSettled(ext, clickAt, 'error');
    await obs.settle();
    evidence.note(`失败后 syncState=${JSON.stringify(state)} 观察到的 POST=${JSON.stringify(obs.posts.map((p) => ({ url: p.url, status: p.status, errorText: p.errorText })))}`);
    await expect(popup.getByTestId('sync-status'), '[E1] sync-status.data-status = error').toHaveAttribute('data-status', 'error');
    await expect(popup.getByTestId('sync-status'), '[E1] 状态行包含「同步失败」').toContainText('同步失败');
    expect(state.lastError.code, '[E1] lastError.code = BACKEND_UNREACHABLE').toBe('BACKEND_UNREACHABLE');
    expect(state.lastError.message, '[E1] lastError.message 非空').toMatch(/\S/);
    await ext.snap(popup, '后端不可达同步失败');

    expect(state.cursor, '[E2] 失败后 cursor 仍为 T').toBe(T);
    expect(state.lastSuccessAt, '[E2] 失败后 lastSuccessAt 不变').toBe(s1.lastSuccessAt);
    expect(state.cursorBase, '[E2] 失败后 cursorBase 深度等于 base0').toEqual(s1.base0);
    const health = await api.get('/api/health');
    expect(health.body.pageCount, '[E2] 原后端 GET /api/health.pageCount = 1').toBe(1);
    return clickAt;
  });

  await test.step('S3：写回原地址，重新打开 popup，由 RECOVER_IF_NEEDED 自然补传，核对恢复结果', async () => {
    const before = obs.posts.length;
    await ext.setApiBase(realBase);
    const reopened = await ext.reopenPopup();
    await expect.poll(() => obs.posts.filter((p) => p.url.startsWith(realBase)).length,
      { message: '等待恢复产生真实 POST', timeout: 20000 }).toBeGreaterThanOrEqual(2);
    await obs.settle();
    const state = await waitSyncSettled(ext, failAt + 1);
    const recovery = obs.posts.slice(before).filter((p) => p.url.startsWith(realBase));
    evidence.note(`恢复批 POST=${JSON.stringify(recovery.map((p) => p.body))} syncState=${JSON.stringify(state)}`);

    expect(recovery, '[E3] 恢复只产生 1 次实际 POST').toHaveLength(1);
    const post = recovery[0];
    expect(post.body.mode, '[E3] 恢复 POST.mode = incremental').toBe('incremental');
    expect(post.body.cursor, '[E3] 恢复 POST.cursor = 原游标 T').toBe(T);
    expect(urlsOf(post.body.history), '[E3] history URL 集合包含 A/B').toEqual(expect.arrayContaining([A, B]));
    expect(post.body.history.filter((h) => h.lastVisitTime < T - OVERLAP_MS), '[E3] 所有 lastVisitTime >= T − 300000').toEqual([]);
    expect(urlsOf(post.body.openTabs), '[E3] openTabs URL 集合恰为 {A,B}').toEqual([A, B].sort());

    expect(post.status, '[E4] 恢复 POST 为 HTTP 200').toBe(200);
    const ranked = await api.get('/api/pages/ranked');
    expect(urlsOf(ranked.body.pages), '[E4] ranked URL 集合恰为 {A,B}').toEqual([A, B].sort());
    const health = await api.get('/api/health');
    expect(health.body.pageCount, '[E4] health.pageCount = 2').toBe(2);
    expect(state.cursor, '[E4] 新 cursor = 恢复批 startedAt').toBe(state.startedAt);
    expect(state.lastSuccessAt, '[E4] 新 lastSuccessAt = 恢复批 startedAt').toBe(state.startedAt);
    expect(state.cursor, '[E4] 新 cursor 大于 T').toBeGreaterThan(T);
    await expect(reopened.getByTestId('sync-status'), '[E4] sync-status.data-status = success').toHaveAttribute('data-status', 'success');
    await ext.snap(reopened, '恢复补传成功');
    obs.close();
  });
});
