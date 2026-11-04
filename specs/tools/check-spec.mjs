#!/usr/bin/env node
// 前后端代码规范的机检部分（specs/backend.spec.md、specs/frontend.spec.md 中标注为「机检」的规则）。
// 用法：node specs/tools/check-spec.mjs [--side=be|fe|all] [--root=<项目根目录>] [--json]
// 输出：<root>/docs/quality/spec-check-<side>.json，结构为 { side, status, pass, errors: [{ rule, file, line, message }], warnings, stats }
// 退出码：0 表示没有 error（warning 不影响退出码）。server/ 或 extension/ 不存在时，该侧记为「尚未实现」并视为通过。
// 只实现误报率低的规则；启发式规则一律报 warning。零依赖，Node 24。
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (k, d) => { const a = argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const ROOT = opt('root') ? path.resolve(opt('root')) : path.resolve(HERE, '../..');
const SIDE = opt('side', 'all');
const AS_JSON = argv.includes('--json');

const MAX_LINES = 300;
const BUILTINS = new Set(builtinModules.map((m) => m.replace(/^node:/, '')));
const IO_MODULES = new Set(['http', 'https', 'http2', 'net', 'tls', 'dgram', 'fs', 'fs/promises', 'child_process', 'worker_threads', 'cluster']);
const FE_ALLOWED_PERMISSIONS = new Set(['tabs', 'history', 'storage', 'activeTab', 'contextMenus', 'alarms']);
const FE_REQUIRED_PERMISSIONS = ['tabs', 'history', 'storage', 'activeTab'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'test-results', 'playwright-report', 'coverage']);
const KEBAB_FILE = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+)*$/;
const KEBAB_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ---------------------------------------------------------------- 工具

const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readJson = (rel) => { try { return JSON.parse(read(rel)); } catch { return null; } };

function walk(rel, exts, out = []) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return out;
  if (fs.statSync(abs).isFile()) { if (exts.some((e) => rel.endsWith(e))) out.push(rel); return out; }
  for (const name of fs.readdirSync(abs).sort()) {
    if (SKIP_DIRS.has(name) || name.startsWith('.')) continue;
    walk(path.posix.join(rel, name), exts, out);
  }
  return out;
}

/** 把注释替换成空格（保留换行和字符串内容），让行号不变。不处理正则字面量：只可能漏报，不会误报。 */
function stripComments(src) {
  let out = '';
  let state = null; // null | 'line' | 'block' | 引号字符
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const nx = src[i + 1];
    if (state === null) {
      if (ch === '/' && nx === '/') { state = 'line'; out += '  '; i++; continue; }
      if (ch === '/' && nx === '*') { state = 'block'; out += '  '; i++; continue; }
      if (ch === '\'' || ch === '"' || ch === '`') state = ch;
      out += ch;
      continue;
    }
    if (state === 'line') { if (ch === '\n') { state = null; out += '\n'; } else out += ' '; continue; }
    if (state === 'block') {
      if (ch === '*' && nx === '/') { state = null; out += '  '; i++; continue; }
      out += ch === '\n' ? '\n' : ' ';
      continue;
    }
    if (ch === '\\') { out += ch + (nx ?? ''); i++; continue; }
    if (ch === state) state = null;
    else if (ch === '\n' && state !== '`') state = null; // 未闭合的单行字符串到行尾结束
    out += ch;
  }
  return out;
}

const stripHtmlComments = (src) => src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

function importSpecifiers(code) {
  const res = [];
  const patterns = [
    /\bimport\s+(?:[\w*$\s{},]+?\s+from\s+)?(['"])([^'"\n]+)\1/g,
    /\bexport\s+(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s+(['"])([^'"\n]+)\1/g,
    /\bimport\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g,
  ];
  for (const re of patterns) for (const m of code.matchAll(re)) res.push({ spec: m[2], index: m.index });
  return res;
}

function makeReport(side) {
  const r = { side, status: 'checked', pass: true, errors: [], warnings: [], stats: { files: 0, lines: 0, byRule: {} } };
  const add = (list) => (rule, file, line, message) => {
    list.push({ rule, file, line: line || null, message });
    r.stats.byRule[rule] = (r.stats.byRule[rule] || 0) + 1;
  };
  r.error = add(r.errors);
  r.warn = add(r.warnings);
  return r;
}

function finish(r) {
  r.pass = r.errors.length === 0;
  r.stats.errorCount = r.errors.length;
  r.stats.warningCount = r.warnings.length;
  delete r.error; delete r.warn;
  r.generatedAt = new Date().toISOString();
  return r;
}

/** 在 code 中查找 re 的每个匹配，报到对应行 */
function each(code, re, fn) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  for (const m of code.matchAll(g)) fn(m, lineOf(code, m.index));
}

function checkCommonStyle(r, rel, src, code, prefix) {
  const lines = src.split('\n').length;
  r.stats.lines += lines;
  if (lines > MAX_LINES) r.warn(`${prefix}-STYLE-04`, rel, null, `文件 ${lines} 行，超过 ${MAX_LINES} 行，请按职责拆分`);
  each(code, /\bexport\s+default\b/, (_m, line) => r.warn(`${prefix}-STYLE-02`, rel, line, '使用具名导出，不要 export default'));
  each(code, /(^|[;{}()\s])var\s+[A-Za-z_$]/m, (_m, line) => r.warn(`${prefix}-STYLE-03`, rel, line, '用 const / let 代替 var'));
  const base = path.basename(rel).replace(/\.(m?js|cjs|html|css)$/, '');
  if (!KEBAB_FILE.test(base)) r.warn(`${prefix}-${prefix === 'BE' ? 'NAME-01' : 'DIR-04'}`, rel, null, `文件名「${path.basename(rel)}」应使用 kebab-case`);
}

// ---------------------------------------------------------------- 后端

function checkBackend() {
  const r = makeReport('be');
  if (!exists('server')) {
    r.status = 'not_implemented';
    r.message = 'server/ 尚未实现，跳过后端规范检查';
    return finish(r);
  }
  const files = walk('server', ['.js', '.mjs', '.cjs']);
  const scriptFiles = walk('scripts', ['.js', '.mjs', '.cjs']);
  r.stats.files = files.length + scriptFiles.length;
  const srcFiles = files.filter((f) => f.startsWith('server/src/'));
  const codeOf = new Map();

  for (const rel of [...files, ...scriptFiles]) {
    const src = read(rel);
    const code = stripComments(src);
    codeOf.set(rel, code);
    const inServer = rel.startsWith('server/');
    const layer = (rel.match(/^server\/src\/(domain|store|services|routes|lib)\//) || [])[1] || null;
    const depReport = inServer ? r.error : r.warn;

    // BE-DIR-03 / BE-DIR-04 / BE-DIR-05 / BE-SEC-01：import 检查
    for (const { spec, index } of importSpecifiers(code)) {
      const line = lineOf(code, index);
      if (spec.startsWith('node:')) {
        const mod = spec.slice(5);
        if (mod === 'child_process') r.error('BE-SEC-01', rel, line, '禁止使用 child_process');
        else if (layer === 'domain' && IO_MODULES.has(mod)) r.error('BE-DIR-04', rel, line, `domain/ 是纯函数层，禁止 import ${spec}`);
        continue;
      }
      if (spec.startsWith('.') || spec.startsWith('/')) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
        const tLayer = (target.match(/^server\/src\/(domain|store|services|routes|lib)\b/) || [])[1] || (target === 'server/src/app.js' ? 'app' : null);
        const forbidden = { domain: ['store', 'services', 'routes', 'app'], store: ['services', 'routes', 'app'], services: ['routes', 'app'] }[layer] || [];
        if (tLayer && forbidden.includes(tLayer)) r.error('BE-DIR-05', rel, line, `${layer}/ 不能依赖 ${tLayer === 'app' ? 'app.js' : tLayer + '/'}（依赖方向：routes → services → domain / store）`);
        continue;
      }
      const head = spec.split('/')[0];
      if (BUILTINS.has(spec) || BUILTINS.has(head)) depReport('BE-DIR-03', rel, line, `内置模块必须带 node: 前缀：'node:${spec}'`);
      else depReport('BE-DIR-03', rel, line, `禁止第三方依赖「${spec}」（后端零运行时依赖）`);
    }
    each(code, /(^|[^.\w$])require\s*\(/, (_m, line) => depReport('BE-DIR-03', rel, line, '后端使用 ESM，禁止 require()'));
    if (!inServer) continue;

    // BE-LOG-04
    if (rel !== 'server/src/lib/logger.js') each(code, /\bconsole\.(?:log|info|warn|error|debug|trace|dir|table)\s*\(/, (_m, line) => r.error('BE-LOG-04', rel, line, '业务代码禁止使用 console.*，请使用 lib/logger.js'));
    // BE-TIME-01
    if (rel !== 'server/src/lib/clock.js') {
      each(code, /\bDate\.now\s*\(/, (_m, line) => r.error('BE-TIME-01', rel, line, 'Date.now() 只能出现在 lib/clock.js，其他地方通过 clock 获取当前时间'));
      if (rel !== 'server/src/lib/logger.js') each(code, /\bnew\s+Date\s*\(\s*\)/, (_m, line) => (layer === 'domain'
        ? r.error('BE-TIME-01', rel, line, 'domain/ 禁止读取系统时间（new Date()），当前时间由调用方传入')
        : r.warn('BE-TIME-01', rel, line, '无参的 new Date() 会读取系统时间，请通过 clock 获取')));
    }
    // BE-SEC-01
    each(code, /(^|[^.\w$])eval\s*\(/, (_m, line) => r.error('BE-SEC-01', rel, line, '禁止使用 eval'));
    each(code, /\bnew\s+Function\s*\(/, (_m, line) => r.error('BE-SEC-01', rel, line, '禁止使用 new Function'));
    if (!importSpecifiers(code).some((x) => x.spec === 'node:child_process')) each(code, /['"]child_process['"]/, (_m, line) => r.error('BE-SEC-01', rel, line, '禁止使用 child_process'));
    // BE-ERR-01：空 catch（块内有注释说明的不算）
    each(src, /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/, (_m, line) => r.error('BE-ERR-01', rel, line, '禁止空的 catch 吞掉异常；确需忽略时在 catch 块中写注释说明原因'));
    // BE-API-08
    if (rel !== 'server/src/lib/http.js') each(code, /\.writeHead\s*\(|\bres\.end\s*\(/, (_m, line) => r.warn('BE-API-08', rel, line, '写响应请统一通过 lib/http.js 的 sendJson / sendError'));
    // BE-RUN-05：测试特判
    each(code, /\bTEST_PORT\b|PLAYWRIGHT|process\.env\.CI\b|\bTC-(?:API|E2E|UI)-[A-Z]{2,10}-\d{3}\b|navigator\.webdriver/, (m, line) => r.error('BE-RUN-05', rel, line, `禁止针对测试环境做特判（出现「${m[0]}」）`));
    // BE-RUN-06：硬编码样例数据
    each(code, /org\/repo|issues\/(?:123|100)\b|pull\/456|ai-agent-design|\b17(?:0[789]|10)\d{9}\b/, (m, line) => r.error('BE-RUN-06', rel, line, `疑似硬编码 resource.json 样例数据「${m[0]}」`));
    // BE-TRACE-02
    if (rel.startsWith('server/src/') && !/@code\s+C-BE-[A-Z]{2,10}-\d{2}/.test(src)) r.warn('BE-TRACE-02', rel, null, '文件中没有任何 @code C-BE-… 标注');
    checkCommonStyle(r, rel, src, code, 'BE');
  }

  // 全局规则
  const allCode = srcFiles.map((f) => codeOf.get(f)).join('\n');
  if (!exists('server/src/index.js')) r.error('BE-DIR-01', 'server/src/index.js', null, '入口文件 server/src/index.js 不存在');
  else {
    // BE-RUN-03：index.js 本身或它直接 import 的模块中注册 SIGTERM / SIGINT
    const entry = codeOf.get('server/src/index.js') || '';
    const near = [entry, ...importSpecifiers(entry).filter((x) => x.spec.startsWith('.'))
      .map((x) => path.posix.normalize(path.posix.join('server/src', x.spec))).map((f) => codeOf.get(f) || '')].join('\n');
    if (!/['"]SIGTERM['"]/.test(near)) r.error('BE-RUN-03', 'server/src/index.js', null, '没有处理 SIGTERM：需要 server.close() 后 process.exit(0)，否则覆盖率无法落盘');
    else if (!/['"]SIGINT['"]/.test(near)) r.warn('BE-RUN-03', 'server/src/index.js', null, '只处理了 SIGTERM，建议同时处理 SIGINT');
  }
  if (srcFiles.length) {
    if (!/\bLOG_FILE\b/.test(allCode)) r.error('BE-LOG-02', 'server/src', null, '没有支持 LOG_FILE 环境变量（测试留痕需要按偏移量截取后端日志）');
    else if (!/\b(?:appendFileSync|writeSync)\b/.test(allCode)) r.warn('BE-LOG-02', 'server/src', null, '支持了 LOG_FILE，但没有找到同步写入（appendFileSync）：异步写可能导致证据中缺少最后几行日志');
    if (!/x-request-id/i.test(allCode)) r.warn('BE-LOG-03', 'server/src', null, '没有找到 x-request-id 的读取 / 回传');
    if (/__test__/.test(allCode) && !/\bENABLE_TEST_API\b/.test(allCode)) r.error('BE-RUN-02', 'server/src', null, '提供了 /api/__test__ 接口，但没有用 ENABLE_TEST_API 控制是否启用');
    if (!/__test__/.test(allCode)) r.warn('BE-RUN-02', 'server/src', null, '没有找到 POST /api/__test__/reset（测试隔离依赖它）');
  }
  if (!exists('scripts/start.sh')) r.warn('BE-RUN-04', 'scripts/start.sh', null, '缺少 scripts/start.sh');
  else if (!/\bexec\s+node\b/.test(read('scripts/start.sh'))) r.warn('BE-RUN-04', 'scripts/start.sh', null, '建议用 exec node server/src/index.js 启动，让 SIGTERM 直接到达 node 进程');
  return finish(r);
}

// ---------------------------------------------------------------- 前端

function loadUiContract() {
  const ui = readJson('docs/trace/ui-contract.json');
  if (!ui) return null;
  return {
    testIds: new Set((ui.pages || []).flatMap((p) => (p.elements || []).map((e) => e.testId))),
    messages: new Set((ui.messages || []).map((m) => m.type)),
    storageKeys: new Set((ui.storageKeys || []).map((k) => k.key)),
  };
}

/** 从 call 开始处截取括号内的参数文本（简单的括号配对） */
function callArgs(code, start) {
  const open = code.indexOf('(', start);
  let depth = 0;
  for (let i = open; i < code.length && i < open + 2000; i++) {
    if (code[i] === '(') depth++;
    else if (code[i] === ')' && --depth === 0) return code.slice(open + 1, i);
  }
  return code.slice(open + 1, open + 2000);
}

function checkFrontend() {
  const r = makeReport('fe');
  if (!exists('extension')) {
    r.status = 'not_implemented';
    r.message = 'extension/ 尚未实现，跳过前端规范检查';
    return finish(r);
  }
  const ui = loadUiContract();
  if (!ui) r.warn('FE-UI-01', 'docs/trace/ui-contract.json', null, '缺少 ui-contract.json，跳过 testId / 消息 / storage key 的登记检查');
  const jsFiles = walk('extension', ['.js', '.mjs']);
  const htmlFiles = walk('extension', ['.html']);
  r.stats.files = jsFiles.length + htmlFiles.length;
  let anyFetch = false;
  let allCode = '';

  const checkTestId = (rel, line, id) => {
    if (!KEBAB_ID.test(id)) r.error('FE-UI-01', rel, line, `data-testid「${id}」必须是 kebab-case`);
    else if (ui && !ui.testIds.has(id)) r.error('FE-UI-01', rel, line, `data-testid「${id}」没有在 ui-contract.json 中登记`);
  };

  for (const rel of jsFiles) {
    const src = read(rel);
    const code = stripComments(src);
    allCode += code + '\n';
    const inPopup = rel.startsWith('extension/popup/');
    const inBackground = rel.startsWith('extension/background/');

    // FE-DIR-03 / FE-MV3-04：import 检查
    for (const { spec, index } of importSpecifiers(code)) {
      const line = lineOf(code, index);
      if (/^https?:/.test(spec)) r.error('FE-MV3-04', rel, line, `MV3 禁止加载远程代码「${spec}」`);
      else if (spec.startsWith('node:') || BUILTINS.has(spec.split('/')[0])) r.error('FE-DIR-03', rel, line, `插件中不能使用 Node 模块「${spec}」`);
      else if (!spec.startsWith('.') && !spec.startsWith('/')) r.error('FE-DIR-03', rel, line, `插件没有构建步骤，禁止裸包名 import「${spec}」`);
    }
    // FE-UI-03：XSS
    each(code, /\.innerHTML\s*(\+?=)(?!=)\s*([^;\n]*)/, (m, line) => {
      if (m[1] === '=' && /^(['"`])\1\s*$/.test(m[2].trim())) return; // innerHTML = '' 允许
      r.error('FE-UI-03', rel, line, '禁止给 innerHTML 赋非空值，请用 createElement + textContent（防 XSS）');
    });
    each(code, /\.outerHTML\s*\+?=(?!=)/, (_m, line) => r.error('FE-UI-03', rel, line, '禁止给 outerHTML 赋值'));
    each(code, /\.insertAdjacentHTML\s*\(|\bdocument\.write(?:ln)?\s*\(/, (_m, line) => r.error('FE-UI-03', rel, line, '禁止 insertAdjacentHTML / document.write'));
    // FE-MSG-01
    if (inPopup) {
      each(code, /\bchrome\.(?:tabs|history)\b/, (m, line) => r.error('FE-MSG-01', rel, line, `popup 禁止直接调用 ${m[0]}，请通过 sendMessage 交给 background`));
      each(code, /(^|[^.\w$])fetch\s*\(/, (_m, line) => r.error('FE-MSG-01', rel, line, 'popup 禁止直接 fetch 后端，请通过 sendMessage 交给 background'));
    }
    // FE-API-01
    if (/(^|[^.\w$])fetch\s*\(/m.test(code)) anyFetch = true;
    if (!inPopup && rel !== 'extension/background/services/api-client.js') each(code, /(^|[^.\w$])fetch\s*\(/, (_m, line) => r.warn('FE-API-01', rel, line, '后端请求应统一通过 background/services/api-client.js 发出'));
    if (!['extension/shared/constants.js', 'extension/background/services/api-client.js'].includes(rel)) {
      each(code, /https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?/, (m, line) => r.warn('FE-API-01', rel, line, `后端地址字面量「${m[0]}」应只出现在 shared/constants.js 或 api-client.js 中`));
    }
    // FE-MSG-03：消息 type
    const checkType = (line, type) => {
      if (!/^[A-Z][A-Z0-9_]*$/.test(type)) r.error('FE-MSG-03', rel, line, `消息 type「${type}」必须是 UPPER_SNAKE`);
      else if (ui && !ui.messages.has(type)) r.error('FE-MSG-03', rel, line, `消息 type「${type}」没有在 ui-contract.json 的 messages 中登记`);
    };
    each(code, /sendMessage\s*\(\s*\{[^}]*?\btype\s*:\s*(['"`])([^'"`]+)\1/s, (m, line) => checkType(line, m[2]));
    const constFiles = { 'extension/shared/messages.js': 'messages', 'extension/shared/storage-keys.js': 'storageKeys' };
    if (constFiles[rel]) {
      const values = [];
      each(code, /\b[A-Z_][A-Z0-9_]*\s*:\s*(['"`])([^'"`]+)\1/, (m, line) => values.push([line, m[2]]));
      each(code, /\bexport\s+const\s+[A-Z_][A-Z0-9_]*\s*=\s*(['"`])([^'"`]+)\1/, (m, line) => values.push([line, m[2]]));
      for (const [line, v] of values) {
        if (constFiles[rel] === 'messages') checkType(line, v);
        else if (ui && !ui.storageKeys.has(v)) r.error('FE-CACHE-01', rel, line, `storage key「${v}」没有在 ui-contract.json 的 storageKeys 中登记`);
      }
    }
    // FE-UI-01：JS 中出现的 testId
    each(code, /data-testid\s*=\s*\\?["'`]([^"'`$\\]+)/, (m, line) => checkTestId(rel, line, m[1]));
    each(code, /\.dataset\.testid\s*=\s*(['"`])([^'"`$]+)\1/, (m, line) => checkTestId(rel, line, m[2]));
    each(code, /setAttribute\(\s*(['"])data-testid\1\s*,\s*(['"`])([^'"`$]+)\2/, (m, line) => checkTestId(rel, line, m[3]));
    each(code, /['"]data-testid['"]\s*:\s*(['"`])([^'"`$]+)\1/, (m, line) => checkTestId(rel, line, m[2]));
    // FE-CTX-02
    each(code, /\bchrome\.history\.search\s*\(/, (m, line) => {
      const near = callArgs(code, m.index) + '\n' + code.split('\n').slice(Math.max(0, line - 16), line).join('\n');
      if (!/\bstartTime\b/.test(near)) r.error('FE-CTX-02', rel, line, 'chrome.history.search 必须显式传 startTime（默认只返回最近 24 小时）');
      if (!/\bmaxResults\b/.test(near)) r.warn('FE-CTX-02', rel, line, 'chrome.history.search 应显式传 maxResults（与 maxHistoryItems 一致）');
    });
    // FE-MV3-05 / FE-MV3-04
    each(code, /\b(?:localStorage|sessionStorage)\b/, (m, line) => r.error('FE-MV3-05', rel, line, `禁止使用 ${m[0]}：service worker 中不可用，也不与 popup 共享；状态请写入 chrome.storage.local`));
    each(code, /(^|[^.\w$])eval\s*\(|\bnew\s+Function\s*\(|\bset(?:Timeout|Interval)\s*\(\s*['"`]/, (_m, line) => r.error('FE-MV3-04', rel, line, 'MV3 CSP 禁止 eval / new Function / 字符串形式的定时器'));
    // FE-LOG-01 / FE-MV3-07
    if (rel !== 'extension/shared/logger.js') each(code, /\bconsole\.(?:log|info|warn|error|debug|trace)\s*\(/, (_m, line) => r.warn('FE-LOG-01', rel, line, '请使用 shared/logger.js 记录日志'));
    if (inBackground) each(code, /\bsetInterval\s*\(/, (_m, line) => r.warn('FE-MV3-07', rel, line, '不要用 setInterval（无法给 SW 保活）；定时任务请用 chrome.alarms'));
    // FE-TEST-01
    each(code, /\bTC-(?:API|E2E|UI)-[A-Z]{2,10}-\d{3}\b|playwright|navigator\.webdriver/i, (m, line) => r.error('FE-TEST-01', rel, line, `禁止针对测试环境做特判（出现「${m[0]}」）`));
    // FE-TRACE-02
    if (!/@code\s+C-FE-[A-Z]{2,10}-\d{2}/.test(src)) r.warn('FE-TRACE-02', rel, null, '文件中没有任何 @code C-FE-… 标注');
    checkCommonStyle(r, rel, src, code, 'FE');
  }

  for (const rel of htmlFiles) {
    const src = read(rel);
    const html = stripHtmlComments(src);
    r.stats.lines += src.split('\n').length;
    each(html, /<script\b([^>]*)>([\s\S]*?)<\/script>/i, (m, line) => {
      if (/\bsrc\s*=\s*["']?https?:/i.test(m[1])) r.error('FE-MV3-04', rel, line, 'MV3 禁止加载远程脚本');
      else if (!/\bsrc\s*=/.test(m[1]) && m[2].trim()) r.error('FE-MV3-04', rel, line, '禁止内联 <script>（违反 MV3 CSP）');
    });
    each(html, /<[a-z][^>]*\son[a-z]+\s*=\s*["']/i, (_m, line) => r.error('FE-MV3-04', rel, line, '禁止内联事件处理器 on*=（违反 MV3 CSP）'));
    each(html, /\bhref\s*=\s*["']\s*javascript:/i, (_m, line) => r.error('FE-MV3-04', rel, line, '禁止 javascript: 链接'));
    each(html, /\bdata-testid\s*=\s*["']([^"']+)["']/, (m, line) => checkTestId(rel, line, m[1]));
  }

  // manifest
  const man = readJson('extension/manifest.json');
  if (!man) r.error('FE-DIR-01', 'extension/manifest.json', null, '缺少 extension/manifest.json 或不是合法 JSON');
  else {
    const mf = 'extension/manifest.json';
    if (man.manifest_version !== 3) r.error('FE-MV3-01', mf, null, 'manifest_version 必须为 3');
    const perms = man.permissions || [];
    for (const p of FE_REQUIRED_PERMISSIONS) if (!perms.includes(p)) r.error('FE-MV3-01', mf, null, `permissions 缺少 ${p}`);
    for (const p of perms) if (!FE_ALLOWED_PERMISSIONS.has(p)) r.warn('FE-MV3-02', mf, null, `权限「${p}」不在最小权限清单中，请在前端方案中说明理由`);
    for (const h of man.host_permissions || []) {
      if (!/^(?:https?|\*):\/\/(?:localhost|127\.0\.0\.1)(?::(?:\d+|\*))?\/\*?$/.test(h)) r.error('FE-MV3-03', mf, null, `host_permissions「${h}」超出本机后端范围`);
    }
    const sw = man.background?.service_worker;
    if (!sw) r.error('FE-DIR-01', mf, null, '缺少 background.service_worker');
    else if (!exists(`extension/${sw}`)) r.error('FE-DIR-01', mf, null, `service_worker 文件不存在：extension/${sw}`);
    if (sw && man.background?.type !== 'module') r.warn('FE-MV3-08', mf, null, 'background.type 建议设为 "module"');
    const pop = man.action?.default_popup;
    if (!pop) r.error('FE-DIR-01', mf, null, '缺少 action.default_popup');
    else {
      if (!exists(`extension/${pop}`)) r.error('FE-DIR-01', mf, null, `popup 文件不存在：extension/${pop}`);
      if (pop !== 'popup/popup.html') r.warn('FE-TEST-02', mf, null, `popup 路径「${pop}」与测试夹具约定的 popup/popup.html 不一致`);
    }
    const csp = JSON.stringify(man.content_security_policy || '');
    if (/unsafe-eval|https?:\/\//.test(csp)) r.error('FE-MV3-04', mf, null, 'content_security_policy 不得放宽为 unsafe-eval 或远程来源');
  }

  // FE-UI-07：popup 尺寸不能依赖视口（真实 action popup 打开瞬间视口接近 0，会塌成空白小框）
  const VIEWPORT_UNIT = /(?<![\w-])-?(?:\d+\.?\d*|\.\d+)(?:d|s|l)?(?:vw|vh|vmin|vmax)\b/i;
  const popupCss = walk('extension/popup', ['.css']);
  let hasFixedWidth = false;
  for (const rel of popupCss) {
    const css = read(rel).replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    r.stats.lines += css.split('\n').length;
    each(css, new RegExp(VIEWPORT_UNIT.source, 'gi'), (m, line) => r.error('FE-UI-07', rel, line, `popup 样式中出现视口单位「${m[0]}」：真实 action popup 的视口由内容撑开，打开瞬间接近 0，会塌成空白小框；请改用固定 px`));
    each(css, /(?:^|[},\s])(html|body)\s*(?:,[^{]*)?\{([^}]*)\}/g, (m, line) => {
      if (/(?:^|;|\s)(?:width|height|min-height|max-height|max-width)\s*:\s*[^;]*\d+%/.test(m[2])) r.warn('FE-UI-07', rel, line, `${m[1]} 用百分比定宽高，在真实 action popup 中没有确定的参照尺寸，请改用固定 px`);
      if (/(?:^|;|\s)width\s*:\s*\d+px/.test(m[2])) hasFixedWidth = true;
    });
    if (/\.app\s*\{[^}]*(?:^|;|\s)width\s*:\s*\d+px/.test(css)) hasFixedWidth = true;
  }
  for (const rel of jsFiles.filter((f) => f.startsWith('extension/popup/'))) {
    each(stripComments(read(rel)), /(?:style\.(?:width|height|minHeight|maxHeight|minWidth|maxWidth)\s*=|setProperty\(\s*['"`](?:width|height|min-height|max-height)['"`]\s*,)\s*[^;\n]*?(?:\d+\.?\d*|\.\d+)(?:d|s|l)?(?:vw|vh|vmin|vmax)\b/gi, (m, line) => r.error('FE-UI-07', rel, line, 'popup 脚本用视口单位设置尺寸，真实 action popup 中会塌缩；请改用固定 px'));
  }
  if (popupCss.length && !hasFixedWidth) r.warn('FE-UI-07', 'extension/popup/', null, 'popup 的 body / html / .app 没有固定 px 宽度，真实 action popup 的宽度将完全由内容决定');

  // 全局启发式
  if (anyFetch && !/\bAbortController\b|\bAbortSignal\.timeout\b/.test(allCode)) r.warn('FE-API-03', 'extension/', null, '发起了 fetch，但没有找到 AbortController / AbortSignal.timeout 超时控制');
  if (/onMessage\.addListener/.test(allCode) && !/UNKNOWN_MESSAGE/.test(allCode)) r.warn('FE-MSG-04', 'extension/', null, '注册了消息监听，但没有处理未知 type（UNKNOWN_MESSAGE）');
  if (jsFiles.length && !/['"`]apiBaseUrl['"`]/.test(allCode)) r.warn('FE-TEST-02', 'extension/', null, '没有找到 storage key「apiBaseUrl」，与测试夹具的约定不一致');
  if (ui && ui.storageKeys.size && !ui.storageKeys.has('apiBaseUrl')) r.warn('FE-TEST-02', 'docs/trace/ui-contract.json', null, 'storageKeys 中没有 apiBaseUrl，与测试夹具的约定不一致');
  return finish(r);
}

// ---------------------------------------------------------------- 主流程

const sides = SIDE === 'all' ? ['be', 'fe'] : [SIDE];
if (!sides.every((s) => s === 'be' || s === 'fe')) {
  console.error('用法：node specs/tools/check-spec.mjs [--side=be|fe|all] [--root=<dir>] [--json]');
  process.exit(2);
}
const reports = sides.map((s) => (s === 'be' ? checkBackend() : checkFrontend()));
const outDir = path.join(ROOT, 'docs', 'quality');
fs.mkdirSync(outDir, { recursive: true });
for (const rep of reports) fs.writeFileSync(path.join(outDir, `spec-check-${rep.side}.json`), JSON.stringify(rep, null, 2));
const combined = reports.length === 1 ? reports[0] : {
  side: 'all',
  status: reports.map((x) => `${x.side}:${x.status}`).join(','),
  pass: reports.every((x) => x.pass),
  errors: reports.flatMap((x) => x.errors),
  warnings: reports.flatMap((x) => x.warnings),
  stats: Object.fromEntries(reports.map((x) => [x.side, x.stats])),
  generatedAt: new Date().toISOString(),
};
if (reports.length > 1) fs.writeFileSync(path.join(outDir, 'spec-check-all.json'), JSON.stringify(combined, null, 2));

if (AS_JSON) console.log(JSON.stringify(combined, null, 2));
else {
  const fmt = (x) => `${x.rule} ${x.file}${x.line ? ':' + x.line : ''}  ${x.message}`;
  for (const rep of reports) {
    const label = rep.side === 'be' ? '后端' : '前端';
    if (rep.status === 'not_implemented') { console.log(`· ${label}：${rep.message}`); continue; }
    for (const e of rep.errors) console.log(`✖ ${fmt(e)}`);
    for (const w of rep.warnings) console.log(`⚠ ${fmt(w)}`);
    console.log(`${rep.pass ? '✔' : '✖'} ${label}：${rep.stats.files} 个文件，${rep.errors.length} 个错误，${rep.warnings.length} 个警告`);
  }
  const shown = path.relative(process.cwd(), outDir);
  console.log(`报告：${!shown || shown.startsWith('..') ? outDir : shown}/spec-check-${reports.length > 1 ? '{be,fe,all}' : reports[0].side}.json`);
}
process.exit(combined.pass ? 0 : 1);
