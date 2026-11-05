// 真实 action popup 驱动库（原生 CDP）。
//
// 为什么需要它：Playwright 只能以 tab 方式打开 chrome-extension://…/popup.html（视口 1280×720 或夹具设定的大小），
// 拿不到点击工具栏图标后弹出的真实 popup。真实 popup 的视口由内容撑开，打开瞬间接近 0，
// 依赖 vw / vh / dvh 的样式会塌成一个小方块（本项目曾出现 25×25 的空白 popup）。这个库直接用 CDP：
//   1. 启动浏览器并加载未打包扩展（Chromium：--load-extension；品牌版 Chrome：--remote-debugging-pipe + Extensions.loadUnpacked）
//   2. 在 service worker 里调用 chrome.action.openPopup() 打开真实 popup
//   3. 通过 Target.attachToTarget(flatten) 连上 popup，执行脚本、截图、收集日志
//
// 用法（UI 探索 / 验收流程 / 冒烟门禁都可以直接 import）：
//   import { launchBrowser } from '.agents/skills/nav-case-to-script/scripts/lib/real-popup.mjs';
//   const s = await launchBrowser({ extDir: 'extension', startUrl: 'http://docs.smoke.test/' });
//   await s.openRealPopup();
//   console.log(await s.popupSize());          // { innerWidth: 400, innerHeight: 600, ... }
//   await s.popupClick('sync-button');
//   await s.waitForText('sync-status', '同步成功');
//   await s.screenshot('evidence/x/01-同步成功.png');
//   await s.close();
// 同名的具名导出函数（openRealPopup(s) / popupEval(s, expr) / …）与方法等价。
//
// 只依赖 Node 24 内置模块（WebSocket、fetch）和 @playwright/test（只用来取 Chromium 可执行文件路径）。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CHROME_MAC = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ CDP 连接（浏览器级，会话扁平化）

class CdpConnection {
  /** @param {{ send: (s: string) => void, onMessage: (cb: (s: string) => void) => void, close: () => void }} transport */
  constructor(transport) {
    this.transport = transport;
    this.seq = 0;
    this.pending = new Map();
    this.listeners = new Set();
    transport.onMessage((raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, method } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const l of this.listeners) l(msg);
      }
    });
  }

  /** 发送 CDP 命令；sessionId 为空时发给浏览器本身 */
  send(method, params = {}, sessionId, timeoutMs = 30_000) {
    const id = ++this.seq;
    const payload = { id, method, params, ...(sessionId ? { sessionId } : {}) };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method}: CDP 超时 ${timeoutMs}ms`)); }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.transport.send(JSON.stringify(payload));
    });
  }

  onEvent(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  close() { try { this.transport.close(); } catch { /* 已关闭 */ } }
}

async function wsTransport(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error(`无法连接 ${url}`)); });
  let cb = () => {};
  ws.onmessage = (ev) => cb(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
  return { send: (s) => ws.send(s), onMessage: (f) => { cb = f; }, close: () => ws.close() };
}

function pipeTransport(proc) {
  const out = proc.stdio[3];
  const inp = proc.stdio[4];
  let cb = () => {};
  let buf = '';
  inp.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\0')) >= 0) { const m = buf.slice(0, i); buf = buf.slice(i + 1); cb(m); }
  });
  return { send: (s) => out.write(s + '\0'), onMessage: (f) => { cb = f; }, close: () => { try { out.end(); } catch { /* ignore */ } } };
}

// ------------------------------------------------------------------ 启动浏览器

async function chromiumPath() {
  const { chromium } = await import('@playwright/test');
  return chromium.executablePath();
}

/**
 * 启动浏览器并加载未打包扩展，返回会话对象。
 * @param {{
 *   extDir: string,                 扩展目录（绝对或相对 cwd）
 *   browser?: 'chromium'|'chrome',  默认 chromium（Playwright 自带）；chrome = 本机品牌版 Chrome（通过 pipe + Extensions.loadUnpacked）
 *   startUrl?: string,              初始页面
 *   proxy?: string,                 例如 '127.0.0.1:8899'；同时会让回环地址也走代理（--proxy-bypass-list=<-loopback>）
 *   hostRules?: string,             --host-resolver-rules 的值（只对主机名生效，对 127.0.0.1 这种 IP 无效）
 *   headless?: boolean,             默认 true（--headless=new）；调试时可以设为 false
 *   windowSize?: [number, number],
 *   extraArgs?: string[],
 *   executablePath?: string,
 * }} opts
 * @returns {Promise<RealPopupSession>}
 */
export async function launchBrowser(opts) {
  const browser = opts.browser || 'chromium';
  const extDir = path.resolve(opts.extDir);
  if (!fs.existsSync(path.join(extDir, 'manifest.json'))) throw new Error(`扩展目录没有 manifest.json：${extDir}`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `real-popup-${browser}-`));
  const [w, h] = opts.windowSize || [1200, 820];
  const args = [
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-background-networking',
    '--disable-component-update', '--disable-default-apps', '--password-store=basic', '--use-mock-keychain',
    '--disable-features=HttpsUpgrades,HttpsFirstBalancedModeAutoEnable,MediaRouter,OptimizationHints',
    `--window-size=${w},${h}`,
    ...(opts.headless === false ? [] : ['--headless=new']),
    ...(opts.proxy ? [`--proxy-server=http://${opts.proxy}`, '--proxy-bypass-list=<-loopback>'] : []),
    ...(opts.hostRules ? [`--host-resolver-rules=${opts.hostRules}`] : []),
    ...(opts.extraArgs || []),
  ];
  let proc;
  let conn;
  let version = '';
  if (browser === 'chromium') {
    const exe = opts.executablePath || await chromiumPath();
    args.push('--remote-debugging-port=0', `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`);
    proc = spawn(exe, [...args, opts.startUrl || 'about:blank'], { stdio: 'ignore' });
    let port = 0;
    let wsPath = '';
    for (let i = 0; i < 120 && !port; i++) {
      try {
        const [p, wp] = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n');
        port = Number(p); wsPath = wp;
      } catch { await sleep(250); }
      if (proc.exitCode !== null) throw new Error(`浏览器启动后立即退出（exit=${proc.exitCode}）`);
    }
    if (!port) throw new Error('30 秒内没有拿到 DevToolsActivePort');
    conn = new CdpConnection(await wsTransport(`ws://127.0.0.1:${port}${wsPath}`));
  } else {
    const exe = opts.executablePath || CHROME_MAC;
    if (!fs.existsSync(exe)) throw new Error(`没有找到品牌版 Chrome：${exe}`);
    args.push('--remote-debugging-pipe', '--enable-unsafe-extension-debugging');
    proc = spawn(exe, [...args, opts.startUrl || 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
    conn = new CdpConnection(pipeTransport(proc));
  }
  try {
    const v = await conn.send('Browser.getVersion', {}, undefined, 15_000);
    version = v.product;
  } catch (e) {
    try { proc.kill('SIGKILL'); } catch { /* ignore */ }
    throw new Error(`无法与浏览器建立 CDP 连接：${e.message}`);
  }
  const session = new RealPopupSession({ browser, proc, conn, profile, extDir, version });
  if (browser === 'chrome') {
    const r = await conn.send('Extensions.loadUnpacked', { path: extDir });
    session.extensionId = r.id;
  }
  await session.waitForServiceWorker();
  return session;
}

// ------------------------------------------------------------------ 会话

export class RealPopupSession {
  constructor({ browser, proc, conn, profile, extDir, version }) {
    Object.assign(this, { browser, proc, conn, profile, extDir, version });
    this.extensionId = null;
    this.swSession = null;
    this.popupSession = null;
    this.popupTargetId = null;
    this.logs = { popup: [], sw: [] };
    this.exceptions = [];
    this.attached = new Map(); // sessionId → 来源（popup / sw）
    conn.onEvent((msg) => this.#onEvent(msg));
  }

  #onEvent(msg) {
    const source = this.attached.get(msg.sessionId);
    if (!source) return;
    const ts = new Date().toISOString();
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
      this.logs[source].push({ ts, type: msg.params.type, text });
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails || {};
      const text = (d.exception && (d.exception.description || d.exception.value)) || d.text || 'exception';
      this.logs[source].push({ ts, type: 'exception', text });
      this.exceptions.push({ ts, source, text: String(text).slice(0, 2000) });
    } else if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry || {};
      this.logs[source].push({ ts, type: `log.${e.level}`, text: `${e.text || ''} ${e.url || ''}`.trim() });
    }
  }

  async targets() { return (await this.conn.send('Target.getTargets')).targetInfos; }

  async #attach(targetId, source) {
    const { sessionId } = await this.conn.send('Target.attachToTarget', { targetId, flatten: true });
    this.attached.set(sessionId, source);
    await this.conn.send('Runtime.enable', {}, sessionId).catch(() => {});
    if (source === 'popup') {
      await this.conn.send('Page.enable', {}, sessionId).catch(() => {});
      await this.conn.send('Log.enable', {}, sessionId).catch(() => {});
    }
    return sessionId;
  }

  /** 等待扩展 service worker 出现并连上它（MV3 的 SW 是懒启动的，最多等 30 秒） */
  async waitForServiceWorker(timeoutMs = 30_000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const sw = (await this.targets()).find((t) => t.type === 'service_worker' && t.url.startsWith('chrome-extension://')
        && (!this.extensionId || t.url.includes(this.extensionId)) && this.#isOurExtension(t.url));
      if (sw) {
        this.extensionId = new URL(sw.url).host;
        this.swSession = await this.#attach(sw.targetId, 'sw');
        return this.extensionId;
      }
      await sleep(250);
    }
    throw new Error(`${timeoutMs}ms 内没有找到扩展的 service worker（扩展可能加载失败：检查 manifest 和 background 脚本）`);
  }

  #isOurExtension(url) {
    // 浏览器自带的组件扩展也有 service worker，用 manifest 里的 background 路径区分
    try {
      const m = JSON.parse(fs.readFileSync(path.join(this.extDir, 'manifest.json'), 'utf8'));
      const bg = m.background && m.background.service_worker;
      return !bg || new URL(url).pathname === `/${bg.replace(/^\//, '')}`;
    } catch { return true; }
  }

  /** 在 service worker 中执行表达式（awaitPromise），返回值需可 JSON 序列化 */
  async swEval(expression) {
    if (!this.swSession || !(await this.#targetAlive('service_worker'))) {
      this.swSession = null;
      await this.waitForServiceWorker();
    }
    const r = await this.conn.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, this.swSession);
    if (r.exceptionDetails) throw new Error(`SW 执行出错：${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  }

  async #targetAlive(type) {
    const ts = await this.targets();
    return ts.some((t) => t.type === type && t.url.includes(this.extensionId || '@@'));
  }

  /** 在新标签页打开 URL，等待加载完成；返回 targetId */
  async openTab(url, { waitMs = 15_000 } = {}) {
    const { targetId } = await this.conn.send('Target.createTarget', { url });
    const sid = (await this.conn.send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
    const t0 = Date.now();
    while (Date.now() - t0 < waitMs) {
      const r = await this.conn.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }, sid).catch(() => null);
      if (r && r.result && r.result.value === 'complete') break;
      await sleep(150);
    }
    await this.conn.send('Target.detachFromTarget', { sessionId: sid }).catch(() => {});
    return targetId;
  }

  async closeTab(targetId) { await this.conn.send('Target.closeTarget', { targetId }).catch(() => {}); }

  /** 关闭当前打开的 popup（如果有） */
  async closePopup() {
    if (this.popupTargetId) await this.conn.send('Target.closeTarget', { targetId: this.popupTargetId }).catch(() => {});
    this.popupSession = null;
    this.popupTargetId = null;
    await sleep(200);
  }

  /**
   * 打开真实 action popup（等同用户点击工具栏图标）。会先把一个普通网页窗口置前并聚焦，失败时重试。
   * @param {{ retries?: number, focusUrl?: string }} [o] focusUrl：先把这个 URL 的标签页置为活动标签（popup 里的「当前页面」）；不传时取第一个普通网页
   * @returns {Promise<string>} popup 的 targetId
   */
  async openRealPopup({ retries = 8, focusUrl } = {}) {
    await this.closePopup();
    const popupUrl = `chrome-extension://${this.extensionId}/`;
    let lastErr = '';
    for (let i = 0; i < retries; i++) {
      const pages = (await this.targets()).filter((t) => t.type === 'page' && !t.url.startsWith('chrome-extension://') && !t.url.startsWith('devtools://'));
      const page = (focusUrl && pages.find((t) => t.url === focusUrl)) || pages[0];
      if (page) {
        const sid = (await this.conn.send('Target.attachToTarget', { targetId: page.targetId, flatten: true })).sessionId;
        await this.conn.send('Page.bringToFront', {}, sid).catch(() => {});
        await this.conn.send('Target.detachFromTarget', { sessionId: sid }).catch(() => {});
      }
      await sleep(300);
      const res = await this.swEval(`(async () => {
        try {
          const w = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
          if (w && w.id !== undefined) await chrome.windows.update(w.id, { focused: true });
          await chrome.action.openPopup();
          return 'ok';
        } catch (e) { return 'ERR ' + (e && e.message); }
      })()`).catch((e) => `ERR ${e.message}`);
      if (res === 'ok') {
        for (let j = 0; j < 40; j++) {
          const t = (await this.targets()).find((x) => x.type === 'page' && x.url.startsWith(popupUrl));
          if (t) {
            this.popupTargetId = t.targetId;
            this.popupSession = await this.#attach(t.targetId, 'popup');
            await this.#waitPopupReady();
            return t.targetId;
          }
          await sleep(150);
        }
        lastErr = 'openPopup 返回 ok，但 6 秒内没有出现 popup target';
      } else lastErr = String(res);
      await sleep(400);
    }
    throw new Error(`无法打开真实 popup：${lastErr}`);
  }

  async #waitPopupReady(timeoutMs = 10_000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const r = await this.popupEval('document.readyState').catch(() => null);
      if (r === 'complete') { await sleep(400); return; }
      await sleep(100);
    }
  }

  /** 在 popup 中执行表达式（awaitPromise），返回 JSON 可序列化的值 */
  async popupEval(expression) {
    if (!this.popupSession) throw new Error('popup 尚未打开，先调用 openRealPopup()');
    const r = await this.conn.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, this.popupSession);
    if (r.exceptionDetails) throw new Error(`popup 执行出错：${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  }

  /** popup 的真实尺寸（真实 action popup 的视口由内容撑开，这是最关键的断言） */
  async popupSize() {
    return this.popupEval(`({
      innerWidth, innerHeight,
      docWidth: document.documentElement.scrollWidth, docHeight: document.documentElement.scrollHeight,
      bodyWidth: document.body ? document.body.offsetWidth : 0, bodyHeight: document.body ? document.body.offsetHeight : 0,
    })`);
  }

  /**
   * 元素状态：存在、可见（有尺寸且未 hidden）、文本、属性
   * @param {string} testId
   */
  async element(testId) {
    return this.popupEval(`(() => {
      const els = [...document.querySelectorAll('[data-testid="${testId}"]')];
      return els.map((el) => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return { visible: r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && !el.closest('[hidden]'),
          text: (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 500),
          disabled: Boolean(el.disabled), attrs: Object.fromEntries([...el.attributes].map((a) => [a.name, a.value])),
          rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] };
      });
    })()`);
  }

  /** 点击元素（第一个可见的同 testId 元素）；元素不存在、不可见或 disabled 时抛错 */
  async popupClick(testId, { index = 0 } = {}) {
    const res = await this.popupEval(`(() => {
      const els = [...document.querySelectorAll('[data-testid="${testId}"]')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !el.closest('[hidden]'); });
      const el = els[${index}];
      if (!el) return 'NOT_FOUND';
      if (el.disabled) return 'DISABLED';
      el.scrollIntoView({ block: 'center' });
      el.click();
      return 'ok';
    })()`);
    if (res !== 'ok') throw new Error(`点击 ${testId} 失败：${res === 'NOT_FOUND' ? '元素不存在或不可见' : '元素 disabled'}`);
  }

  /** 填写输入框（触发 input / change 事件） */
  async popupFill(testId, value) {
    const res = await this.popupEval(`(() => {
      const el = document.querySelector('[data-testid="${testId}"]');
      if (!el) return 'NOT_FOUND';
      el.focus();
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(String(value))});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()`);
    if (res !== 'ok') throw new Error(`填写 ${testId} 失败：元素不存在`);
  }

  /** 等待某个 testId 的文本包含 includes（任一同名元素满足即可） */
  async waitForText(testId, includes, timeoutMs = 10_000) {
    const t0 = Date.now();
    let last = [];
    while (Date.now() - t0 < timeoutMs) {
      last = await this.element(testId).catch(() => []);
      const hit = last.find((e) => e.visible && e.text.includes(includes));
      if (hit) return hit.text;
      await sleep(200);
    }
    throw new Error(`等待 ${testId} 文本包含「${includes}」超时（${timeoutMs}ms）；实际：${JSON.stringify(last.map((e) => (e.visible ? '' : '[隐藏]') + e.text)).slice(0, 300)}`);
  }

  /** 等待某个 testId 的属性满足条件 */
  async waitForAttr(testId, attr, accept, timeoutMs = 10_000) {
    const ok = Array.isArray(accept) ? (v) => accept.includes(v) : (v) => v === accept;
    const t0 = Date.now();
    let last = [];
    while (Date.now() - t0 < timeoutMs) {
      last = await this.element(testId).catch(() => []);
      const hit = last.find((e) => ok(e.attrs[attr]));
      if (hit) return hit.attrs[attr];
      await sleep(200);
    }
    throw new Error(`等待 ${testId} 的 ${attr} 为 ${JSON.stringify(accept)} 超时；实际：${JSON.stringify(last.map((e) => e.attrs[attr]))}`);
  }

  /** 等待某个 testId 的可见元素数量 ≥ min */
  async waitForCount(testId, min, timeoutMs = 10_000) {
    const t0 = Date.now();
    let n = 0;
    while (Date.now() - t0 < timeoutMs) {
      n = (await this.element(testId).catch(() => [])).filter((e) => e.visible).length;
      if (n >= min) return n;
      await sleep(200);
    }
    throw new Error(`等待 ${testId} 至少 ${min} 个可见元素超时；实际 ${n} 个`);
  }

  /** popup 截图（PNG）；返回写入的路径 */
  async screenshot(file) {
    if (!this.popupSession) throw new Error('popup 尚未打开');
    const { data } = await this.conn.send('Page.captureScreenshot', { format: 'png' }, this.popupSession);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  }

  /** popup 与 service worker 的 console / exception 日志 */
  collectLogs() { return { popup: [...this.logs.popup], sw: [...this.logs.sw], exceptions: [...this.exceptions] }; }

  async close() {
    try { await this.conn.send('Browser.close', {}, undefined, 5000); } catch { /* 已关闭 */ }
    this.conn.close();
    await sleep(300);
    try { this.proc.kill('SIGKILL'); } catch { /* ignore */ }
    fs.rmSync(this.profile, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------ 具名函数（与方法等价，便于按函数风格调用）

/** @param {RealPopupSession} s */ export const openRealPopup = (s, o) => s.openRealPopup(o);
/** @param {RealPopupSession} s @param {string} expr */ export const popupEval = (s, expr) => s.popupEval(expr);
/** @param {RealPopupSession} s @param {string} testId */ export const popupClick = (s, testId, o) => s.popupClick(testId, o);
/** @param {RealPopupSession} s */ export const popupFill = (s, testId, value) => s.popupFill(testId, value);
/** @param {RealPopupSession} s */ export const waitForText = (s, testId, includes, timeoutMs) => s.waitForText(testId, includes, timeoutMs);
/** @param {RealPopupSession} s */ export const screenshot = (s, file) => s.screenshot(file);
/** @param {RealPopupSession} s */ export const collectLogs = (s) => s.collectLogs();
/** @param {RealPopupSession} s */ export const close = (s) => s.close();
