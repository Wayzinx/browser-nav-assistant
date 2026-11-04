// 用例：TC-UI-CTX-002；按 CTX 用例与 UI 契约编写的 TDD 草稿。
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

import fs from 'node:fs';

const TABS = [
  { tab: 'tab-home', panel: 'panel-home', label: '首页' },
  { tab: 'tab-context', panel: 'panel-context', label: '上下文' },
  { tab: 'tab-ranked', panel: 'panel-ranked', label: '排序' },
  { tab: 'tab-cleanup', panel: 'panel-cleanup', label: '整理' },
  { tab: 'tab-rules', panel: 'panel-rules', label: '规则' },
  { tab: 'tab-diag', panel: 'panel-diag', label: '诊断' },
];

test('TC-UI-CTX-002 加载真实扩展后 SW 注册且无未捕获错误，popup 显示标题与六页签', async ({ ext, evidence }) => {
  const state = observations.get(ext);
  await test.step('S1：先监听实际 SW target，再真实重载扩展并覆盖启动异常', async () => {
    const manifest = JSON.parse(fs.readFileSync(new URL('../../extension/manifest.json', import.meta.url), 'utf8'));
    const expectedUrl = 'chrome-extension://' + ext.extensionId + '/' + manifest.background.service_worker;
    evidence.note(JSON.stringify({ initialWorkerUrl: ext.sw.url(), expectedUrl }));
    const manager = await ext.context.newPage();
    await manager.goto('chrome://extensions/');
    const closedWorker = ext.sw.waitForEvent('close');
    const nextWorker = ext.context.waitForEvent('serviceworker', { predicate: (worker) => worker.url() === expectedUrl });
    await ext.swEval(() => { setTimeout(() => chrome.runtime.reload(), 0); });
    await closedWorker;
    // Chromium 命令行加载的扩展重载后会变为 disabled；在独立 profile 内真实重新启用同一扩展。
    await manager.evaluate((id) => chrome.management.setEnabled(id, true), ext.extensionId);
    ext.sw = await nextWorker;
    await state.worker.ready();
    await manager.close();
    expect((await ext.getStorage('apiBaseUrl')).apiBaseUrl, '真实重载保留本条测试后端配置').toBe(ext.baseURL);
    await expect.poll(() => ext.context.serviceWorkers().map((worker) => worker.url()).filter((url) => url.startsWith('chrome-extension://' + ext.extensionId + '/'))).toEqual([expectedUrl]);
    expect(ext.context.serviceWorkers().filter((worker) => worker.url().startsWith('chrome-extension://' + ext.extensionId + '/')).map((worker) => worker.url()), '[E1] 本扩展仅有一个真实 SW 且入口与 manifest 一致').toEqual([expectedUrl]);
  });
  const popup = await test.step('S2：导航前已监听 pageerror，以标签页打开 popup', async () => {
    const page = await ext.openPopup();
    await expect(page.getByTestId('app-title'), '[E3] 顶栏标题完全一致').toHaveText('导航助手');
    await ext.snap(page, 'S2-popup外壳');
    return page;
  });
  await test.step('S3：逐个核对六页签、互斥面板和本次未捕获异常', async () => {
    await expect(popup.getByTestId(/^tab-(?:home|context|ranked|cleanup|rules|diag)$/), '[E4] 六个登记页签的实际 DOM 顺序与文字一致').toHaveText(TABS.map((entry) => entry.label));
    for (const entry of TABS) {
      await expect(popup.getByTestId(entry.tab), '[E4] 登记页签各出现一次：' + entry.label).toHaveCount(1);
      await expect(popup.getByTestId(entry.tab), '[E4] 页签文字完整：' + entry.label).toHaveText(entry.label);
      await popup.getByTestId(entry.tab).click();
      for (const other of TABS) {
        await expect(popup.getByTestId(other.tab), '[E5] 页签选中状态互斥：' + other.label).toHaveAttribute('aria-selected', String(other.tab === entry.tab));
        if (other.tab === entry.tab) {
          await expect(popup.getByTestId(other.panel), '[E5] 选中面板可见：' + other.label).toBeVisible();
        } else {
          await expect(popup.getByTestId(other.panel), '[E5] 其他面板隐藏：' + other.label).toBeHidden();
        }
      }
      await ext.snap(popup, 'S3-页签-' + entry.label);
    }
    await state.worker.flush();
    expect(state.worker.exceptions, '[E2] 从重载 SW 启动至六页签检查结束，Runtime.exceptionThrown 为 0').toEqual([]);
    expect(state.pageErrors, '[E6] popup pageerror 为 0').toEqual([]);
  });
});

