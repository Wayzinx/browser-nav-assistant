# 插件前端代码规范（frontend.spec）

> 适用对象：插件前端开发 agent（`extension/**`），以及代码评审、UI 测试失败分诊和 UI 探索判定。
> 技术栈（CONVENTIONS §5）：Chrome Extension **Manifest V3**，原生 JS（ES modules），**没有构建步骤、没有 npm 依赖**，`extension/` 可以直接「加载已解压的扩展程序」。
> 优先级：`PROBLEM.md` > `.workflow/CONVENTIONS.md` > 技术方案与契约（`docs/04`、`ui-contract.json`、`api-contract.json`）> 本规范。
>
> 规则格式：`FE-<领域>-<序号>`；**MUST** 必须遵守，**SHOULD** 无充分理由不得违反；「机检」表示 `node specs/tools/check-spec.mjs --side=fe` 会检查（MUST 报 error，SHOULD 报 warning），「人检」靠评审、UI 用例和 UI 探索把关。规则 ID 发布后不改作他用。

---

## 1. 目录结构（DIR）

| ID | 级别 | 检查 | 规则 |
|---|---|---|---|
| FE-DIR-01 | MUST | 机检 | `extension/manifest.json` 位于插件根目录，`action.default_popup` 和 `background.service_worker` 指向的文件都存在。 |
| FE-DIR-02 | SHOULD | 人检 | 按下面的目录组织代码；新增目录要在前端方案中说明理由。 |
| FE-DIR-03 | MUST | 机检 | 只允许 import 相对路径或以 `/` 开头的插件内路径；禁止裸包名、`node:` 模块和远程 URL（MV3 禁止远程代码）。 |
| FE-DIR-04 | SHOULD | 机检 | 源码文件名使用 kebab-case。 |

```
extension/
├── manifest.json
├── popup/
│   ├── popup.html          # 只有结构和 data-testid，不写内联脚本
│   ├── popup.css
│   ├── popup.js            # 入口：加载状态 → 渲染 → 绑定事件（全部通过 sendMessage）
│   └── views/              # 每个区块一个渲染模块：current-page.js、sync.js、ranked.js、recommend.js、cleanup.js、rules.js、diagnostics.js
├── background/
│   ├── service-worker.js   # "type": "module"；顶层同步注册所有监听器
│   ├── handlers/           # 每种消息 type 一个处理函数
│   └── services/
│       ├── api-client.js   # 唯一和后端通信的模块
│       ├── collector.js    # chrome.tabs / chrome.history 采集
│       ├── privacy.js      # 发送前的隐私过滤
│       ├── sync.js         # 同步流程、增量游标、同步状态
│       ├── cache.js        # 排序 / 推荐 / 整理结果的本地缓存
│       └── diagnostics.js  # 7 项诊断
├── shared/
│   ├── messages.js         # 消息 type 常量（与 ui-contract.messages 一致）
│   ├── storage-keys.js     # storage key 常量（与 ui-contract.storageKeys 一致）
│   ├── url.js  constants.js  logger.js
└── content/                # 可选
```

## 2. MV3 约束（MV3）

| ID | 级别 | 检查 | 规则 |
|---|---|---|---|
| FE-MV3-01 | MUST | 机检 | `manifest_version: 3`；`permissions` 至少包含 `tabs`、`history`、`storage`、`activeTab`。 |
| FE-MV3-02 | SHOULD | 机检 | 最小权限：`permissions` 只从 `tabs`、`history`、`storage`、`activeTab`、`contextMenus`、`alarms` 中选，并在前端方案中逐项写明理由。 |
| FE-MV3-03 | MUST | 机检 | `host_permissions` 只包含本机后端（`http://localhost/*`、`http://127.0.0.1/*`，可以带端口），不申请 `<all_urls>`。 |
| FE-MV3-04 | MUST | 机检 | 禁止内联 `<script>`、内联事件（`onclick=` 等）、`javascript:` 链接、远程脚本、`eval` / `new Function` / 字符串形式的 `setTimeout`；不得在 `content_security_policy` 中放宽为 `unsafe-eval` 或远程来源。 |
| FE-MV3-05 | MUST | 机检 | Service worker 随时可能被回收：需要保留的状态（同步状态、游标、缓存、API 地址）一律写入 `chrome.storage.local`；禁止使用 `localStorage` / `sessionStorage`（SW 中不可用）。内存变量只能当作可丢失的缓存。 |
| FE-MV3-06 | MUST | 人检 | `chrome.runtime.onMessage` 等监听器在 `service-worker.js` 顶层同步注册，不能放在 `await` 之后或者回调里，否则 SW 被唤醒时会丢失事件。 |
| FE-MV3-07 | SHOULD | 机检 | 不用 `setInterval` 给 SW 保活；需要定时任务时用 `chrome.alarms`。 |
| FE-MV3-08 | SHOULD | 机检 | `background.type` 设为 `"module"`，background 代码使用 ES modules。 |

```json
// ✅ manifest.json（节选）
{
  "manifest_version": 3,
  "permissions": ["tabs", "history", "storage", "activeTab"],
  "host_permissions": ["http://127.0.0.1/*", "http://localhost/*"],
  "background": { "service_worker": "background/service-worker.js", "type": "module" },
  "action": { "default_popup": "popup/popup.html" }
}
```

## 3. 职责边界与消息协议（MSG）

| ID | 级别 | 检查 | 规则 |
|---|---|---|---|
| FE-MSG-01 | MUST | 机检 | popup 只负责展示和交互：`popup/` 下禁止直接调用 `chrome.tabs`、`chrome.history`、`fetch`。浏览器 API、后端请求、隐私过滤、同步状态和缓存都在 background 中完成，popup 通过 `chrome.runtime.sendMessage` 调用。 |
| FE-MSG-02 | MUST | 人检 | 消息信封统一为：请求 `{ type, payload, requestId }`；响应 `{ ok: true, data }` 或 `{ ok: false, error: { code, message } }`。background 的处理函数不能把异常直接抛给 popup。 |
| FE-MSG-03 | MUST | 机检 | `type` 使用 UPPER_SNAKE（`SYNC_NOW`、`GET_CONTEXT`），定义在 `shared/messages.js`，并在 `ui-contract.json` 的 `messages` 中登记；开发阶段只能新增，不能删除或改名。 |
| FE-MSG-04 | MUST | 机检（启发式，warning）+ 人检 | 未知的 `type` 返回 `{ ok: false, error: { code: 'UNKNOWN_MESSAGE' } }`；popup 侧每次调用都有超时（例如 10 秒），超时后显示错误状态，不能一直转圈。 |

```js
// ✅ popup/popup.js
import { MSG } from '../shared/messages.js';
// @code C-FE-SYNC-01
async function onSyncClick() {
  renderSync({ state: 'loading' });
  const res = await send(MSG.SYNC_NOW, {});          // send() 内部带超时，并统一生成 requestId
  renderSync(res.ok ? { state: 'success', ...res.data } : { state: 'error', error: res.error });
}

// ❌ 反例：popup 直接读 tabs、请求后端
const tabs = await chrome.tabs.query({ currentWindow: true });   // 违反 FE-MSG-01
await fetch('http://127.0.0.1:3000/api/sync', { method: 'POST' }); // 违反 FE-MSG-01 / FE-API-01
```

```js
// ✅ background/service-worker.js：顶层注册，按 type 分发
import { handlers } from './handlers/index.js';
// @code C-FE-CORE-01
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) { sendResponse({ ok: false, error: { code: 'UNKNOWN_MESSAGE', message: `未知消息 ${msg?.type}` } }); return false; }
  handler(msg.payload ?? {})
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e) => sendResponse({ ok: false, error: { code: e.code || 'INTERNAL', message: e.message } }));
  return true; // 异步响应
});
```

## 4. 后端调用（API）

| ID | 级别 | 检查 | 规则 |
|---|---|---|---|
| FE-API-01 | MUST | 机检（warning） | 所有后端请求只通过 `background/services/api-client.js` 发出；后端地址字面量只允许出现在 `shared/constants.js` 或 `api-client.js` 中。 |
| FE-API-02 | MUST | 人检 | base URL 从 `chrome.storage.local` 的 `apiBaseUrl` 读取（key 名与 `ui-contract.storageKeys` 一致），未配置时使用默认值 `http://127.0.0.1:<api-contract.defaultPort>`；用户可以在 popup 中修改，保存前校验格式。 |
| FE-API-03 | MUST | 机检（启发式，warning） | `fetch` 必须设置超时：使用 `AbortController` 或 `AbortSignal.timeout()`，默认 5 秒，`/api/health` 3 秒。 |
| FE-API-04 | MUST | 人检 | 每个请求带上 `x-request-id`（`ext_<时间>_<序号>`），写进前端日志，方便和后端日志对照。 |
| FE-API-05 | MUST | 人检 | 按统一错误格式解析错误响应；网络失败或超时映射为 `BACKEND_UNREACHABLE` / `TIMEOUT`，最终返回 `{ ok: false, error }`，不向外抛出原始异常。 |

```js
// ✅ background/services/api-client.js
// @code C-FE-CORE-02
export async function callApi(method, path, body, { timeoutMs = 5000 } = {}) {
  const base = await getApiBase();
  const requestId = nextRequestId();
  try {
    const res = await fetch(base + path, {
      method, headers: { 'content-type': 'application/json', 'x-request-id': requestId },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: data?.error ?? { code: `HTTP_${res.status}`, message: res.statusText } };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: { code: e.name === 'TimeoutError' ? 'TIMEOUT' : 'BACKEND_UNREACHABLE', message: `无法连接后端 ${base}` } };
  }
}
```

## 5. 隐私（PRIV）

| ID | 级别 | 检查 | 规则 |
|---|---|---|---|
| FE-PRIV-01 | MUST | 人检 + UI 用例 | 在 background 中、**发送之前**完成过滤，隐私 URL 不得出现在任何发往后端的请求体中（PROBLEM.md 总体约束）。 |
| FE-PRIV-02 | MUST | 人检 | 关键词取自 `GET /api/config` 的 `privacySensitiveKeywords`（同时遵守 `enablePrivacyFilter`）；取不到时使用 `shared/constants.js` 中的内置默认值 `['password', 'token', 'bank', 'secret']`，不能因为后端不可用而停止过滤。 |
| FE-PRIV-03 | MUST | 人检 | 对完整 URL 做不区分大小写的子串匹配；`tokenizer` 会被 `token` 误伤属于已知局限，写进文档，不在代码里打补丁。 |
| FE-PRIV-04 | MUST | 人检 | 跳过非 `http:` / `https:` 的页面（`chrome://`、`chrome-extension://`、`about:`、`file://`）和隐身 tab（`tab.incognito === true`）。 |
| FE-PRIV-05 | MUST | 人检 | 同步状态和 UI 中只展示被过滤的条数（例如「已过滤 2 条隐私页面」），不展示也不存储这些 URL；日志中对 URL 打码（只保留 host）。 |

## 6. 浏览器上下文（CTX）

| ID | 级别 | 检查 | 规则 |
|---|---|---|---|
| FE-CTX-01 | MUST | 人检 + UI 用例 | 判定「当前页面」时排除插件自身页面（`chrome-extension://`）。popup 以 tab 方式打开时同样要正确，具体算法写在前端方案中（例如在 `lastFocusedWindow` 的 http(s) tabs 里取 `lastAccessed` 最大的一个）。 |
| FE-CTX-02 | MUST | 机检 | `chrome.history.search` 必须显式传 `startTime`（默认只查最近 24 小时）和 `maxResults`（与 config 的 `maxHistoryItems` 一致）。 |
| FE-CTX-03 | SHOULD | 人检 | 当前页面是 `chrome://` 等系统页面时正常展示，并标注「系统页面，不参与同步」；tabs 和历史的展示只依赖浏览器 API，后端不可用时也能显示。 |

```js
// ✅ collector.js
// @code C-FE-CTX-03
export function readHistory({ maxItems, now }) {
  return chrome.history.search({ text: '', startTime: now - 30 * DAY_MS, maxResults: maxItems });
}
// ❌ 反例：只能拿到最近 24 小时
chrome.history.search({ text: '' });   // 违反 FE-CTX-02
```

## 7. 界面（UI）

| ID | 级别 | 检查 | 规则 |
|---|---|---|---|
| FE-UI-01 | MUST | 机检 | 每个可交互或需要断言的元素都有 `data-testid`，值为 kebab-case，并在 `ui-contract.json` 的 `pages[].elements` 中登记；发布后不得改名或删除（UI 脚本只用 `getByTestId` 定位）。列表项使用统一的 testId（例如 `ranked-item`），通过 `nth()` 和子元素的 testId 断言。 |
| FE-UI-02 | MUST | 人检 | 每个异步区块都有加载、空、错误、离线四种状态，每种状态都有可断言的 testId（例如 `ranked-loading`、`ranked-empty`、`ranked-error`、`offline-badge`）。 |
| FE-UI-03 | MUST | 机检 | 页面标题、URL、reason、规则原文等不可信文本只能通过 `textContent` 渲染。禁止给 `innerHTML` 赋非空值，禁止 `outerHTML` 赋值、`insertAdjacentHTML`、`document.write`。清空容器用 `replaceChildren()` 或 `innerHTML = ''`。 |
| FE-UI-04 | SHOULD | 人检 | 渲染函数是「state → DOM」的纯函数：同样的状态得到同样的 DOM；事件处理只负责发消息和更新状态，不直接拼 DOM。 |
| FE-UI-05 | SHOULD | 人检 | 使用语义化元素：可点击的是 `<button>`，输入框有 `<label>`；不要用 `<div>` 模拟按钮。 |
| FE-UI-06 | SHOULD | 人检 | 不引入任何 UI 框架；popup 宽度约 400px（具体写法见 FE-UI-07），区块可以折叠，但测试要断言的信息默认可见。 |
| FE-UI-07 | MUST | 机检 | **popup 的尺寸必须用固定的 px 值撑开，禁止依赖视口。**popup 页面的 CSS（`extension/popup/**/*.css`）和 popup 脚本里的内联样式，禁止出现视口单位（`vw`、`vh`、`dvh`、`svh`、`lvh`、`dvw`、`svw`、`lvw`、`vmin`、`vmax`）；`html`、`body` 不要用百分比定宽高（warning）；`body` 或根容器必须写固定的 `width: <n>px`（约 400px），高度用固定 px 或者由内容撑开。原因：真实的 action popup 窗口由内容撑开，打开瞬间视口接近 0，`min(400px, 100vw)`、`max-height: 100dvh` 会让整个界面塌成一个空白小框。以 tab 方式打开时视口很宽，测试发现不了。2026-11-03 线上「插件点不开」就是这个问题。 |

```css
/* ✅ popup 尺寸由固定 px 撑开（FE-UI-07） */
body { width: 400px; min-height: 520px; margin: 0; }
.app { height: 600px; overflow-y: auto; }

/* ❌ 反例：真实 action popup 中会塌成 0 尺寸的空白小框 */
body { width: min(400px, 100vw); }
.app { height: 600px; max-height: 100dvh; }
```

```js
// ✅ 安全渲染
// @code C-FE-RANK-02
export function renderRankedItem(page) {
  const li = el('li', { 'data-testid': 'ranked-item' });
  li.append(el('span', { 'data-testid': 'ranked-item-title' }, page.title),
            el('span', { 'data-testid': 'ranked-item-score' }, page.score.toFixed(2)),
            el('p', { 'data-testid': 'ranked-item-reason' }, page.reason));
  return li;
}
// el() 内部用 document.createElement + setAttribute + textContent

// ❌ 反例：标题里有 <img onerror=...> 时会执行脚本
list.innerHTML += `<li>${page.title}</li>`;   // 违反 FE-UI-03
```

## 8. 缓存与离线（CACHE）

| ID | 级别 | 检查 | 规则 |
|---|---|---|---|
| FE-CACHE-01 | MUST | 机检 | 用到的每个 storage key 都定义在 `shared/storage-keys.js` 中，并在 `ui-contract.json` 的 `storageKeys` 中登记。 |
| FE-CACHE-02 | MUST | 人检 | 缓存值带上写入时间（`{ data, cachedAt }`）。后端不可用时展示缓存，并显示带 testId 的离线标识（例如「离线 · 缓存于 14:32」）；没有缓存时显示错误状态和排查提示。 |

## 9. 诊断（DIAG）

| ID | 级别 | 检查 | 规则 |
|---|---|---|---|
| FE-DIAG-01 | MUST | 人检 | 每项检查返回 `{ id, status: 'ok' \| 'warn' \| 'fail', detail, hint }`，`hint` 是可以照着操作的排查建议；任何一项检查都不能抛异常，单项失败不影响其他项。 |
| FE-DIAG-02 | MUST | 人检 + UI 用例 | PROBLEM.md 的 7 项都要实现：后端连通（`/api/health`，带超时）、`tabs` 权限、`history` 权限（`chrome.permissions.contains` 加实际调用探测）、`storage` 可用（写 → 读 → 删一个探测 key）、API base URL（展示当前值并校验格式）、最近一次同步（时间和结果）、当前规则数（health 的 `ruleCount`）。 |

## 10. 日志（LOG）

| ID | 级别 | 检查 | 规则 |
|---|---|---|---|
| FE-LOG-01 | SHOULD | 机检 | 统一使用 `shared/logger.js`；其他文件不直接调用 `console.*`。 |
| FE-LOG-02 | MUST | 人检 | logger 同时写 `console`（测试夹具通过 service worker 和页面的 console 事件采集日志，写入 `evidence/<CaseID>/extension.log`）和 `globalThis.__navLogs` 环形缓冲区（最多 200 条）。每条日志包含 `ts`、`level`、`event`，有请求时带上 `requestId`。 |
| FE-LOG-03 | MUST | 人检 | 日志中的 URL 打码（只保留 host）；不记录同步请求体。 |

## 11. 追溯（TRACE）

| ID | 级别 | 检查 | 规则 |
|---|---|---|---|
| FE-TRACE-01 | MUST | validator | 每个 C-FE 代码点在实现处标注：JS 中写 `// @code C-FE-<MOD>-<NN>`，HTML 中写 `<!-- @code C-FE-<MOD>-<NN> -->`；不得出现未登记的 ID。实现位置变化时，同步更新 `code-points-fe.json` 的 `files` / `symbols`。 |
| FE-TRACE-02 | SHOULD | 机检 | `extension/` 下每个 JS 文件至少有一个 `@code` 标注。 |

## 12. 可测试性（TEST）

| ID | 级别 | 检查 | 规则 |
|---|---|---|---|
| FE-TEST-01 | MUST | 机检 | 禁止针对测试环境做特判：不得检测 `navigator.webdriver`、Playwright，不得出现 Case ID 字样，也不得硬编码测试数据。 |
| FE-TEST-02 | MUST | 机检（warning） | 遵守测试夹具的约定（`.agents/skills/nav-case-to-script/assets/fixtures/extension.mjs`）：API 地址的 storage key 为 `apiBaseUrl`，popup 路径为 `popup/popup.html`；改动这两点必须同时修改契约和夹具，并经过评审。 |
| FE-TEST-04 | MUST | validator（smoke） | 插件必须通过「真实安装冒烟」（`node .workflow/validators/validate.mjs smoke`）：全新 profile、storage 为空、通过 `chrome.action.openPopup()` 打开真实的 action popup，popup 尺寸不小于 360×400、关键区块可见、没有报错，并且主流程可以走通。以 tab 方式打开 popup.html 的 UI 用例**不能**代替这一项（真实 popup 的视口、焦点和生命周期都与 tab 不同）。 |
| FE-TEST-03 | SHOULD | 人检 | 渲染顺序是确定的（与后端返回顺序一致，或有明确的排序规则）；关键信息不依赖 hover 才显示；动画不影响断言（尊重 `prefers-reduced-motion`，或者不使用动画）。 |

## 13. 代码风格（STYLE）

与后端一致（`specs/backend.spec.md` 第 11 节）：

| ID | 级别 | 检查 | 规则 |
|---|---|---|---|
| FE-STYLE-01 | MUST | 人检 | 2 空格缩进、单引号、分号、尾逗号；导出函数写 JSDoc；注释用中文解释「为什么」。 |
| FE-STYLE-02 | SHOULD | 机检 | 只用具名导出，不用 `export default`。 |
| FE-STYLE-03 | SHOULD | 机检 | 用 `const` / `let`，不用 `var`。 |
| FE-STYLE-04 | SHOULD | 机检（文件行数） | 单个函数不超过 60 行，单个文件不超过 300 行。 |

## 14. 完成定义（DoD）

前端任务交付前，以下各项必须全部满足：

1. `TEST_PORT=4102 npx playwright test --project=ui` 全部通过（单个用例用 `node .agents/skills/nav-case-to-script/scripts/run-cases.mjs <CaseID>`）。
2. `node .workflow/validators/validate.mjs code` 中没有前端相关的 error（manifest、CSP、`@code`、testId 落地）。
3. `node specs/tools/check-spec.mjs --side=fe` 没有 error；warning 要么修复，要么在交付说明中写明理由。
4. 在 Chrome 开发者模式加载 `extension/` 不报错，popup 能在后端未启动时正常打开并显示离线或错误状态。
5. 没有修改 `tests/**`、`playwright.config.mjs`（已锁定）；认为 UI 脚本与方案不符时提交 `testDisputes`。
