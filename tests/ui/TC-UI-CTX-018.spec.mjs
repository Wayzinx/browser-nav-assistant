// 用例：TC-UI-CTX-018；按 CTX 用例与 UI 契约编写的 TDD 草稿。
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

const URLS = ['https://history.example/ctx/offline/a', 'https://history.example/ctx/offline/b', 'https://history.example/ctx/offline/c'];
const TOLERANCE = 60_000;

test('TC-UI-CTX-018 后端不可达时最近三条浏览器历史及查询参数仍可读取', async ({ ext, evidence }) => {
  await ext.useUnreachableBackend();
  const popup = await ext.openPopup();
  await test.step('S1：真实清空并添加三条离线历史，读回严格递增的 lastVisitTime', async () => {
    await ext.swEval(() => chrome.history.deleteAll());
    const history = await addStrictHistory(ext, URLS);
    expect(history.map((item) => item.url).toSorted(), '真实历史恰好为本条三条输入').toEqual(URLS.toSorted());
    evidence.note(JSON.stringify({ history }));
  });
  await test.step('S2：计时刷新并进入上下文，核对离线历史、查询参数与真实异常', async () => {
    const before = Date.now();
    await popup.reload();
    await popup.getByTestId('tab-context').click();
    await expect(popup.getByTestId('context-history-query'), '实际查询范围已显示').toBeVisible();
    await expect(popup.getByTestId('context-history-query'), '实际 startTime 已写入').toHaveAttribute('data-start-time', /^.+$/);
    await expect(popup.getByTestId('context-loading'), '上下文读取完成').toBeHidden();
    // 等待策略：以 SW 持久化的真实连接结果判断「后端连接失败已处理」，不依赖不属于本用例的 connection-status 展示
    await expect.poll(async () => (await ext.getStorage(['connection'])).connection?.status,
      { message: '真实后端连接失败已处理（storage.connection.status=offline）' }).toBe('offline');
    const after = Date.now();
    const items = popup.getByTestId('context-history-list').getByTestId('context-history-item');
    await expect(popup.getByTestId('context-history-count'), '[E1] 离线时历史条数严格为 3').toHaveText('3');
    await expect(items, '[E1] 离线时仍展示三条真实历史').toHaveCount(3);
    await expect(items.getByTestId('context-history-url'), '[E1] 离线历史完整 URL 顺序严格为 c、b、a').toHaveText(URLS.toReversed());
    const query = popup.getByTestId('context-history-query');
    const maxResults = Number(await query.getAttribute('data-max-results'));
    const startTime = Number(await query.getAttribute('data-start-time'));
    expect(maxResults, '[E2] 离线时实际 maxResults 仍为 100').toBe(100);
    expect(Number.isFinite(startTime), '[E2] 离线时 startTime 为有限数').toBe(true);
    expect(startTime, '[E2] 离线 startTime 满足固定误差下界').toBeGreaterThanOrEqual(before - DAY30 - TOLERANCE);
    expect(startTime, '[E2] 离线 startTime 满足固定误差上界').toBeLessThanOrEqual(after - DAY30 + TOLERANCE);
    expect(after - before, '[E2] 离线读取过程严格少于一分钟').toBeLessThan(TOLERANCE);
    await expect(popup.getByTestId('context-error'), '[E3] 离线时上下文不显示读取错误').toBeHidden();
    await expect(popup.getByTestId('context-history-empty'), '[E3] 三条历史不显示空状态').toBeHidden();
    evidence.note(JSON.stringify({ before, after, maxResults, startTime }));
    await ext.snap(popup, 'S2-离线真实历史与查询参数');
    const state = observations.get(ext);
    await state.worker.flush();
    expect(state.pageErrors, '[E4] 离线时 popup pageerror 为 0').toEqual([]);
    expect(state.worker.exceptions, '[E4] 离线时实际 SW Runtime.exceptionThrown 为 0').toEqual([]);
  });
});

