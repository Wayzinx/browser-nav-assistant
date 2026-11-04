// 用例：TC-UI-CTX-006；按 CTX 用例与 UI 契约编写的 TDD 草稿。
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
const MDN = 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API';

test('TC-UI-CTX-006 依次访问 PR 和 MDN 再打开 popup：排除插件自身并选择最近活动 MDN', async ({ ext, evidence }) => {
  await test.step('S1：真实打开和激活 PR、MDN，确认严格的 lastAccessed 顺序', async () => {
    await ext.mockSites({ [PR]: 'PR 456', [MDN]: 'Fetch API' });
    const [pr, mdn] = await ext.openTabs([PR, MDN]);
    await expect(pr).toHaveTitle('PR 456');
    await expect(mdn).toHaveTitle('Fetch API');
    await expect.poll(async () => {
      await pr.bringToFront();
      await mdn.bringToFront();
      const tabs = await ext.swEval(() => chrome.tabs.query({ lastFocusedWindow: true }));
      return tabs.find((tab) => tab.url === MDN).lastAccessed > tabs.find((tab) => tab.url === PR).lastAccessed;
    }, { message: '真实 MDN.lastAccessed 严格大于 PR.lastAccessed' }).toBe(true);
    evidence.note(JSON.stringify({ tabs: await ext.swEval(() => chrome.tabs.query({ lastFocusedWindow: true })) }));
    await ext.snap(mdn, 'S1-最近活动MDN');
  });
  await test.step('S2：激活 popup 本身并核对回退到 MDN', async () => {
    const popup = await ext.openPopup();
    await popup.bringToFront();
    const active = await ext.swEval(() => chrome.tabs.query({ active: true, lastFocusedWindow: true }));
    expect(active.map((tab) => tab.url), 'popup 已成为真实活动标签').toEqual([popup.url()]);
    await expect(popup.getByTestId('current-page-url'), '[E1] 当前页面严格为最近活动 MDN').toHaveText(MDN);
    await expect(popup.getByTestId('current-page-title'), '[E2] MDN 标题严格一致').toHaveText('Fetch API');
    await expect(popup.getByTestId('current-page-url'), '[E3] 排除插件自身 URL').not.toHaveText(/^chrome-extension:\/\//);
    await expect(popup.getByTestId('current-page-url'), '[E3] 不回退到较早活动的 PR').not.toHaveText(PR);
    await ext.snap(popup, 'S2-popup回退MDN');
  });
});

