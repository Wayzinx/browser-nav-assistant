// UI 用例的公共夹具：import { test, expect } from '../fixtures/extension.mjs'
// 在 api.mjs 的基础上扩展（UI 用例同样可以用 api 构造后端数据、核对后端状态，并且会自动 reset）。
//
// 提供：
//   context      每个测试独立的 persistent context，已加载 extension/（CONVENTIONS §5 已验证配方）
//   sw           插件 service worker
//   extensionId
//   ext          操作助手，见 ExtensionHelper
//
// 约束（lint-scripts.mjs 会检查）：
//   - 元素只能用 page.getByTestId(…) 定位，参数必须是 ui-contract 中登记的 testId
//   - 外部站点由本夹具默认离线化（返回只有 <title> 的页面）；绝不拦截后端 /api、localhost、127.0.0.1
//   - 后端不可达的场景用 ext.useUnreachableBackend()（把 API 地址指向一个没有服务的端口），不要 route 后端
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { test as apiTest, expect } from './api.mjs';
import { ROOT } from './evidence.mjs';

export { expect };
export * from './sample.mjs';

// 以下两个常量必须与 docs/trace/ui-contract.json 一致（storageKeys / pages[].path）
export const API_BASE_KEY = 'apiBaseUrl';
export const POPUP_PATH = 'popup/popup.html';
export const UNREACHABLE_BASE = 'http://127.0.0.1:9';

const EXT_DIR = process.env.EXT_DIR ? path.resolve(ROOT, process.env.EXT_DIR) : path.join(ROOT, 'extension');
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const stubHtml = (title, body = '') => `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`;

export class ExtensionHelper {
  constructor({ context, sw, extensionId, evidence, baseURL }) {
    Object.assign(this, { context, sw, extensionId, evidence, baseURL });
    this.popup = null;
  }

  get popupUrl() { return `chrome-extension://${this.extensionId}/${POPUP_PATH}`; }

  /** 以 tab 方式打开 popup（插件判断「当前页面」时必须排除插件自身页面） */
  async openPopup() {
    const page = await this.context.newPage();
    await page.goto(this.popupUrl);
    this.popup = page;
    return page;
  }

  /** 关闭再重新打开 popup，用于验证状态是否从 storage 恢复 */
  async reopenPopup() {
    if (this.popup && !this.popup.isClosed()) await this.popup.close();
    return this.openPopup();
  }

  async setApiBase(url) { await this.setStorage({ [API_BASE_KEY]: url }); }

  /** 后端不可达：把 API 地址指向没有服务监听的端口（真实的连接失败，不是 mock） */
  async useUnreachableBackend() { await this.setApiBase(UNREACHABLE_BASE); }

  async setStorage(obj) { await this.sw.evaluate((o) => chrome.storage.local.set(o), obj); }

  async getStorage(keys = null) { return this.sw.evaluate((k) => chrome.storage.local.get(k), keys); }

  /** 在 service worker 里执行任意代码（例如读取 chrome.tabs / chrome.history 做核对） */
  async swEval(fn, arg) { return this.sw.evaluate(fn, arg); }

  /** 写入浏览历史（访问时间为当前时间，无法指定 visitCount；需要旧页面时请用后端导入） */
  async seedHistory(urls) {
    await this.sw.evaluate(async (list) => { for (const url of list) await chrome.history.addUrl({ url }); }, urls);
  }

  /**
   * 给外部站点指定页面内容。map 的 key 是完整 URL 或 glob，value 是标题字符串或 { title, body }。
   * 未指定的外部站点也会被默认离线化（标题为 hostname）。
   */
  async mockSites(map) {
    for (const [pattern, v] of Object.entries(map)) {
      const { title, body } = typeof v === 'string' ? { title: v, body: '' } : v;
      await this.context.route(pattern, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: stubHtml(title, body) }));
    }
  }

  /** 依次在新 tab 中打开 URL（会产生真实的浏览历史），返回打开的 pages */
  async openTabs(urls) {
    const pages = [];
    for (const url of urls) {
      const p = await this.context.newPage();
      await p.goto(url, { waitUntil: 'domcontentloaded' });
      pages.push(p);
    }
    return pages;
  }

  /** 步骤截图，写入 evidence/<CaseID>/screenshots/，并参与合成 flow.gif */
  async snap(page, name) { return this.evidence.screenshot(page, name); }

  async finalShot() {
    const page = this.popup && !this.popup.isClosed() ? this.popup : null;
    if (page) { try { await this.evidence.screenshot(page, 'final'); } catch { /* 页面已不可用时跳过 */ } }
  }
}

async function dumpFrontendCoverage(context, caseId) {
  const dir = path.join(ROOT, 'coverage', '.fe-raw');
  fs.mkdirSync(dir, { recursive: true });
  const targets = [...context.serviceWorkers(), ...context.pages().filter((p) => p.url().startsWith('chrome-extension://'))];
  let i = 0;
  for (const t of targets) {
    try {
      const cov = await t.evaluate(() => globalThis.__coverage__ || null);
      if (cov) fs.writeFileSync(path.join(dir, `${caseId || 'NO-CASE'}-${process.pid}-${Date.now()}-${i++}.json`), JSON.stringify(cov));
    } catch { /* 目标已关闭 */ }
  }
}

export const test = apiTest.extend({
  context: async ({ evidence }, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium', // 必须使用 Playwright 自带的 Chromium；品牌版 Chrome 不支持 --load-extension
      headless: true,
      viewport: { width: 420, height: 760 },
      args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
    });
    // 外部站点默认离线化：只匹配非本机地址，后端请求不会进入这个 route
    await context.route(/^https?:\/\/(?!127\.0\.0\.1[:/]|localhost[:/])[^/]+/, (route) =>
      route.fulfill({ contentType: 'text/html; charset=utf-8', body: stubHtml(new URL(route.request().url()).hostname) }));
    const watchWorker = (w) => w.on('console', (m) => evidence.extLog('service-worker', m));
    context.serviceWorkers().forEach(watchWorker);
    context.on('serviceworker', watchWorker);
    context.on('page', (p) => {
      p.on('console', (m) => evidence.extLog(p.url().startsWith('chrome-extension://') ? 'popup' : 'page', m));
      p.on('pageerror', (e) => evidence.extLog('pageerror', e));
    });
    await use(context);
    if (process.env.COLLECT_COVERAGE) await dumpFrontendCoverage(context, evidence.caseId);
    await context.close();
  },

  sw: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    await use(sw);
  },

  extensionId: async ({ sw }, use) => { await use(new URL(sw.url()).host); },

  // false：不预写 apiBaseUrl，模拟首次安装（storage 为空）。用法：test.use({ presetApiBase: false })
  presetApiBase: [true, { option: true }],

  ext: async ({ context, sw, extensionId, evidence, baseURL, api, presetApiBase }, use) => {
    // 依赖 api：保证在打开插件之前后端已经 reset
    void api;
    const ext = new ExtensionHelper({ context, sw, extensionId, evidence, baseURL });
    if (presetApiBase) await ext.setApiBase(baseURL); // 默认指向本次测试启动的后端（TEST_PORT）
    else evidence.note('presetApiBase=false：未预写 apiBaseUrl，模拟首次安装（storage 为空）');
    await use(ext);
    await ext.finalShot();
  },
});
