// 用例：TC-UI-CTX-021；按 CTX 用例与 UI 契约编写的 TDD 草稿。
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


const REACT = 'https://react.dev/learn';

test('TC-UI-CTX-021 后端不可达且仅有系统页时仍显示降级卡片与跳过标注', async ({ ext, evidence }) => {
  await ext.useUnreachableBackend();
  const popup = await test.step('S1：仅保留系统页并核对零候选，打开离线 popup 和上下文', async () => {
    const system = await ext.context.newPage();
    await system.goto('chrome://version/');
    for (const page of ext.context.pages()) {
      if (page !== system) await page.close();
    }
    await system.bringToFront();
    const tabs = await ext.swEval(() => chrome.tabs.query({ lastFocusedWindow: true }));
    expect(tabs.filter((tab) => /^https?:\/\//.test(tab.url)), '阶段一真实窗口没有 http(s) 候选').toEqual([]);
    expect(tabs.map((tab) => tab.url), '阶段一仅有真实系统页').toEqual([expect.stringMatching(/^chrome:\/\/version\/?$/)]);
    evidence.note(JSON.stringify({ stageOneTabs: tabs }));
    const page = await ext.openPopup();
    await expect(page.getByTestId('connection-status'), '真实后端连接失败已处理').toHaveAttribute('data-state', 'offline');
    await expect(page.getByTestId('current-page-system-badge'), '[E1] 阶段一降级标识可见').toBeVisible();
    await expect(page.getByTestId('current-page-system-badge'), '[E1] 阶段一降级文案严格一致').toHaveText('系统页 · 不采集');
    await ext.snap(page, 'S1-离线系统页降级卡片');
    await page.getByTestId('tab-context').click();
    await expect(page.getByTestId('context-loading'), '阶段一上下文读取完成').toBeHidden();
    return page;
  });
  await test.step('S2：核对阶段一系统标注，再真实新增 React 并刷新核对两行', async () => {
    let items = popup.getByTestId('context-tabs-list').getByTestId('context-tab-item');
    let system = items.filter({ has: popup.getByTestId('context-tab-url').filter({ hasText: /^chrome:\/\/version\/?$/ }) });
    await expect(system, '[E2] 阶段一系统页行唯一').toHaveCount(1);
    await expect(system.getByTestId('context-tab-badge'), '[E2] 阶段一系统页标注严格为跳过').toHaveText('系统页 · 跳过');
    await ext.snap(popup, 'S2-阶段一系统跳过标注');
    await ext.mockSites({ [REACT]: 'Learn React' });
    const [reactPage] = await ext.openTabs([REACT]);
    await expect(reactPage).toHaveTitle('Learn React');
    await popup.bringToFront();
    await popup.reload();
    await popup.getByTestId('tab-context').click();
    await expect(popup.getByTestId('panel-context'), '阶段二上下文面板可见').toBeVisible();
    await expect(popup.getByTestId('context-loading'), '阶段二上下文读取完成').toBeHidden();
    items = popup.getByTestId('context-tabs-list').getByTestId('context-tab-item');
    system = items.filter({ has: popup.getByTestId('context-tab-url').filter({ hasText: /^chrome:\/\/version\/?$/ }) });
    const react = items.filter({ has: popup.getByTestId('context-tab-url').filter({ hasText: /^https:\/\/react\.dev\/learn$/ }) });
    await expect(system, '[E2] 阶段二系统页行仍唯一').toHaveCount(1);
    await expect(system.getByTestId('context-tab-badge'), '[E2] 阶段二系统页仍严格标注跳过').toHaveText('系统页 · 跳过');
    await expect(react, '[E3] 阶段二真实 React 行唯一').toHaveCount(1);
    await expect(react.getByTestId('context-tab-url'), '[E3] 阶段二 React 完整 URL 严格一致').toHaveText(REACT);
    await expect(react.getByTestId('context-tab-badge'), '[E3] 阶段二 React 行没有标注元素').toHaveCount(0);
    await ext.snap(popup, 'S2-阶段二离线混合页面');
    const state = observations.get(ext);
    await state.worker.flush();
    expect(state.pageErrors, '[E4] 两阶段 popup pageerror 均为 0').toEqual([]);
    expect(state.worker.exceptions, '[E4] 本次实际 SW Runtime.exceptionThrown 为 0').toEqual([]);
  });
});

