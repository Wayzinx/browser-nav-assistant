// 为「重新检测重新执行 11 项」用例准备 Istanbul 插桩的扩展副本：
// 复制 extension/ → 临时目录 → 对每个 .js 只增加执行计数（业务返回值不变）→ 用本条专属的 persistent context 加载副本。
// 依赖 istanbul-lib-instrument：优先从隔离工具目录（NAV_DIAG_TOOL_DIR，默认 <tmp>/nav-diag-coverage-tools），
// 其次仓库 node_modules。解析 / 插桩失败不静默跳过：记录到 instrumentation.error，由用例显式失败。
// 固化说明（UI 探索）：
//   1) 插桩参数复用 collect-coverage.mjs 配方（coverageGlobalScope=globalThis、coverageGlobalScopeFunc=false），
//      否则 istanbul 生成 new Function，被 MV3 CSP（script-src 'self'）拦截，插件页面直接报 EvalError；
//   2) 不再在模块顶层改 process.env.EXT_DIR：顶层副作用会在 runner 主进程收集用例时执行并泄漏给所有 worker，
//      导致同批其他 UI 用例加载到插桩副本（且副本随后被本条删除）。改为只在本条的 context 夹具里按需插桩。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TOOL_DIR = process.env.NAV_DIAG_TOOL_DIR || path.join(os.tmpdir(), 'nav-diag-coverage-tools');

export const instrumentation = { dir: null, error: null, lastResolveError: null };

function walkJs(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJs(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function resolveInstrumenter() {
  const requireFrom = [path.join(TOOL_DIR, 'package.json'), path.join(ROOT, 'package.json')];
  for (const from of requireFrom) {
    try {
      return createRequire(from)('istanbul-lib-instrument');
    } catch (error) { // lint-allow-catch: 某个解析位置没有依赖时继续尝试下一个，全部失败才由调用方显式报错
      instrumentation.lastResolveError = `${from}: ${error.message}`;
    }
  }
  return null;
}

function instrumentExtension() {
  const lib = resolveInstrumenter();
  if (!lib) {
    instrumentation.error = `缺少 istanbul-lib-instrument：请安装到隔离工具目录（不改产品 package.json）；最后解析错误：${instrumentation.lastResolveError}`;
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-diag-instr-'));
  fs.cpSync(path.join(ROOT, 'extension'), dir, { recursive: true });
  const instrumenter = lib.createInstrumenter({ esModules: true, coverageVariable: '__coverage__', coverageGlobalScope: 'globalThis', coverageGlobalScopeFunc: false, produceSourceMap: false });
  for (const file of walkJs(dir)) {
    const code = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, instrumenter.instrumentSync(code, file));
  }
  instrumentation.dir = dir;
}

const stubHtml = (title) => `<!doctype html><html><head><meta charset="utf-8"><title>${String(title).replace(/[&<>"]/g, '')}</title></head><body></body></html>`;

/**
 * 供 TC-UI-DIAG-026 覆盖夹具 context 使用：插桩副本 → 独立 persistent Chromium（channel=chromium）加载。
 * 与 tests/fixtures/extension.mjs 的 context 保持一致：外站离线（不匹配 127.0.0.1 / localhost）、SW 与页面日志写入证据。
 * 插桩失败时抛错，本条不能宣称已验证重新执行。
 */
export async function launchInstrumentedContext(evidence) {
  if (!instrumentation.dir && !instrumentation.error) instrumentExtension();
  if (instrumentation.error) throw new Error(`插桩不可用，本条不能宣称已验证重新执行：${instrumentation.error}`);
  const { chromium } = await import('@playwright/test');
  const extDir = instrumentation.dir;
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    viewport: { width: 420, height: 760 },
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1[:/]|localhost[:/])[^/]+/, (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: stubHtml(new URL(route.request().url()).hostname) }));
  const watchWorker = (w) => w.on('console', (m) => evidence.extLog('service-worker', m));
  context.serviceWorkers().forEach(watchWorker);
  context.on('serviceworker', watchWorker);
  context.on('page', (p) => {
    p.on('console', (m) => evidence.extLog(p.url().startsWith('chrome-extension://') ? 'popup' : 'page', m));
    p.on('pageerror', (e) => evidence.extLog('pageerror', e));
  });
  return context;
}

/** 先关 context 再删除本条临时扩展副本（finally 顺序：context → 临时目录） */
export async function closeInstrumentedContext(context) {
  await context.close();
  if (instrumentation.dir) fs.rmSync(instrumentation.dir, { recursive: true, force: true });
  instrumentation.dir = null;
}

/** 读取 service worker 的 coverage 快照（JSON 化，避免跨进程代理对象） */
export function coverageSnapshot(sw) {
  return sw.evaluate(() => JSON.parse(JSON.stringify(globalThis.__coverage__ || {})));
}

const lineStarts = (text) => {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
};

const locToOffset = (text, loc) => (lineStarts(text)[loc.line - 1] || 0) + loc.column;

const fileData = (snapshot, rel) => {
  const entry = Object.entries(snapshot || {}).find(([file]) => file.endsWith(rel));
  return entry ? entry[1] : null;
};

/** 某次快照里名字为 name 的函数执行次数之和（runDiagnostics / safeCheck / checkXxx） */
export function fnCountByName(snapshot, name) {
  let total = 0;
  for (const data of Object.values(snapshot || {})) {
    for (const [key, fn] of Object.entries(data.fnMap || {})) if (fn.name === name) total += data.f[key] || 0;
  }
  return total;
}

/** rel 文件里「markerOffset 之后出现的第一个函数」的执行次数（用来定位 safeCheck 的回调） */
export function fnCountAfter(snapshot, rel, source, markerOffset) {
  const data = fileData(snapshot, rel);
  if (!data) return 0;
  let best = null;
  for (const [key, fn] of Object.entries(data.fnMap || {})) {
    const start = locToOffset(source, fn.decl.start);
    if (start <= markerOffset) continue;
    if (!best || start < best.start) best = { start, count: data.f[key] || 0 };
  }
  return best ? best.count : 0;
}

/** 在 extension/ 源码里定位每个检查项 id 在 safeCheck(...) 调用中的位置 */
export function locateCheckMarkers(labels) {
  const files = walkJs(path.join(ROOT, 'extension'));
  const found = {};
  for (const label of labels) {
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      const inSafeCheck = source.search(new RegExp(`safeCheck\\(\\s*['"]${label}['"]`));
      const fallback = source.includes('safeCheck(') ? source.search(new RegExp(`['"]${label}['"]`)) : -1;
      const marker = inSafeCheck >= 0 ? inSafeCheck : fallback;
      if (marker >= 0) {
        found[label] = { rel: path.relative(path.join(ROOT, 'extension'), file), source, marker };
        break;
      }
    }
  }
  return found;
}
