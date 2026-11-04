// 用例：TC-UI-CTX-017；按 CTX 用例与 UI 契约编写的 TDD 草稿。
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
const TOLERANCE = 60_000;

test('TC-UI-CTX-017 上下文展示真实历史查询参数：30 天窗口与 maxResults=100', async ({ ext, evidence }) => {
  const popup = await ext.openPopup();
  const timing = await test.step('S1：在点击上下文前后记录真实时钟，等待实际查询参数显示', async () => {
    const before = Date.now();
    await popup.getByTestId('tab-context').click();
    await expect(popup.getByTestId('panel-context'), '上下文面板已显示').toBeVisible();
    await expect(popup.getByTestId('context-history-query'), '实际历史查询范围已显示').toBeVisible();
    await expect(popup.getByTestId('context-history-query'), '实际 startTime 属性已写入').toHaveAttribute('data-start-time', /^.+$/);
    await expect(popup.getByTestId('context-loading'), '上下文读取完成').toBeHidden();
    const after = Date.now();
    await ext.snap(popup, 'S1-实际历史查询参数');
    return { before, after };
  });
  await test.step('S2：核对实际 maxResults、有限 startTime 和固定的一分钟误差', async () => {
    const query = popup.getByTestId('context-history-query');
    const maxResults = Number(await query.getAttribute('data-max-results'));
    const startTime = Number(await query.getAttribute('data-start-time'));
    expect(maxResults, '[E1] 实际 data-max-results 解析后严格为 100').toBe(100);
    expect(Number.isFinite(startTime), '[E2] 实际 startTime 为有限数').toBe(true);
    expect(startTime, '[E2] startTime 不早于 tBefore 减 30 天再减一分钟').toBeGreaterThanOrEqual(timing.before - DAY30 - TOLERANCE);
    expect(startTime, '[E2] startTime 不晚于 tAfter 减 30 天再加一分钟').toBeLessThanOrEqual(timing.after - DAY30 + TOLERANCE);
    expect(timing.after - timing.before, '[E3] 读取过程严格少于 60000 毫秒').toBeLessThan(TOLERANCE);
    evidence.note(JSON.stringify({ ...timing, maxResults, startTime }));
    await ext.snap(popup, 'S2-30天与100条查询参数');
  });
});

