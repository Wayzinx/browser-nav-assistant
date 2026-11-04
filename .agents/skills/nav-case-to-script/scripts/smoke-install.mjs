#!/usr/bin/env node
// 真实安装冒烟（nav-case-to-script 技能）：模拟用户「全新安装插件 → 点击工具栏图标」的真实路径。
//
// 和 UI 用例的区别：
//   - 打开的是真实 action popup（chrome.action.openPopup），不是以 tab 方式打开 popup.html；
//   - 全新 profile、storage 为空，不预写 apiBaseUrl，插件使用默认后端地址；
//   - 后端以生产模式启动（不设 ENABLE_TEST_API），数据按 README 的方式导入。
//
// 网络隔离：浏览器所有请求（包括回环地址）都经过本脚本内置的转发代理：
//   - 插件默认地址 127.0.0.1:3000 / localhost:3000 → 按场景转发到冒烟后端或直接拒绝（绝不会连到本机 3000 端口上真实运行的服务）
//   - 冒烟后端自己的地址 → 转发
//   - 计划中声明的测试页面（*.smoke.test）→ 由代理直接返回桩页面
//   - 其他地址 → 拒绝（不访问外网）
//
// 用法：node .agents/skills/nav-case-to-script/scripts/smoke-install.mjs [--root=] [--browser=chromium|chrome|all]
//        [--scenarios=S1,S2] [--plan=tests/smoke/smoke-plan.json] [--headed] [--require-chrome] [--json] [--keep-artifacts]
// 输出：evidence/_smoke/<browser>/<scenario>/（result.json、NN-*.png、popup.log、sw.log），汇总 evidence/_smoke/summary.json。
// 退出码：0 = 必需浏览器上的必需场景全部通过。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './lib/real-popup.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '../../../..');
const DEFAULT_PORTS = new Set(['3000']); // 插件默认后端端口（extension/shared/constants.js DEFAULT_API_BASE）
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');
const slug = (s) => String(s).replace(/[^a-zA-Z0-9一-龥]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

// ------------------------------------------------------------------ 参数
const argv = process.argv.slice(2);
const opt = (k, d) => { const a = argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const flag = (k) => argv.includes(`--${k}`);
const ROOT = opt('root') ? path.resolve(opt('root')) : DEFAULT_ROOT;
const JSON_OUT = flag('json');
const say = (...a) => (JSON_OUT ? process.stderr : process.stdout).write(a.join(' ') + '\n');

// ------------------------------------------------------------------ 工具
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
    s.on('error', reject);
  });
}

const subst = (v, vars) => (typeof v === 'string' ? v.replace(/\$\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : v);
const getPath = (obj, p) => String(p).split('.').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), obj);

// ------------------------------------------------------------------ 后端（生产模式）
async function startBackend(dir) {
  const port = await freePort();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-backend-'));
  const logFile = path.join(dir, 'server.log');
  fs.mkdirSync(dir, { recursive: true });
  fs.rmSync(logFile, { force: true });
  const errFile = path.join(dir, 'server.stderr.log');
  const err = fs.openSync(errFile, 'w');
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', LOG_FILE: logFile, LOG_LEVEL: 'info', SNAPSHOT_FILE: path.join(tmp, 'snapshot.json') };
  delete env.ENABLE_TEST_API; // 生产模式：不暴露测试接口
  const proc = spawn(process.execPath, ['server/src/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'ignore', err] });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 75; i++) {
    if (proc.exitCode !== null) break;
    try { const r = await fetch(`${url}/api/health`); if (r.ok) return { port, url, proc, tmp, logFile }; } catch { /* 未就绪 */ }
    await sleep(200);
  }
  try { proc.kill('SIGKILL'); } catch { /* ignore */ }
  throw new Error(`冒烟后端启动失败（端口 ${port}）：${fs.readFileSync(errFile, 'utf8').slice(-800)}`);
}

async function stopBackend(b) {
  if (!b) return;
  try { b.proc.kill('SIGTERM'); } catch { /* ignore */ }
  for (let i = 0; i < 25 && b.proc.exitCode === null; i++) await sleep(200);
  if (b.proc.exitCode === null) try { b.proc.kill('SIGKILL'); } catch { /* ignore */ }
  if (!flag('keep-artifacts')) fs.rmSync(b.tmp, { recursive: true, force: true });
}

// ------------------------------------------------------------------ 转发代理（网络隔离）
function startProxy(pages) {
  const state = { mode: 'down', backendPort: null, seen: [] };
  const byUrl = new Map(pages.map((p) => [p.url.replace(/\/$/, ''), p]));
  const stubHosts = new Set(pages.map((p) => new URL(p.url).host));
  const forward = (req, res, port, u) => {
    const headers = { ...req.headers, host: `127.0.0.1:${port}` };
    delete headers['proxy-connection'];
    const up = http.request({ host: '127.0.0.1', port, method: req.method, path: u.pathname + u.search, headers }, (r) => {
      res.writeHead(r.statusCode || 502, r.headers);
      r.pipe(res);
    });
    up.on('error', () => req.socket.destroy());
    req.pipe(up);
  };
  const server = http.createServer((req, res) => {
    let u;
    try { u = new URL(req.url); } catch { req.socket.destroy(); return; }
    const isLoop = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
    state.seen.push(`${req.method} ${u.host}${u.pathname}`);
    if (isLoop && DEFAULT_PORTS.has(u.port)) {
      // 插件默认地址：后端已启动的场景转发到冒烟后端，其余场景模拟「后端未启动」（直接断开连接）
      if (state.mode === 'default' && state.backendPort) return forward(req, res, state.backendPort, u);
      req.socket.destroy();
      return;
    }
    if (isLoop && state.backendPort && Number(u.port) === state.backendPort) return forward(req, res, state.backendPort, u);
    if (stubHosts.has(u.host)) {
      const p = byUrl.get(`${u.origin}${u.pathname}`.replace(/\/$/, ''));
      if (!p) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html><head><meta charset="utf-8"><title>${p.title}</title></head><body><h1>${p.title}</h1><p>${p.body || ''}</p></body></html>`);
      return;
    }
    req.socket.destroy(); // 外网与其他地址一律拒绝
  });
  server.on('connect', (req, sock) => { state.seen.push(`CONNECT ${req.url}`); sock.destroy(); });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, address: `127.0.0.1:${server.address().port}` })));
}

// ------------------------------------------------------------------ 步骤执行
async function runStep(step, ctx) {
  const s = ctx.session;
  const v = (x) => subst(x, ctx.vars);
  const t = step.timeoutMs || 10_000;
  switch (step.type) {
    case 'visit': {
      for (const url of step.urls.map(v)) {
        const id = await s.openTab(url);
        if (step.keepOpen === false) await s.closeTab(id);
      }
      return `打开 ${step.urls.length} 个页面（${step.keepOpen === false ? '随后关闭，只留历史' : '保持打开'}）`;
    }
    case 'importSample': {
      const r = await new Promise((resolve) => {
        const p = spawn(process.execPath, ['scripts/import-sample.mjs'], { cwd: ROOT, env: { ...process.env, API_BASE: ctx.vars.BACKEND_URL } });
        let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
        p.on('close', (code) => resolve({ code, out }));
      });
      if (r.code !== 0) throw new Error(`导入样例失败（exit ${r.code}）：${r.out.slice(-400)}`);
      return r.out.trim().split('\n').slice(-2).join(' ').slice(0, 200);
    }
    case 'openPopup': {
      await s.openRealPopup();
      return `已打开真实 action popup（${s.extensionId}）`;
    }
    case 'assertPopupSize': {
      const minW = step.minWidth ?? ctx.plan.popup.minWidth;
      const minH = step.minHeight ?? ctx.plan.popup.minHeight;
      // 真实 popup 的视口由内容撑开，稍等布局稳定后再量
      let size;
      for (let i = 0; i < 6; i++) { size = await s.popupSize(); if (size.innerWidth >= minW && size.innerHeight >= minH) break; await sleep(300); }
      ctx.popupSize = [size.innerWidth, size.innerHeight];
      if (size.innerWidth < minW || size.innerHeight < minH) {
        throw new Error(`真实 popup 尺寸 ${size.innerWidth}×${size.innerHeight}，低于下限 ${minW}×${minH}（文档 ${size.docWidth}×${size.docHeight}，body ${size.bodyWidth}×${size.bodyHeight}）。常见原因：popup 根元素用了 vw / vh / dvh 等视口单位定尺寸，真实 popup 打开瞬间视口接近 0，界面会塌缩`);
      }
      return `${size.innerWidth}×${size.innerHeight}`;
    }
    case 'assertVisible': {
      const missing = [];
      for (const id of step.testIds) { const els = await s.element(id); if (!els.some((e) => e.visible)) missing.push(id); }
      if (missing.length) throw new Error(`以下元素不可见：${missing.join(', ')}`);
      return `${step.testIds.length} 个元素可见`;
    }
    case 'waitVisible': return `可见 ${await s.waitForCount(step.testId, 1, t)} 个`;
    case 'waitCount': return `可见 ${await s.waitForCount(step.testId, step.min, t)} 个（要求 ≥ ${step.min}）`;
    case 'waitText': return (await s.waitForText(step.testId, v(step.includes), t)).slice(0, 120);
    case 'waitNonEmpty': return (await s.waitForText(step.testId, '', t)).slice(0, 120);
    case 'waitAttr': return `${step.attr}=${await s.waitForAttr(step.testId, step.attr, step.equals ?? step.in, t)}`;
    case 'click': await s.popupClick(step.testId, { index: step.index || 0 }); if (step.settleMs) await sleep(step.settleMs); return `点击 ${step.testId}`;
    case 'fill': await s.popupFill(step.testId, v(step.value)); return `填写 ${step.testId}`;
    case 'screenshot': {
      const file = path.join(ctx.dir, `${pad(++ctx.shot)}-${slug(step.name || 'shot')}.png`);
      await s.screenshot(file);
      ctx.screenshots.push(path.relative(ROOT, file));
      return path.relative(ROOT, file);
    }
    case 'api': {
      const r = await fetch(`${ctx.vars.BACKEND_URL}${v(step.path)}`, { method: step.method || 'GET', headers: step.body ? { 'content-type': 'application/json' } : {}, body: step.body ? JSON.stringify(step.body) : undefined });
      const text = await r.text();
      let body = null; try { body = JSON.parse(text); } catch { /* 非 JSON */ }
      const exp = step.expect || {};
      if (exp.status && r.status !== exp.status) throw new Error(`${step.path} 返回 ${r.status}，期望 ${exp.status}`);
      for (const c of exp.checks || []) {
        const val = getPath(body, c.path);
        const n = Array.isArray(val) ? val.length : val;
        if ('equals' in c && val !== c.equals) throw new Error(`${step.path} 的 ${c.path}=${JSON.stringify(val)}，期望 ${JSON.stringify(c.equals)}`);
        if ('gte' in c && !(n >= c.gte)) throw new Error(`${step.path} 的 ${c.path}=${JSON.stringify(n)}，期望 ≥ ${c.gte}`);
      }
      return `${step.method || 'GET'} ${step.path} → ${r.status}`;
    }
    default: throw new Error(`smoke-plan 中有未知的步骤类型：${step.type}`);
  }
}

async function runScenario(browser, sc, plan, backend, proxy) {
  const dir = path.join(ROOT, 'evidence', '_smoke', browser, sc.id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const result = { browser, scenario: `${sc.id} ${sc.name}`, id: sc.id, pass: false, required: sc.required !== false, popupSize: null, errors: [], steps: [], screenshots: [], startedAt: new Date().toISOString() };
  proxy.state.mode = sc.backend || 'down';
  proxy.state.backendPort = backend ? backend.port : null;
  const vars = { BACKEND_URL: backend ? backend.url : '', BACKEND_PORT: backend ? backend.port : '', DEFAULT_BASE: 'http://127.0.0.1:3000' };
  const startUrl = subst(sc.startUrl || plan.pages[0].url, vars);
  let session = null;
  const ctx = { plan, dir, vars, shot: 0, screenshots: result.screenshots, popupSize: null, session: null };
  try {
    session = await launchBrowser({ extDir: path.join(ROOT, 'extension'), browser, startUrl, proxy: proxy.address, headless: !flag('headed') });
    ctx.session = session;
    result.version = session.version;
    let failed = false;
    for (const [i, step] of sc.steps.entries()) {
      const name = `${i + 1}. ${step.name || step.type}`;
      if (failed) { result.steps.push({ name, pass: null, detail: '跳过（前序步骤失败）' }); continue; }
      try {
        const detail = await runStep(step, ctx);
        result.steps.push({ name, pass: true, detail });
      } catch (e) {
        failed = true;
        result.steps.push({ name, pass: false, detail: e.message });
        result.errors.push(`[${browser}/${sc.id} ${sc.name}] 步骤 ${name}：${e.message}`);
        if (session.popupSession) await runStep({ type: 'screenshot', name: `失败-${step.name || step.type}` }, ctx).catch(() => {});
      }
    }
    const logs = session.collectLogs();
    if (logs.exceptions.length) result.errors.push(`[${browser}/${sc.id} ${sc.name}] popup / service worker 出现 ${logs.exceptions.length} 个未捕获异常：${logs.exceptions.slice(0, 3).map((x) => `${x.source}: ${x.text.split('\n')[0]}`).join('；')}`);
    fs.writeFileSync(path.join(dir, 'popup.log'), logs.popup.map((l) => JSON.stringify(l)).join('\n') + '\n');
    fs.writeFileSync(path.join(dir, 'sw.log'), logs.sw.map((l) => JSON.stringify(l)).join('\n') + '\n');
    result.exceptions = logs.exceptions.length;
    result.consoleErrors = [...logs.popup, ...logs.sw].filter((l) => l.type === 'error').length;
  } catch (e) {
    result.errors.push(`[${browser}/${sc.id} ${sc.name}] 浏览器或扩展启动失败：${e.message}`);
  } finally {
    if (session) await session.close();
  }
  result.popupSize = ctx.popupSize;
  result.pass = result.errors.length === 0;
  result.endedAt = new Date().toISOString();
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
  return result;
}

// ------------------------------------------------------------------ 主流程
async function main() {
  const planFile = path.resolve(ROOT, opt('plan', 'tests/smoke/smoke-plan.json'));
  const summary = { pass: false, generatedAt: new Date().toISOString(), root: ROOT, plan: path.relative(ROOT, planFile), browsers: {}, results: [], errors: [], warnings: [] };
  const outDir = path.join(ROOT, 'evidence', '_smoke');
  const finish = (code) => {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
    if (JSON_OUT) process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    else {
      for (const r of summary.results) {
        say(`${r.pass ? '✔' : '✖'} ${r.browser} ${r.scenario}${r.popupSize ? `  popup ${r.popupSize.join('×')}` : ''}`);
        for (const st of r.steps) say(`   ${st.pass === true ? '✔' : st.pass === false ? '✖' : '·'} ${st.name}：${String(st.detail).slice(0, 160)}`);
      }
      for (const [b, info] of Object.entries(summary.browsers)) say(`${b}：${info.skipped ? `跳过（${info.reason}）` : info.pass ? '通过' : '未通过'}${info.version ? `（${info.version}）` : ''}`);
      for (const e of summary.errors) say(`✖ ${e}`);
      for (const w of summary.warnings) say(`⚠ ${w}`);
      say(`\n结果：${summary.pass ? '✔ 通过' : '✖ 未通过'}。详情见 evidence/_smoke/summary.json`);
    }
    process.exit(code);
  };
  if (!fs.existsSync(planFile)) { summary.errors.push(`缺少冒烟计划 ${path.relative(ROOT, planFile)}`); return finish(1); }
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  plan.popup = { minWidth: 360, minHeight: 400, ...(plan.popup || {}) };
  const wanted = opt('scenarios') ? opt('scenarios').split(',') : null;
  const scenarios = plan.scenarios.filter((s) => !wanted || wanted.includes(s.id));
  const browserArg = opt('browser', 'chromium');
  const browsers = browserArg === 'all' ? ['chromium', 'chrome'] : [browserArg];
  const requireChrome = flag('require-chrome') || browserArg === 'chrome';
  const proxy = await startProxy(plan.pages || []);
  try {
    for (const browser of browsers) {
      fs.rmSync(path.join(outDir, browser), { recursive: true, force: true });
      let backend = null;
      try {
        backend = await startBackend(path.join(outDir, browser));
        say(`[${browser}] 冒烟后端 ${backend.url}（生产模式，快照写入临时目录）`);
        const results = [];
        for (const sc of scenarios) {
          say(`[${browser}] 场景 ${sc.id} ${sc.name} …`);
          const r = await runScenario(browser, sc, plan, backend, proxy);
          results.push(r);
          // 品牌版 Chrome 无法加载扩展时，整个浏览器记为跳过
          if (browser === 'chrome' && r.errors.some((e) => /浏览器或扩展启动失败/.test(e)) && !requireChrome) {
            summary.browsers.chrome = { skipped: true, reason: r.errors[0].replace(/^\[[^\]]+\]\s*/, '') };
            break;
          }
        }
        if (summary.browsers[browser]?.skipped) continue;
        summary.results.push(...results);
        const required = browser === 'chromium' || requireChrome;
        const pass = results.every((r) => r.pass || !r.required);
        summary.browsers[browser] = { pass, required, version: results.find((r) => r.version)?.version || '' };
        for (const r of results) {
          if (r.pass) continue;
          (required && r.required ? summary.errors : summary.warnings).push(...r.errors);
        }
      } catch (e) {
        if (browser === 'chrome' && !requireChrome) summary.browsers.chrome = { skipped: true, reason: e.message };
        else { summary.browsers[browser] = { pass: false, required: true }; summary.errors.push(`[${browser}] ${e.message}`); }
      } finally {
        await stopBackend(backend);
      }
    }
  } finally {
    proxy.server.close();
  }
  const leaked = proxy.state.seen.filter((x) => /:3000\//.test(x)).length;
  if (leaked) summary.warnings.push(`插件向默认地址 127.0.0.1:3000 发出了 ${leaked} 个请求，全部由冒烟代理处理（未连接本机 3000 端口上的真实服务）`);
  summary.pass = summary.errors.length === 0 && Object.values(summary.browsers).some((b) => b.pass);
  finish(summary.pass ? 0 : 1);
}

main().catch((e) => {
  const summary = { pass: false, generatedAt: new Date().toISOString(), browsers: {}, results: [], errors: [`冒烟脚本异常：${e.stack || e.message}`], warnings: [] };
  if (JSON_OUT) process.stdout.write(JSON.stringify(summary, null, 2) + '\n'); else console.error(summary.errors[0]);
  process.exit(1);
});
