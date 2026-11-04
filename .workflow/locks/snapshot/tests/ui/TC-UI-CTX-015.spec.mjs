// 用例：TC-UI-CTX-015；按 CTX 用例与 UI 契约编写的 TDD 草稿。
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

for (const count of [99, 100, 101]) {
  test('TC-UI-CTX-015 历史数量边界 N=' + count, async ({ ext, evidence }) => {
    const urls = Array.from({ length: count }, (_, index) => 'https://history.example/ctx/n' + count + '/' + String(index + 1).padStart(3, '0'));
    const popup = await test.step('S1：本变体独立创建 popup、清空历史并添加恰好 N 条真实记录', async () => {
      const page = await ext.openPopup();
      await ext.swEval(() => chrome.history.deleteAll());
      await ext.seedHistory(urls);
      const history = await readHistory(ext);
      expect(history, '本变体真实历史数量为 N').toHaveLength(count);
      expect(history.map((item) => item.url).toSorted(), '本变体的真实历史输入完全一致').toEqual(urls.toSorted());
      evidence.note(JSON.stringify({ count, history }));
      return page;
    });
    await test.step('S2：刷新上下文，核对边界数量以及 URL 唯一性和输入归属', async () => {
      await popup.reload();
      await popup.getByTestId('tab-context').click();
      const items = popup.getByTestId('context-history-list').getByTestId('context-history-item');
      if (count === 99) {
        await expect(popup.getByTestId('context-history-count'), '[E1] N=99 显示 99').toHaveText('99');
        await expect(items, '[E1] N=99 展示 99 条').toHaveCount(99);
      } else if (count === 100) {
        await expect(popup.getByTestId('context-history-count'), '[E2] N=100 显示 100').toHaveText('100');
        await expect(items, '[E2] N=100 展示 100 条').toHaveCount(100);
      } else {
        await expect(popup.getByTestId('context-history-count'), '[E3] N=101 显示 100').toHaveText('100');
        await expect(items, '[E3] N=101 截断为 100 条').toHaveCount(100);
      }
      const uiUrls = await items.getByTestId('context-history-url').allTextContents();
      expect(new Set(uiUrls).size, '[E4] 本变体每条 UI URL 唯一').toBe(Math.min(count, 100));
      expect(uiUrls.filter((url) => !urls.includes(url)), '[E4] 全部 UI URL 属于本变体真实输入集合').toEqual([]);
      await ext.snap(popup, 'S2-历史边界N' + count);
    });
  });
}

