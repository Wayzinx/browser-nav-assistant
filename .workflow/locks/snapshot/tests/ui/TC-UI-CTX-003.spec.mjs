// 用例：TC-UI-CTX-003；按 CTX 用例与 UI 契约编写的 TDD 草稿。
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


const TABS = ['tab-home', 'tab-context', 'tab-ranked', 'tab-cleanup', 'tab-rules', 'tab-diag'];

test('TC-UI-CTX-003 后端不可达时真实 SW 与 popup 外壳仍加载且无未捕获错误', async ({ ext }) => {
  await ext.useUnreachableBackend();
  expect((await ext.getStorage('apiBaseUrl')).apiBaseUrl, '真实后端目标为无监听端口').toBe('http://127.0.0.1:9');
  const state = observations.get(ext);
  const popup = await test.step('S1：开启实际 SW 异常监听、真实重载并打开 popup', async () => {
    const workerUrl = ext.sw.url();
    const manager = await ext.context.newPage();
    await manager.goto('chrome://extensions/');
    const closedWorker = ext.sw.waitForEvent('close');
    const nextWorker = ext.context.waitForEvent('serviceworker', { predicate: (worker) => worker.url() === workerUrl });
    await ext.swEval(() => { setTimeout(() => chrome.runtime.reload(), 0); });
    await closedWorker;
    // 真实恢复命令行扩展的启用状态；自动附着持续覆盖新 SW 启动，离线 storage 配置保留。
    await manager.evaluate((id) => chrome.management.setEnabled(id, true), ext.extensionId);
    ext.sw = await nextWorker;
    await state.worker.ready();
    await manager.close();
    expect((await ext.getStorage('apiBaseUrl')).apiBaseUrl, '真实重载后仍指向本条无监听后端端口').toBe('http://127.0.0.1:9');
    await expect.poll(() => ext.context.serviceWorkers().filter((worker) => worker.url() === workerUrl).length).toBe(1);
    expect(ext.sw.url(), '[E1] 真实 SW 重载后重新注册').toBe(workerUrl);
    expect(new URL(ext.sw.url()).host, '[E1] SW 属于本扩展').toBe(ext.extensionId);
    const page = await ext.openPopup();
    await ext.snap(page, 'S1-离线popup外壳');
    return page;
  });
  await test.step('S2：核对标题与六页签，切换上下文和首页并检查异常', async () => {
    await expect(popup.getByTestId('app-title'), '[E2] 离线时仍展示导航助手').toHaveText('导航助手');
    for (const tab of TABS) {
      await expect(popup.getByTestId(tab), '[E2] 六个登记页签各出现一个').toHaveCount(1);
      await expect(popup.getByTestId(tab), '[E2] 六个登记页签均可见').toBeVisible();
    }
    await popup.getByTestId('tab-context').click();
    await expect(popup.getByTestId('panel-context'), '[E3] 上下文面板可见').toBeVisible();
    await ext.snap(popup, 'S2-离线上下文');
    await popup.getByTestId('tab-home').click();
    await expect(popup.getByTestId('panel-home'), '[E3] 返回首页后首页面板可见').toBeVisible();
    await expect(popup.getByTestId('panel-context'), '[E3] 返回首页后上下文面板隐藏').toBeHidden();
    await expect(popup.getByTestId('connection-status'), '真实后端失败已被界面处理').toHaveAttribute('data-state', 'offline');
    await ext.snap(popup, 'S2-离线返回首页');
    await state.worker.flush();
    expect(state.worker.exceptions, '[E1] 重载启动和离线加载期间 SW Runtime.exceptionThrown 为 0').toEqual([]);
    expect(state.pageErrors, '[E4] 实际连接失败后 popup pageerror 为 0').toEqual([]);
  });
});

