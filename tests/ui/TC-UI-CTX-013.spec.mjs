// 用例：TC-UI-CTX-013；按 CTX 用例与 UI 契约编写的 TDD 草稿。
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

async function addStrictHistory(ext, urls) {
  let previous = -Infinity;
  for (const url of urls) {
    await expect.poll(() => ext.swEval(() => Date.now()), { message: '真实时钟推进后才添加下一条历史' }).toBeGreaterThan(previous);
    await ext.seedHistory([url]);
    const entry = (await readHistory(ext)).find((item) => item.url === url);
    expect(Number.isFinite(entry.lastVisitTime), '真实历史读回有限 lastVisitTime').toBe(true);
    expect(entry.lastVisitTime, '新增真实历史的访问时间严格递增').toBeGreaterThan(previous);
    previous = entry.lastVisitTime;
  }
  return readHistory(ext);
}

const URLS = ['https://history.example/ctx/a', 'https://history.example/ctx/b', 'https://history.example/ctx/c'];

test('TC-UI-CTX-013 三条真实新增历史按最后访问时间从新到旧显示', async ({ ext, evidence }) => {
  const popup = await ext.openPopup();
  const history = await test.step('S1：清空真实历史，依次添加 a、b、c 并读回递增时间', async () => {
    await ext.swEval(() => chrome.history.deleteAll());
    const records = await addStrictHistory(ext, URLS);
    expect(records.map((item) => item.url).toSorted(), '真实浏览器恰好含三条输入历史').toEqual(URLS.toSorted());
    evidence.note(JSON.stringify({ history: records }));
    return records;
  });
  await test.step('S2：刷新上下文，核对数量、完整 URL 顺序和每条真实访问时间', async () => {
    await popup.reload();
    await popup.getByTestId('tab-context').click();
    const items = popup.getByTestId('context-history-list').getByTestId('context-history-item');
    await expect(popup.getByTestId('context-history-count'), '[E1] 历史条数严格为 3').toHaveText('3');
    await expect(items, '[E1] 历史项恰好三条').toHaveCount(3);
    const expectedUrls = URLS.toReversed();
    await expect(items.getByTestId('context-history-url'), '[E2] 完整 URL 顺序严格为 c、b、a').toHaveText(expectedUrls);
    const times = expectedUrls.map((url) => history.find((item) => item.url === url).lastVisitTime);
    for (let index = 0; index < times.length; index++) {
      await expect(items.nth(index).getByTestId('context-history-time'), '[E3] data-ts 等于浏览器读回的访问时间').toHaveAttribute('data-ts', String(times[index]));
    }
    expect(times[0], '[E3] tC 严格大于 tB').toBeGreaterThan(times[1]);
    expect(times[1], '[E3] tB 严格大于 tA').toBeGreaterThan(times[2]);
    await expect(popup.getByTestId('context-history-empty'), '[E4] 历史空状态不可见').toBeHidden();
    await expect(popup.getByTestId('context-error'), '[E4] 上下文错误不可见').toBeHidden();
    await ext.snap(popup, 'S2-三条真实历史倒序');
  });
});

