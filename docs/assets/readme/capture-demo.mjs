#!/usr/bin/env node
// 生成 README 演示素材：在「真实 action popup」里操作插件并截图，合成拼图（JPEG）和流程动图（GIF）。
//
// 用法（项目根目录）：node docs/assets/readme/capture-demo.mjs
// 产物：docs/assets/readme/*.jpg、*.gif（覆盖写）；中间帧放在临时目录，结束后删除。
//
// 隔离：
//   - 后端：本脚本自己用随机端口启动（生产模式，不设 ENABLE_TEST_API / SNAPSHOT_FILE，数据只在内存），结束后 SIGTERM；
//   - 网页：github.com、developer.mozilla.org 等由本地 HTTPS 桩站点返回（临时自签证书），不访问外网；
//   - 浏览器所有请求都走本脚本的代理：插件默认地址 127.0.0.1:3000 一律断开（绝不连到本机真实运行的后端），其他未知地址拒绝。
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import gifenc from 'gifenc';
import { launchBrowser } from '../../../.agents/skills/nav-case-to-script/scripts/lib/real-popup.mjs';

const { GIFEncoder, quantize, applyPalette } = gifenc;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'readme-demo-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 400;
const H = 600;
const RULE_TEXT = '把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档';

// 演示用的网页（与 resource.json 一致；最后打开的 PR 页面就是「当前页面」）
const PAGES = [
  { url: 'https://github.com/org/repo/issues/123', title: 'Fix login redirect bug' },
  { url: 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API', title: 'Fetch API - Web APIs | MDN' },
  { url: 'https://docs.internal.com/ai-agent-design', title: 'AI Agent Design Guidelines' },
  { url: 'https://accounts.example.com/reset-password?token=8f2a91c', title: 'Reset your password' },
  { url: 'https://bank.example.com/account/overview', title: 'Account overview' },
  { url: 'https://github.com/org/repo/pull/456', title: 'Refactor auth middleware (#456)' },
];
const STUB_HOSTS = new Set(PAGES.map((p) => new URL(p.url).hostname));

const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

function startStubSite() {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(TMP, 'key.pem'), '-out', path.join(TMP, 'cert.pem'), '-days', '2', '-subj', '/CN=readme-demo'], { stdio: 'ignore' });
  const server = https.createServer({ key: fs.readFileSync(path.join(TMP, 'key.pem')), cert: fs.readFileSync(path.join(TMP, 'cert.pem')) }, (req, res) => {
    const page = PAGES.find((p) => { const u = new URL(p.url); return u.hostname === (req.headers.host || '').split(':')[0] && u.pathname + u.search === req.url; });
    res.writeHead(page ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><meta charset="utf-8"><title>${page ? page.title : 'Not found'}</title></head><body><h1>${page ? page.title : 'Not found'}</h1></body></html>`);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

async function startBackend() {
  const port = await freePort();
  const proc = spawn(process.execPath, ['server/src/index.js'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', LOG_FILE: path.join(TMP, 'server.log'), ENABLE_TEST_API: '', SNAPSHOT_FILE: '' } });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return { proc, port }; } catch { /* 还没起来 */ }
    await sleep(150);
  }
  proc.kill('SIGKILL');
  throw new Error('演示后端没有在 15 秒内就绪');
}

function startProxy(state) {
  const server = http.createServer((req, res) => {
    let u;
    try { u = new URL(req.url); } catch { req.socket.destroy(); return; }
    const loop = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
    if (loop && state.backendPort && Number(u.port) === state.backendPort) {
      const headers = { ...req.headers, host: `127.0.0.1:${state.backendPort}` };
      delete headers['proxy-connection'];
      const up = http.request({ host: '127.0.0.1', port: state.backendPort, method: req.method, path: u.pathname + u.search, headers }, (r) => { res.writeHead(r.statusCode || 502, r.headers); r.pipe(res); });
      up.on('error', () => req.socket.destroy());
      req.pipe(up);
      return;
    }
    req.socket.destroy(); // 包括插件默认地址 127.0.0.1:3000：一律断开
  });
  server.on('connect', (req, sock, head) => {
    const host = String(req.url).split(':')[0];
    if (!STUB_HOSTS.has(host)) { sock.destroy(); return; }
    const up = net.connect(state.stubPort, '127.0.0.1', () => { sock.write('HTTP/1.1 200 Connection Established\r\n\r\n'); up.write(head); up.pipe(sock); sock.pipe(up); });
    up.on('error', () => sock.destroy());
    sock.on('error', () => up.destroy());
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, address: `127.0.0.1:${server.address().port}` })));
}

// ------------------------------------------------------------------ 图像工具
const readPng = (file) => PNG.sync.read(fs.readFileSync(file));

function canvas(width, height, rgb = [238, 241, 245]) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) { data[i * 4] = rgb[0]; data[i * 4 + 1] = rgb[1]; data[i * 4 + 2] = rgb[2]; data[i * 4 + 3] = 255; }
  return { width, height, data };
}
function blit(dst, src, x0, y0) {
  for (let y = 0; y < src.height; y++) src.data.copy(dst.data, ((y0 + y) * dst.width + x0) * 4, y * src.width * 4, (y + 1) * src.width * 4);
}
function frame(dst, x0, y0, w, h, rgb = [208, 215, 222], t = 1) {
  const set = (x, y) => { const i = (y * dst.width + x) * 4; dst.data[i] = rgb[0]; dst.data[i + 1] = rgb[1]; dst.data[i + 2] = rgb[2]; };
  for (let k = 1; k <= t; k++) {
    for (let x = x0 - k; x < x0 + w + k; x++) { set(x, y0 - k); set(x, y0 + h - 1 + k); }
    for (let y = y0 - k; y < y0 + h + k; y++) { set(x0 - k, y); set(x0 + w - 1 + k, y); }
  }
}
function saveJpeg(img, file, quality = 82) {
  fs.writeFileSync(file, jpeg.encode({ width: img.width, height: img.height, data: img.data }, quality).data);
  return file;
}
/** 把若干张 popup 截图横向拼成一张（统一浅灰底，带细边框），输出 JPEG */
function montage(files, out) {
  const pad = 28;
  const gap = 28;
  const imgs = files.map(readPng);
  const w = pad * 2 + imgs.reduce((s, i) => s + i.width, 0) + gap * (imgs.length - 1);
  const h = pad * 2 + Math.max(...imgs.map((i) => i.height));
  const c = canvas(w, h);
  let x = pad;
  for (const img of imgs) { blit(c, img, x, pad); frame(c, x, pad, img.width, img.height); x += img.width + gap; }
  return saveJpeg(c, out);
}
/** 把一组截图做成 GIF（每帧停留 delay 毫秒） */
function makeGif(files, out, delay = 1600) {
  const gif = GIFEncoder();
  for (const f of files) {
    const img = readPng(f);
    const rgba = new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.length);
    const palette = quantize(rgba, 128);
    gif.writeFrame(applyPalette(rgba, palette), img.width, img.height, { palette, delay });
  }
  gif.finish();
  fs.writeFileSync(out, gif.bytes());
  return out;
}

// ------------------------------------------------------------------ 主流程
const cleanup = [];
let session;
try {
  const stub = await startStubSite();
  cleanup.push(() => stub.server.close());
  const backend = await startBackend();
  cleanup.push(() => { try { backend.proc.kill('SIGTERM'); } catch { /* 已退出 */ } });
  const state = { backendPort: backend.port, stubPort: stub.port };
  const proxy = await startProxy(state);
  cleanup.push(() => proxy.server.close());
  console.log(`演示后端 127.0.0.1:${backend.port}；桩站点 127.0.0.1:${stub.port}；代理 ${proxy.address}`);

  // 按 README 的方式导入样例数据（resource.json 平移到「最新一条 = 现在 − 5 分钟」）
  execFileSync(process.execPath, ['scripts/import-sample.mjs'], { cwd: ROOT, env: { ...process.env, API_BASE: `http://127.0.0.1:${backend.port}` }, stdio: 'ignore' });

  session = await launchBrowser({ extDir: path.join(ROOT, 'extension'), proxy: proxy.address, headless: true, windowSize: [1280, 900], extraArgs: ['--ignore-certificate-errors'] });
  const s = session;
  console.log(`浏览器：${s.version}；插件 ${s.extensionId}`);
  for (const p of PAGES) await s.openTab(p.url);
  // 浏览器启动时自带的 about:blank 关掉，避免它成为「当前页面」；之后每次打开 popup 前都把 PR 页面置为活动标签
  for (const t of await s.targets()) if (t.type === 'page' && t.url === 'about:blank') await s.closeTab(t.targetId);
  const CURRENT = PAGES[PAGES.length - 1].url;

  const shots = {};
  let n = 0;
  // popup 高度固定 600，内容区要靠滚动定位。anchor：testId 或 CSS 选择器（以 [ 开头）；index：取第几个匹配；
  // closest：从匹配元素向上找的容器；offset：元素上方留白。不传 anchor 时滚到顶部
  const snap = async (name, { settleMs = 700, anchor = null, index = 0, closest = null, offset = 10 } = {}) => {
    await sleep(settleMs);
    const sel = anchor && (anchor.startsWith('[') ? anchor : `[data-testid="${anchor}"]`);
    await s.popupEval(`(() => {
      const p = document.querySelector('.panels');
      let el = ${JSON.stringify(sel)} ? document.querySelectorAll(${JSON.stringify(sel)})[${index}] : null;
      if (el && ${JSON.stringify(closest)}) el = el.closest(${JSON.stringify(closest)}) || el;
      p.scrollTop = el ? el.getBoundingClientRect().top - p.getBoundingClientRect().top + p.scrollTop - ${offset} : 0;
      return p.scrollTop;
    })()`);
    await sleep(150);
    const { data } = await s.conn.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: W, height: H, scale: 1 } }, s.popupSession);
    const file = path.join(TMP, `${String(++n).padStart(2, '0')}-${name}.png`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    shots[name] = file;
    console.log(`  截图 ${name}`);
    return file;
  };
  const tab = async (name) => { await s.popupClick(`tab-${name}`); await sleep(400); };

  // 1) 首次安装后第一次点开：默认地址 127.0.0.1:3000 上没有后端（被代理断开），界面给出「后端未连接」与引导
  await s.openRealPopup({ focusUrl: CURRENT });
  const size = await s.popupSize();
  console.log(`真实 popup 尺寸：${size.innerWidth}×${size.innerHeight}`);
  await s.waitForAttr('connection-status', 'data-state', 'offline', 15_000);
  await snap('first-open', { settleMs: 1200 });

  // 2) 在诊断页把 API 地址改成实际启动的后端，重新检测：7 项检查全部通过
  await tab('diag');
  await s.popupFill('diag-api-base-url-input', `http://127.0.0.1:${backend.port}`);
  await s.popupClick('diag-api-base-url-save');
  await s.waitForCount('diag-api-base-url-saved', 1, 10_000);
  await s.waitForAttr('connection-status', 'data-state', 'online', 15_000);
  await s.popupClick('diag-rerun-button');
  await s.waitForAttr('diag-check-backend', 'data-status', 'ok', 15_000);
  await snap('diag', { settleMs: 1200 });
  await snap('diag-result', { anchor: 'diag-summary', offset: 46 });
  await tab('home');
  await snap('home-before', { settleMs: 1000 });

  // 2) 同步浏览器上下文：上传当前窗口的标签页和历史，含 token / bank 的 URL 在本地被过滤
  await s.popupClick('sync-button');
  await s.waitForAttr('sync-status', 'data-status', 'success', 20_000);
  await s.waitForCount('rec-item', 1, 10_000);
  await snap('home-synced', { settleMs: 1200 });

  // 3) 历史排序：分数与理由，展开第一条看评分明细
  await tab('ranked');
  await s.waitForCount('ranked-item', 3, 10_000);
  await snap('ranked');
  await s.popupClick('ranked-item-toggle');
  await snap('ranked-detail', { anchor: 'ranked-total', offset: 8 });

  // 4) 整理建议（无规则时）
  await tab('cleanup');
  await s.waitForCount('cleanup-item', 1, 10_000);
  await snap('cleanup-before-rules');

  // 5) 上下文：当前窗口标签页与最近历史，隐私 URL 标注「不上传」
  await tab('context');
  await s.waitForCount('context-tab-item', 3, 10_000);
  await snap('context', { anchor: 'context-tab-item', index: 2 });

  // 7) 自然语言规则：输入 → 解析预览 → 确认保存
  await tab('rules');
  await s.popupFill('rule-input', RULE_TEXT);
  await snap('rules-input');
  await s.popupClick('rule-parse-button');
  await s.waitForCount('rule-card', 2, 10_000);
  await snap('rules-preview', { anchor: 'rule-preview-list' });
  await s.popupClick('rule-save-button');
  await s.waitForCount('rules-item', 2, 10_000);
  await snap('rules-saved', { settleMs: 1200, anchor: 'rules-list', offset: 40 });

  // 8) 规则生效：整理建议里 GitHub issue 按 7 天规则归档、docs.internal.com 被保护
  await tab('cleanup');
  await s.waitForCount('cleanup-item-rule-tag', 1, 10_000);
  await snap('cleanup-with-rules', { settleMs: 1000, anchor: '[data-testid="cleanup-group-archive"] [data-testid="cleanup-item-rule-tag"]', closest: '[data-testid="cleanup-item"]', offset: 40 });
  await snap('cleanup-keep', { anchor: 'cleanup-group-keep' });
  await tab('home');
  await snap('home-with-rules', { settleMs: 1000, anchor: 'home-cleanup-summary', offset: 40 });

  // 9) 后端不可用：停掉演示后端，重新打开 popup，展示缓存 + 离线标识
  backend.proc.kill('SIGTERM');
  await sleep(1200);
  await s.closePopup();
  await s.openRealPopup({ focusUrl: CURRENT });
  await s.waitForAttr('connection-status', 'data-state', 'offline', 15_000);
  await snap('offline', { settleMs: 2500 });

  const exceptions = s.collectLogs().exceptions;
  if (exceptions.length) console.log(`⚠️ popup / SW 未捕获异常 ${exceptions.length} 个：${JSON.stringify(exceptions).slice(0, 300)}`);

  // ------------------------------------------------------------------ 合成素材
  const out = (f) => path.join(HERE, f);
  montage([shots['home-synced'], shots['ranked-detail'], shots['cleanup-before-rules']], out('hero.jpg'));
  montage([shots['rules-preview'], shots['cleanup-with-rules'], shots['cleanup-keep']], out('rules.jpg'));
  montage([shots['first-open'], shots['diag-result'], shots['context']], out('install-diag-context.jpg'));
  montage([shots['home-synced'], shots['offline']], out('online-offline.jpg'));
  makeGif(['first-open', 'diag', 'diag-result', 'home-before', 'home-synced', 'ranked', 'ranked-detail', 'cleanup-before-rules', 'context'].map((k) => shots[k]), out('demo-main.gif'));
  makeGif(['rules-input', 'rules-preview', 'rules-saved', 'cleanup-with-rules', 'cleanup-keep', 'home-with-rules'].map((k) => shots[k]), out('demo-rules.gif'), 1800);
  for (const f of ['hero.jpg', 'rules.jpg', 'install-diag-context.jpg', 'online-offline.jpg', 'demo-main.gif', 'demo-rules.gif']) console.log(`✔ ${path.relative(ROOT, out(f))}  ${(fs.statSync(out(f)).size / 1024).toFixed(0)} KB`);
  if (process.env.KEEP_FRAMES) console.log(`帧保留在 ${TMP}`);
} finally {
  if (session) await session.close().catch(() => {});
  for (const fn of cleanup.reverse()) { try { fn(); } catch { /* ignore */ } }
  if (!process.env.KEEP_FRAMES) fs.rmSync(TMP, { recursive: true, force: true });
}
