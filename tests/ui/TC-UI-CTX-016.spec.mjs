// 用例：TC-UI-CTX-016；按 CTX 用例与 UI 契约编写的 TDD 草稿。
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


const DAY30 = 30 * 86_400_000;
async function readHistory(ext) {
  return ext.swEval(() => chrome.history.search({ text: '', startTime: Date.now() - 30 * 86_400_000, maxResults: 1000 }));
}

const URL = 'https://history.example/ctx/clear';

test('TC-UI-CTX-016 清空真实浏览器历史后显示零条与空状态', async ({ ext, evidence }) => {
  const popup = await test.step('S1：打开 popup，真实添加并读回一条历史后执行 deleteAll', async () => {
    const page = await ext.openPopup();
    await ext.seedHistory([URL]);
    const history = await readHistory(ext);
    expect(history.map((item) => item.url), '清空前确实存在本条测试历史').toContain(URL);
    evidence.note(JSON.stringify({ historyBeforeClear: history }));
    await ext.swEval(() => chrome.history.deleteAll());
    await ext.snap(page, 'S1-清空历史前置');
    return page;
  });
  await test.step('S2：确认真实历史为空，刷新 popup 核对零条、空状态和异常', async () => {
    const history = await readHistory(ext);
    expect(history, '真实 history.search 返回空数组').toEqual([]);
    evidence.note(JSON.stringify({ historyAfterClear: history }));
    await popup.reload();
    await popup.getByTestId('tab-context').click();
    await expect(popup.getByTestId('context-history-count'), '[E1] 历史条数严格为 0').toHaveText('0');
    await expect(popup.getByTestId('context-history-list').getByTestId('context-history-item'), '[E1] 历史项数量为 0').toHaveCount(0);
    await expect(popup.getByTestId('context-history-empty'), '[E2] 真实空历史显示空状态').toBeVisible();
    await expect(popup.getByTestId('context-loading'), '[E3] 上下文加载结束').toBeHidden();
    await expect(popup.getByTestId('context-error'), '[E3] 空历史不产生读取错误').toBeHidden();
    await ext.snap(popup, 'S2-真实空历史状态');
    expect(observations.get(ext).pageErrors, '[E3] popup pageerror 为 0').toEqual([]);
  });
});

