import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test as baseTest, expect } from '../fixtures/extension.mjs';
import { ROOT } from '../fixtures/evidence.mjs';

// 前置（用例要求本例独立准备）：临时持久化 profile → chrome://extensions 开启「允许在无痕模式下运行」→ 关闭并重启同一 profile。
// Chrome 内部设置只用于环境准备；产品断言仍只用 ui-contract testId。其余与通用夹具一致（本例外站 example.com 离线化、日志取证），不 route 后端。
const EXT_DIR = process.env.EXT_DIR ? path.resolve(ROOT, process.env.EXT_DIR) : path.join(ROOT, 'extension');
const LAUNCH_ARGS = [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`];
const stubPage = (title) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1></body></html>`;
const launchProfile = (chromium, dir) => chromium.launchPersistentContext(dir, {
  channel: 'chromium', headless: true, viewport: { width: 420, height: 760 }, args: LAUNCH_ARGS,
});
async function firstWorker(context) {
  const [worker] = context.serviceWorkers();
  return worker || context.waitForEvent('serviceworker');
}
async function allowIncognitoInProfile(chromium, dir) {
  const context = await launchProfile(chromium, dir);
  try {
    const extensionId = new URL((await firstWorker(context)).url()).host;
    const page = await context.newPage();
    await page.goto('chrome://extensions/?id=' + extensionId);
    const toggleState = () => page.evaluate(() => {
      const detail = document.querySelector('extensions-manager')?.shadowRoot?.querySelector('extensions-detail-view');
      const toggle = detail?.shadowRoot?.querySelector('#allow-incognito')?.shadowRoot?.querySelector('cr-toggle');
      return toggle ? Boolean(toggle.checked) : null;
    });
    await expect.poll(toggleState, { message: '[BLOCKED] 环境准备：找到「允许在无痕模式下运行」开关' }).not.toBeNull();
    if (!(await toggleState())) {
      await page.evaluate(() => document.querySelector('extensions-manager').shadowRoot.querySelector('extensions-detail-view')
        .shadowRoot.querySelector('#allow-incognito').shadowRoot.querySelector('cr-toggle').click());
    }
    await expect.poll(toggleState, { message: '[BLOCKED] 环境准备：无痕开关已开启' }).toBe(true);
  } finally {
    await context.close();
  }
}

const test = baseTest.extend({
  context: async ({ evidence, playwright }, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'priv-incognito-'));
    try {
      await allowIncognitoInProfile(playwright.chromium, dir);
      const context = await launchProfile(playwright.chromium, dir);
      // 本例外站只有 example.com：整站离线化（后端请求不进入此 route）
      await context.route('https://example.com/**', (route) =>
        route.fulfill({ contentType: 'text/html; charset=utf-8', body: stubPage(new URL(route.request().url()).hostname) }));
      const watchWorker = (w) => w.on('console', (m) => evidence.extLog('service-worker', m));
      context.serviceWorkers().forEach(watchWorker);
      context.on('serviceworker', watchWorker);
      context.on('page', (p) => {
        p.on('console', (m) => evidence.extLog(p.url().startsWith('chrome-extension://') ? 'popup' : 'page', m));
        p.on('pageerror', (e) => evidence.extLog('pageerror', e));
      });
      try {
        await use(context);
      } finally {
        await context.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
});

// TDD 草稿：只操作真实 Chromium、插件消息和后端；网络事件仅用于被动取证。
async function preparePages(ext, urls, { backend = ext.baseURL, history = [] } = {}) {
  const previousPages = [...ext.context.pages()];
  await ext.swEval(async () => {
    await chrome.storage.local.clear();
    await chrome.history.deleteAll();
  });
  await ext.setStorage({
    apiBaseUrl: backend,
    connection: { status: 'online', recoverPending: false, since: Date.now(), lastCheckedAt: null, lastErrorCode: null },
  });
  await ext.mockSites(Object.fromEntries(urls.map((url, index) => [url, '合成测试页 ' + (index + 1)])));
  const pages = await ext.openTabs(urls);
  for (const page of previousPages) await page.close();
  await pages.at(-1).bringToFront();
  await ext.swEval(() => chrome.history.deleteAll());
  await ext.seedHistory(history);
  await expect.poll(() => ext.swEval(async () =>
    (await chrome.tabs.query({ active: true, lastFocusedWindow: true })).map((tab) => tab.url)),
  { message: '前置：最后打开的普通页是当前活动页' }).toEqual([urls.at(-1)]);
  const tabs = await ext.swEval(() => chrome.tabs.query({ windowType: 'normal' }));
  expect(tabs.filter((tab) => !tab.incognito).map((tab) => tab.url).sort(), '前置：仅保留本例普通标签').toEqual([...urls].sort());
  await expect.poll(() => ext.swEval(async () =>
    (await chrome.history.search({ text: '', startTime: 0, maxResults: 1000 })).map((item) => item.url).sort()),
  { message: '前置：真实历史与声明的数据一致' }).toEqual([...history].sort());
  return pages;
}

async function readContext(popup, evidence) {
  const reply = await popup.evaluate(() => chrome.runtime.sendMessage({
    type: 'GET_CONTEXT', payload: {}, requestId: 'priv-context-' + Date.now(),
  }));
  expect(reply.ok, '前置：真实 GET_CONTEXT 消息成功').toBe(true);
  // 只记录来源和计数；敏感 URL 不写入日志。
  evidence.note('GET_CONTEXT ' + JSON.stringify({
    privacy: reply.data.privacy, tabs: reply.data.tabs.length, history: reply.data.history.length,
  }));
  return reply.data;
}

async function openContext(ext, observer) {
  const popup = await ext.openPopup();
  await expect(popup.getByTestId('sync-button'), '前置：同步按钮可用').toBeEnabled();
  await popup.getByTestId('tab-context').click();
  await expect(popup.getByTestId('context-loading'), '前置：上下文加载结束').toBeHidden();
  await expect(popup.getByTestId('context-privacy-keywords'), '前置：关键词来源可读').toBeVisible();
  await observer.settle();
  return popup;
}

function tabItem(popup, url) {
  return popup.getByTestId('context-tabs-list').getByTestId('context-tab-item')
    .filter({ has: popup.getByTestId('context-tab-url').filter({ hasText: url }) });
}

function observeBackend(ext, evidence, sensitiveUrls = []) {
  const origins = new Set([new URL(ext.baseURL).origin, 'http://127.0.0.1:9']);
  const requests = [];
  const byRequest = new Map();
  const active = new Set();
  const jobs = [];
  let sequence = 0;
  function redact(value) {
    let result = value;
    if (typeof value === 'string') {
      for (const url of sensitiveUrls) result = result.replaceAll(url, '[redacted-url]');
    } else if (Array.isArray(value)) {
      result = value.map(redact);
    } else if (value && typeof value === 'object') {
      result = Object.fromEntries(Object.entries(value).map(([key, item]) => [redact(key), redact(item)]));
    }
    return result;
  }
  const tracked = (request) => Boolean(request.serviceWorker())
    && origins.has(new URL(request.url()).origin) && new URL(request.url()).pathname.startsWith('/api/');
  const collect = (job) => jobs.push(job.then((value) => ({ value }), (error) => ({ error })));
  const record = (entry, responseBody, status, responseHeaders = {}) => evidence.recordApi({
    reqId: evidence.caseId + '-sw-' + entry.sequence, observed: true, setup: false,
    method: entry.method, url: entry.url, requestHeaders: redact(entry.request.headers()),
    requestBody: redact(entry.body), status, responseHeaders: redact(responseHeaders),
    responseBody: redact(responseBody), ms: Date.now() - entry.startedAt,
  });
  const onRequest = (request) => collect((async () => {
    if (tracked(request)) {
      const entry = { request, sequence: ++sequence, startedAt: Date.now(), method: request.method(),
        url: request.url(), path: new URL(request.url()).pathname, body: request.postDataJSON(), response: null, failure: null };
      requests.push(entry);
      byRequest.set(request, entry);
      active.add(request);
    }
  })());
  const onResponse = (response) => collect((async () => {
    if (byRequest.has(response.request())) {
      const entry = byRequest.get(response.request());
      const body = await response.json();
      entry.response = { status: response.status(), body };
      record(entry, body, response.status(), response.headers());
    }
  })());
  const onFinished = (request) => active.delete(request);
  const onFailed = (request) => collect((async () => {
    active.delete(request);
    if (byRequest.has(request)) {
      const entry = byRequest.get(request);
      entry.failure = request.failure()?.errorText;
      // 连接失败没有 HTTP 状态码；保留实际失败信息，不伪造响应。
      record(entry, { networkError: entry.failure }, null);
    }
  })());
  ext.context.on('request', onRequest);
  ext.context.on('response', onResponse);
  ext.context.on('requestfinished', onFinished);
  ext.context.on('requestfailed', onFailed);
  async function drain() {
    let consumed = 0;
    const errors = [];
    while (consumed < jobs.length) {
      const end = jobs.length;
      const settled = await Promise.all(jobs.slice(consumed, end));
      consumed = end;
      errors.push(...settled.filter((item) => Object.hasOwn(item, 'error')).map((item) => item.error));
    }
    if (errors.length) throw new AggregateError(errors, '真实 SW 请求取证失败');
  }
  async function settle() {
    await expect.poll(() => active.size, { message: '等待已发出的 SW 请求结束' }).toBe(0);
    await drain();
  }
  async function close() {
    try {
      await settle();
    } finally {
      ext.context.off('request', onRequest);
      ext.context.off('response', onResponse);
      ext.context.off('requestfinished', onFinished);
      ext.context.off('requestfailed', onFailed);
    }
  }
  const since = (mark, path) => requests.slice(mark).filter((entry) => entry.method === 'POST' && entry.path === path);
  return { requests, since, settle, close };
}

// blockedBy：本例 context 夹具已在临时 profile 中经 chrome://extensions 开启无痕授权并重启同一 profile；
// 若授权或真实无痕 target 离线路由任一未就绪，下列前置断言失败即为 BLOCKED，不得 skip 计 PASS。
export const blockedBy = [
  '真实无痕测试需先在 chrome://extensions 开启允许在无痕模式下运行，并重启同一临时 profile；现有 extension.mjs 未提供此准备能力。',
  '真实无痕 target 必须能够通过 CDP 仅离线化外站导航；无法发现或连接该 target 时必须 BLOCKED。',
];

async function requireIncognito(ext, evidence, testInfo) {
  const allowed = await ext.swEval(() => new Promise((resolve) => chrome.extension.isAllowedIncognitoAccess(resolve)));
  evidence.note('真实无痕授权核验：' + allowed);
  if (!allowed) {
    testInfo.annotations.push({ type: 'blockedBy', description: blockedBy[0] });
    evidence.note('[BLOCKED] ' + blockedBy[0]);
  }
  expect(allowed, '[BLOCKED] 前置：真实插件已获无痕访问权限，不能以普通上下文替代').toBe(true);
}

// Target/Fetch 只离线化此用例的合成外站；不接触后端请求，不替换 Chrome API。
async function routePrivateTarget(ext, ordinaryPage, privateUrl, evidence) {
  const cdp = await ext.context.newCDPSession(ordinaryPage);
  let sessionId;
  let ready = false;
  let nextId = 0;
  let fulfilled = 0;
  const pending = new Map();
  const jobs = [];
  const collect = (job) => jobs.push(job.then((value) => ({ value }), (error) => ({ error })));
  async function drain() {
    let consumed = 0;
    const errors = [];
    while (consumed < jobs.length) {
      const end = jobs.length;
      const settled = await Promise.all(jobs.slice(consumed, end));
      consumed = end;
      errors.push(...settled.filter((item) => Object.hasOwn(item, 'error')).map((item) => item.error));
    }
    if (errors.length) throw new AggregateError(errors, '[BLOCKED] 无痕外站离线路由取证失败');
  }
  async function command(method, params = {}) {
    const id = ++nextId;
    const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
      .then((value) => ({ value }), (error) => ({ error }));
    await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) });
    const settled = await response;
    if (Object.hasOwn(settled, 'error')) throw settled.error;
    return settled.value;
  }
  const onMessage = (event) => collect((async () => {
    if (event.sessionId === sessionId) {
      const packet = JSON.parse(event.message);
      if (packet.id && pending.has(packet.id)) {
        const operation = pending.get(packet.id);
        pending.delete(packet.id);
        if (packet.error) operation.reject(new Error('[BLOCKED] CDP：' + packet.error.message));
        else operation.resolve(packet.result);
      } else if (packet.method === 'Fetch.requestPaused') {
        expect(packet.params.request.url, '[BLOCKED] 前置：路由仅命中本例合成外站').toBe(privateUrl);
        await command('Fetch.fulfillRequest', {
          requestId: packet.params.requestId, responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
          body: Buffer.from('<!doctype html><html><head><title>合成私密页</title></head><body>private fixture</body></html>').toString('base64'),
        });
        fulfilled += 1;
        evidence.note('真实无痕外站已离线化：host=' + new URL(privateUrl).host);
      }
    }
  })());
  async function close() {
    try {
      await drain();
    } finally {
      cdp.off('Target.receivedMessageFromTarget', onMessage);
      try {
        if (sessionId) await cdp.send('Target.detachFromTarget', { sessionId });
      } finally {
        await cdp.detach();
      }
    }
  }
  try {
    await expect.poll(async () => (await cdp.send('Target.getTargets')).targetInfos.filter((target) => target.type === 'page' && target.url === 'about:blank').length,
      { message: '[BLOCKED] 前置：必须发现唯一真实无痕 about:blank target' }).toBe(1);
    const targets = (await cdp.send('Target.getTargets')).targetInfos.filter((target) => target.type === 'page' && target.url === 'about:blank');
    expect(targets, '[BLOCKED] 前置：仅有本例无痕空白 target').toHaveLength(1);
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId: targets[0].targetId, flatten: false }));
    cdp.on('Target.receivedMessageFromTarget', onMessage);
    await command('Fetch.enable', { patterns: [{ urlPattern: privateUrl, requestStage: 'Request' }] });
    ready = true;
    return {
      async waitForNavigation() {
        await expect.poll(async () => { await drain(); return fulfilled; },
          { message: '[BLOCKED] 前置：真实无痕导航必须完成外站离线路由' }).toBe(1);
        await drain();
      },
      close,
    };
  } finally {
    if (!ready) await close();
  }
}

async function verifyPrivateTab(ext, windowId, privateUrl, evidence) {
  await expect.poll(() => ext.swEval(async (id) => (await chrome.tabs.query({ windowId: id })).map((tab) =>
    ({ url: tab.url, incognito: tab.incognito, status: tab.status })), windowId),
  { message: '[BLOCKED] 前置：真实无痕标签完成导航，且 incognito 为 true' }).toEqual([{ url: privateUrl, incognito: true, status: 'complete' }]);
  const tabs = await ext.swEval((id) => chrome.tabs.query({ windowId: id }), windowId);
  expect(tabs.map((tab) => ({ url: tab.url, incognito: tab.incognito })), '[BLOCKED] 前置：真实无痕窗口内仅有指定私密标签').toEqual([{ url: privateUrl, incognito: true }]);
  evidence.note('真实无痕窗口存在：' + JSON.stringify({ windowId, tabId: tabs[0].id, incognito: tabs[0].incognito }));
}

async function focusOrdinary(ext, ordinaryPage) {
  const tabs = await ext.swEval(() => chrome.tabs.query({ windowType: 'normal' }));
  const ordinary = tabs.filter((tab) => !tab.incognito && tab.url === ordinaryPage.url());
  expect(ordinary, '前置：普通对照页唯一').toHaveLength(1);
  await ext.swEval(async (tab) => {
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tab.id, { active: true });
  }, ordinary[0]);
  await ordinaryPage.bringToFront();
  await ext.swEval(() => chrome.history.deleteAll());
  const history = await ext.swEval(() => chrome.history.search({ text: '', startTime: 0, maxResults: 1000 }));
  expect(history.map((item) => item.url), '前置：普通历史为空且没有私密 URL').toEqual([]);
}

const PRIVATE = 'https://example.com/private';
const DOCS = 'https://example.com/docs';

test('TC-UI-PRIV-010 关闭关键词过滤的配置边界：真实无痕 URL 仍不会上传', async ({ ext, api, evidence }, testInfo) => {
  let observer;
  let popup;
  let ordinaryPage;
  let privateWindow;
  let privateRoute;
  try {
    await test.step('S1：真实关闭关键词过滤，独立构造普通页与真实无痕页', async () => {
      const updated = await api.put('/api/config', { enablePrivacyFilter: false });
      expect(updated.status, '前置：配置修改成功').toBe(200);
      const config = await api.get('/api/config');
      expect(config.status, '前置：真实配置可读').toBe(200);
      expect(config.body.enablePrivacyFilter, '前置：后端关键词过滤关闭').toBe(false);
      [ordinaryPage] = await preparePages(ext, [DOCS]);
      await requireIncognito(ext, evidence, testInfo);
      // headless 下 windows.update({focused}) 无法把焦点移回普通窗口；无痕窗口以 focused:false 创建，保证普通窗口是最后聚焦窗口（与用户从普通窗口点开 popup 一致）
      privateWindow = await ext.swEval(() => chrome.windows.create({ incognito: true, url: 'about:blank', focused: false }));
      expect(privateWindow.incognito, '[BLOCKED] 前置：创建真实无痕窗口').toBe(true);
      const privateTabs = await ext.swEval((id) => chrome.tabs.query({ windowId: id }), privateWindow.id);
      expect(privateTabs, '[BLOCKED] 前置：无痕窗口只有本例空白标签').toHaveLength(1);
      // 等待无痕空白页初始加载完成后再挂离线路由并导航，避免初始 about:blank 提交与 tabs.update 竞争导致导航被吞（实测 status=unloaded）
      await expect.poll(() => ext.swEval(async (id) => (await chrome.tabs.query({ windowId: id })).map((tab) => ({ url: tab.url, status: tab.status })), privateWindow.id),
        { message: '[BLOCKED] 前置：无痕空白标签初始加载完成' }).toEqual([{ url: 'about:blank', status: 'complete' }]);
      privateRoute = await routePrivateTarget(ext, ordinaryPage, PRIVATE, evidence);
      await ext.swEval(({ tabId, url }) => chrome.tabs.update(tabId, { url }), { tabId: privateTabs[0].id, url: PRIVATE });
      await privateRoute.waitForNavigation();
      await verifyPrivateTab(ext, privateWindow.id, PRIVATE, evidence);
      await focusOrdinary(ext, ordinaryPage);
      observer = observeBackend(ext, evidence, [PRIVATE]);
      await ext.snap(ordinaryPage, '关键词过滤关闭但真实无痕存在');
    });
    await test.step('S2：普通上下文和同步仍排除无痕，真实 ranked 不入库私密 URL', async () => {
      popup = await openContext(ext, observer);
      const context = await readContext(popup, evidence);
      expect(context.privacy.enabled, '[E1] GET_CONTEXT 反映关键词过滤关闭').toBe(false);
      await expect.poll(async () => (await popup.getByTestId('context-tabs-list').getByTestId('context-tab-url').allTextContents()).sort(), { message: '等待普通上下文仅有 docs' }).toEqual([DOCS]);
      const urls = await popup.getByTestId('context-tabs-list').getByTestId('context-tab-url').allTextContents();
      expect(urls, '[E1] enabled=false 时上下文仍只含普通 docs').toEqual([DOCS]);
      expect(urls.filter((url) => url === PRIVATE).length, '[E1] private 出现次数为零').toBe(0);
      await verifyPrivateTab(ext, privateWindow.id, PRIVATE, evidence);
      await observer.settle();
      const mark = observer.requests.length;
      await popup.getByTestId('sync-button').click();
      await expect(popup.getByTestId('sync-status'), '[E3] 同步成功').toHaveAttribute('data-status', 'success');
      await observer.settle();
      const syncs = observer.since(mark, '/api/sync');
      expect(syncs, '[E2] 恰好一次真实 POST /api/sync').toHaveLength(1);
      const sync = syncs[0];
      expect(sync.body.activeTab.url, '[E2] activeTab 为普通 docs').toBe(DOCS);
      expect(sync.body.openTabs.map((tab) => tab.url), '[E2] openTabs 仅有普通 docs').toEqual([DOCS]);
      expect(sync.body.history, '[E2] 历史为空').toEqual([]);
      expect(JSON.stringify(sync.body), '[E2] 关闭关键词过滤仍不上传 private').not.toContain(PRIVATE);
      expect(sync.response.status, '[E3] 真实响应为 200').toBe(200);
      expect(sync.response.body, '[E3] 后端无拒收且仅有普通一页').toMatchObject({ rejected: 0, pageCount: 1 });
      const ranked = await api.get('/api/pages/ranked');
      expect(ranked.status, '[E4] ranked 查询成功').toBe(200);
      expect(ranked.body.pages.map((page) => page.url), '[E4] private 没有入库').not.toContain(PRIVATE);
      expect(ranked.body.pages.map((page) => page.url), '[E4] 禁用关键词过滤后仍只入库普通 docs').toEqual([DOCS]);
      await ext.snap(popup, '关键词过滤关闭但无痕仍未上传');
    });
  } finally {
    try {
      await observer?.close();
    } finally {
      try {
        await privateRoute?.close();
      } finally {
        if (privateWindow) await ext.swEval((id) => chrome.windows.remove(id), privateWindow.id);
      }
    }
  }
});

