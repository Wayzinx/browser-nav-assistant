// 用例：TC-UI-CTX-020；按 CTX 用例与 UI 契约编写的 TDD 草稿。
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

test('TC-UI-CTX-020 系统页与 React 普通页混合时只给系统页标注跳过', async ({ ext }) => {
  await test.step('S1：真实打开 chrome://version 和指定标题的 React 外部页面', async () => {
    const system = await ext.context.newPage();
    await system.goto('chrome://version/');
    await ext.mockSites({ [REACT]: 'Learn React' });
    const [react] = await ext.openTabs([REACT]);
    await expect(react).toHaveTitle('Learn React');
    await ext.snap(system, 'S1-系统页');
    await ext.snap(react, 'S1-React普通页');
  });
  await test.step('S2：按完整 URL 定位列表行，核对系统跳过标注和 React 无标注', async () => {
    const popup = await ext.openPopup();
    await popup.getByTestId('tab-context').click();
    await expect(popup.getByTestId('panel-context'), '上下文面板可见').toBeVisible();
    await expect(popup.getByTestId('context-loading'), '上下文读取完成').toBeHidden();
    const items = popup.getByTestId('context-tabs-list').getByTestId('context-tab-item');
    const system = items.filter({ has: popup.getByTestId('context-tab-url').filter({ hasText: /^chrome:\/\/version\/?$/ }) });
    const react = items.filter({ has: popup.getByTestId('context-tab-url').filter({ hasText: /^https:\/\/react\.dev\/learn$/ }) });
    await expect(system, '[E1] 忽略末尾斜线规范化后系统页行恰好一条').toHaveCount(1);
    await expect(system.getByTestId('context-tab-badge'), '[E1] 系统页标注严格为跳过').toHaveText('系统页 · 跳过');
    await expect(react, '[E2] React 行恰好一条').toHaveCount(1);
    await expect(react.getByTestId('context-tab-title'), '[E2] React 标题完整一致').toHaveText('Learn React');
    await expect(react.getByTestId('context-tab-url'), '[E2] React 完整 URL 严格一致').toHaveText(REACT);
    await expect(react.getByTestId('context-tab-badge'), '[E3] React 行没有标注元素').toHaveCount(0);
    await ext.snap(popup, 'S2-系统与普通页不同标注');
    expect(observations.get(ext).pageErrors, '[E4] popup pageerror 为 0').toEqual([]);
  });
});

