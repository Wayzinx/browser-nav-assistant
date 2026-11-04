// 用例：TC-UI-CTX-001；按 CTX 用例与 UI 契约编写的 TDD 草稿。
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
import { fileURLToPath } from 'node:url';

test('TC-UI-CTX-001 真实插件 manifest 为 MV3、包含四项权限及两项后端 host 权限，入口文件可加载', async ({ ext }) => {
  const extensionDir = new URL('../../extension/', import.meta.url);
  const manifest = await test.step('S1：解析真实 manifest 并检查版本、权限及入口声明', async () => {
    const parsed = JSON.parse(fs.readFileSync(new URL('manifest.json', extensionDir), 'utf8'));
    expect(parsed.manifest_version, '[E1] manifest_version 严格等于 3').toBe(3);
    expect(parsed.permissions, '[E2] 四项必要权限均为字符串且已声明').toEqual(expect.arrayContaining(['tabs', 'history', 'storage', 'activeTab']));
    expect(parsed.host_permissions, '[E3] 声明两个后端主机权限').toEqual(expect.arrayContaining(['http://localhost/*', 'http://127.0.0.1/*']));
    expect(parsed.background.type, '[E4] service worker 使用 module 类型').toBe('module');
    return parsed;
  });
  await test.step('S2：核对真实入口文件、已加载的 SW 和实际 popup 路径', async () => {
    const workerFile = fileURLToPath(new URL(manifest.background.service_worker, extensionDir));
    const popupFile = fileURLToPath(new URL(manifest.action.default_popup, extensionDir));
    expect(fs.existsSync(workerFile), '[E4] manifest 指向的 SW 文件存在').toBe(true);
    expect(fs.statSync(workerFile).isFile(), '[E4] SW 入口是普通文件').toBe(true);
    expect(fs.existsSync(popupFile), '[E5] manifest 指向的 popup 文件存在').toBe(true);
    expect(fs.statSync(popupFile).isFile(), '[E5] popup 入口是普通文件').toBe(true);
    expect(ext.sw.url(), '[E4] 真实加载的 SW 与 manifest 路径一致').toBe('chrome-extension://' + ext.extensionId + '/' + manifest.background.service_worker);
    const popup = await ext.openPopup();
    expect(popup.url(), '[E5] 实际 popup URL 与 manifest 声明一致').toBe('chrome-extension://' + ext.extensionId + '/' + manifest.action.default_popup);
    await ext.snap(popup, 'S2-真实扩展入口');
  });
});

