// 用例：TC-UI-CTX-010；按 CTX 用例与 UI 契约编写的 TDD 草稿。
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


const SITES = {
  'https://github.com/org/repo/pull/456': 'PR 456',
  'https://github.com/org/repo/issues/123': 'Issue 123',
  'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API': 'Fetch API',
  'https://docs.internal.com/ai-agent-design': 'AI Agent Design',
};
const exactUrl = (url) => new RegExp('^' + url.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&') + '$');

test('TC-UI-CTX-010 当前窗口四个外部页面在上下文列表逐条显示标题和完整 URL', async ({ ext, evidence }) => {
  await test.step('S1：在同一普通窗口真实打开四个标题明确的外部页面', async () => {
    await ext.mockSites(SITES);
    const pages = await ext.openTabs(Object.keys(SITES));
    for (let index = 0; index < pages.length; index++) {
      await expect(pages[index]).toHaveTitle(Object.values(SITES)[index]);
    }
    const tabs = await ext.swEval(() => chrome.tabs.query({ windowType: 'normal' }));
    const windowIds = tabs.filter((tab) => Object.hasOwn(SITES, tab.url)).map((tab) => tab.windowId);
    expect(windowIds, '四个指定 URL 均已创建真实标签').toHaveLength(4);
    expect(new Set(windowIds).size, '四个真实标签属于同一窗口').toBe(1);
    evidence.note(JSON.stringify({ tabs }));
    await ext.snap(pages.at(-1), 'S1-四个外部页面');
  });
  await test.step('S2：打开上下文页签，逐条核对四个 URL 与标题', async () => {
    const popup = await ext.openPopup();
    await popup.getByTestId('tab-context').click();
    await expect(popup.getByTestId('panel-context'), '上下文面板已显示').toBeVisible();
    await expect(popup.getByTestId('context-loading'), '上下文读取完成').toBeHidden();
    const items = popup.getByTestId('context-tabs-list').getByTestId('context-tab-item');
    for (const [url, title] of Object.entries(SITES)) {
      const row = items.filter({ has: popup.getByTestId('context-tab-url').filter({ hasText: exactUrl(url) }) });
      await expect(row, '[E1] 指定完整 URL 对应行恰好一条').toHaveCount(1);
      await expect(row.getByTestId('context-tab-title'), '[E2] 每行显示输入的完整标题').toHaveText(title);
      await expect(row.getByTestId('context-tab-url'), '[E3] 每行显示输入的完整 URL').toHaveText(url);
    }
    await expect(popup.getByTestId('context-error'), '[E4] 上下文没有读取错误').toBeHidden();
    await ext.snap(popup, 'S2-四条标签上下文');
  });
});

