// 用例：TC-UI-CTX-011；按 CTX 用例与 UI 契约编写的 TDD 草稿。
import { test, expect } from '../fixtures/extension.mjs';

// 每个脚本独立监听真实 SW；本任务不修改公共夹具。
const observations = new WeakMap();

async function observeWorker(ext, evidence) {
  const cdp = await ext.context.browser().newBrowserCDPSession();
  const workerUrl = ext.sw.url();
  const sessions = new Map();
  const enabled = new Set();
  const attaching = new Set();
  const pending = new Map();
  const tasks = [];
  const exceptions = [];
  const protocolErrors = [];
  let sequence = 0;

  function command(sessionId, method) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const key = sessionId + ':' + id;
      pending.set(key, { resolve, reject });
      cdp.send('Target.sendMessageToTarget', {
        sessionId, message: JSON.stringify({ id, method, params: {} }),
      }).then(undefined, (error) => { pending.delete(key); reject(error); });
    });
  }

  cdp.on('Target.receivedMessageFromTarget', ({ sessionId, message }) => {
    const event = JSON.parse(message);
    const key = sessionId + ':' + event.id;
    const waiting = pending.get(key);
    if (waiting) {
      pending.delete(key);
      if (event.error) waiting.reject(new Error(JSON.stringify(event.error)));
      else waiting.resolve(event.result);
    }
    if (event.method === 'Runtime.exceptionThrown' && sessions.has(sessionId)) {
      const entry = { target: sessions.get(sessionId), details: event.params.exceptionDetails };
      exceptions.push(entry);
      evidence.extLog('sw-exception', JSON.stringify(entry));
    }
  });
  cdp.on('Target.attachedToTarget', ({ targetInfo }) => {
    const matches = targetInfo.type === 'service_worker' && (targetInfo.url === workerUrl || targetInfo.url === '');
    if (matches && !attaching.has(targetInfo.targetId)) {
      attaching.add(targetInfo.targetId);
      const task = (async () => {
        // 浏览器自动附着必须 flatten=true；另建嵌套会话，用公开 CDP 命令监听暂停中的 SW。
        const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: targetInfo.targetId, flatten: false });
        sessions.set(sessionId, targetInfo);
        await command(sessionId, 'Runtime.enable');
        await command(sessionId, 'Runtime.runIfWaitingForDebugger');
        enabled.add(targetInfo.targetId);
      })().then(undefined, (error) => { protocolErrors.push(error); });
      tasks.push(task);
    }
  });
  cdp.on('Target.targetInfoChanged', ({ targetInfo }) => {
    for (const [sessionId, target] of sessions) {
      if (target.targetId === targetInfo.targetId) sessions.set(sessionId, targetInfo);
    }
  });
  cdp.on('Target.detachedFromTarget', ({ sessionId }) => {
    for (const [key, waiting] of pending) {
      if (key.startsWith(sessionId + ':')) {
        pending.delete(key);
        waiting.reject(new Error('SW CDP session 在命令完成前断开：' + sessionId));
      }
    }
  });
  async function flush() {
    await Promise.all(tasks);
    if (protocolErrors.length) throw protocolErrors[0];
  }
  await cdp.send('Target.setAutoAttach', {
    autoAttach: true, waitForDebuggerOnStart: true, flatten: true,
    filter: [{ type: 'service_worker' }, { exclude: true }],
  });
  async function ready() {
    await expect.poll(async () => {
      await flush();
      const { targetInfos } = await cdp.send('Target.getTargets');
      const active = targetInfos.filter((target) => target.type === 'service_worker' && target.url === workerUrl);
      return active.length === 1 && active.every((target) => enabled.has(target.targetId));
    }, { message: '真实 SW target 已启用 Runtime 异常监听' }).toBe(true);
  }
  await ready();
  return {
    exceptions, ready, flush,
    async close() {
      await cdp.send('Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true });
      await flush();
      await cdp.detach();
    },
  };
}

test.beforeEach(async ({ ext, evidence }) => {
  const state = { pageErrors: [], worker: null };
  observations.set(ext, state);
  ext.context.on('page', (page) => {
    page.on('pageerror', (error) => {
      if (page.url().startsWith('chrome-extension://' + ext.extensionId + '/')) {
        state.pageErrors.push({ url: page.url(), message: error.message });
      }
    });
  });
  state.worker = await observeWorker(ext, evidence);
});

test.afterEach(async ({ ext, evidence }) => {
  const state = observations.get(ext);
  if (state) {
    evidence.note(JSON.stringify({ popupPageErrors: state.pageErrors, swExceptions: state.worker?.exceptions }));
    if (state.worker) await state.worker.close();
  }
});


const PR = 'https://github.com/org/repo/pull/456';
const OTHER = 'https://example.com/other';
const exactUrl = (url) => new RegExp('^' + url.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&') + '$');

test('TC-UI-CTX-011 另一普通窗口的页面不会混入当前窗口上下文列表', async ({ ext, evidence }) => {
  let windowB;
  try {
    const windowA = await test.step('S1：在同一 context 中真实创建窗口 A 的 PR 和窗口 B 的 other', async () => {
      await ext.mockSites({ [PR]: 'PR 456', [OTHER]: 'Other Window' });
      const [pr] = await ext.openTabs([PR]);
      await expect(pr).toHaveTitle('PR 456');
      const source = (await ext.swEval(() => chrome.tabs.query({ windowType: 'normal' }))).find((tab) => tab.url === PR);
      // 探索发现：windows.create 直接带外部 URL 时首个导航先于 context.route 生效，会请求真实站点；
      // 先建空白窗口，再由 Playwright 页面在窗口 B 内导航，保证外部站点离线化。
      const pageB = ext.context.waitForEvent('page');
      const created = await ext.swEval(() => chrome.windows.create({ url: 'about:blank', type: 'normal' }));
      windowB = created.id;
      expect(windowB, '真实 windows.create 的窗口与 A 不同').not.toBe(source.windowId);
      await (await pageB).goto(OTHER, { waitUntil: 'domcontentloaded' });
      await expect.poll(async () => (await ext.swEval((id) => chrome.tabs.query({ windowId: id }), windowB)).map((tab) => ({ url: tab.url, title: tab.title }))).toEqual([{ url: OTHER, title: 'Other Window' }]);
      evidence.note(JSON.stringify({ windowA: source.windowId, windowB }));
      await ext.snap(pr, 'S1-保留另一个真实窗口');
      return source.windowId;
    });
    await test.step('S2：真实聚焦窗口 A 并在 A 创建 popup，核对列表及窗口 B 仍存在', async () => {
      await ext.swEval((id) => chrome.windows.update(id, { focused: true }), windowA);
      const createdPage = ext.context.waitForEvent('page');
      await ext.swEval(({ windowId, url }) => chrome.tabs.create({ windowId, url, active: true }), { windowId: windowA, url: ext.popupUrl });
      const popup = await createdPage;
      ext.popup = popup;
      await popup.waitForURL(ext.popupUrl);
      await popup.bringToFront();
      const active = await ext.swEval((id) => chrome.tabs.query({ windowId: id, active: true }), windowA);
      expect(active.map((tab) => tab.url), 'popup 在真实窗口 A 内活动').toEqual([ext.popupUrl]);
      await popup.getByTestId('tab-context').click();
      await expect(popup.getByTestId('context-loading'), '上下文读取完成').toBeHidden();
      const list = popup.getByTestId('context-tabs-list');
      const prRow = list.getByTestId('context-tab-item').filter({ has: popup.getByTestId('context-tab-url').filter({ hasText: exactUrl(PR) }) });
      await expect(prRow, '[E1] 当前窗口 PR 恰好一条').toHaveCount(1);
      await expect(prRow.getByTestId('context-tab-url'), '[E1] 当前窗口完整 PR URL').toHaveText(PR);
      await expect(list.getByTestId('context-tab-url').filter({ hasText: exactUrl(OTHER) }), '[E2] 另一个窗口的 other URL 出现次数为 0').toHaveCount(0);
      const otherTabs = await ext.swEval((id) => chrome.tabs.query({ windowId: id }), windowB);
      expect(otherTabs.map((tab) => tab.url), '[E3] 窗口 B 仍可真实读取且 other URL 未改变').toEqual([OTHER]);
      expect(otherTabs.map((tab) => tab.windowId), '[E3] other 标签仍属于真实窗口 B').toEqual([windowB]);
      evidence.note(JSON.stringify({ windowA, windowB, otherTabs }));
      await ext.snap(popup, 'S2-当前窗口列表隔离');
    });
  } finally {
    if (windowB !== undefined) await ext.swEval((id) => chrome.windows.remove(id), windowB);
  }
});

