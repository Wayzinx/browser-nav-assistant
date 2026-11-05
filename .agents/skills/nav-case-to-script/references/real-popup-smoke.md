# 真实 popup 与真实安装冒烟

## 1. 为什么需要

UI 用例和夹具都是以 tab 方式打开 `chrome-extension://<id>/popup/popup.html`（视口 420×760），这和用户点击工具栏图标看到的**真实 action popup** 不是一回事：

| | tab 方式（UI 用例） | 真实 action popup（用户） |
|---|---|---|
| 视口 | 固定、很宽 | 由内容撑开，打开瞬间接近 0，最大约 800×600 |
| storage | 夹具预先写好 apiBaseUrl | 首次安装为空，使用默认地址 |
| 当前页面 | 需要排除插件自身的 tab | 用户正在看的网页 |
| 失焦 | 不会关闭 | 失焦立即关闭 |

本项目出过的真实事故：`popup.css` 用 `width: min(400px, 100vw)`、`max-height: 100dvh`。在 tab 中显示 400×600，全部 389 个测试都通过；在真实 popup 里却塌成 **25×25** 的空白小块，而且没有任何报错。Playwright 拿不到真实 popup 的页面，所以只能用原生 CDP。

## 2. 原理（`scripts/lib/real-popup.mjs`）

1. 启动浏览器并加载未打包扩展：
   - **Chromium**（Playwright 自带）：使用 `--load-extension` 和 `--remote-debugging-port=0`，端口从 `<profile>/DevToolsActivePort` 读取；
   - **品牌版 Chrome**：137 版以后不再支持 `--load-extension`，改用 `--remote-debugging-pipe --enable-unsafe-extension-debugging`，再通过 CDP 的 `Extensions.loadUnpacked` 加载（本机 Chrome 149 实测可用）。
2. 只建立一条浏览器级的 CDP 连接，所有 target 都用 `Target.attachToTarget({ flatten: true })` 连接。
3. 在扩展的 service worker 里依次执行 `chrome.windows.update(focused)` 和 `chrome.action.openPopup()`，得到真实 popup；`Could not find an active browser window` 时，先把网页 tab 置前再重试。
4. 连上 popup target，执行脚本、点击、填写、截图，并收集 popup 和 SW 的 console / exception。

默认使用 headless（`--headless=new`），不会弹出窗口；尺寸断言在 headless 下同样有效（修复前的 CSS 在 headless 下也是 25×25）。headless 下 popup 的高度约为 498，headed 下为 600。调试时可以用 `--headed`。

## 3. 冒烟门禁（`scripts/smoke-install.mjs` + `tests/smoke/smoke-plan.json`）

```bash
node .agents/skills/nav-case-to-script/scripts/smoke-install.mjs                     # chromium，必需
node .agents/skills/nav-case-to-script/scripts/smoke-install.mjs --browser=all       # 再加品牌版 Chrome（默认不强制，用 --require-chrome 强制）
node .agents/skills/nav-case-to-script/scripts/smoke-install.mjs --scenarios=S2 --headed
node .agents/skills/nav-case-to-script/scripts/smoke-install.mjs --json              # validator 的 smoke 阶段使用
```

- **后端**：每个浏览器各自用空闲端口、以**生产模式**启动一个后端（不设 `ENABLE_TEST_API`），快照写入临时目录，日志写入 `evidence/_smoke/<browser>/server.log`。
- **网络隔离**：浏览器的全部请求，包括回环地址，都经过脚本内置的代理（`--proxy-server` 加 `--proxy-bypass-list=<-loopback>`）：
  - 插件默认地址 `127.0.0.1:3000`：按场景转发到冒烟后端，或者直接断开，以此模拟「后端未启动」；
  - 冒烟后端自己的端口：转发；
  - 计划中声明的 `*.smoke.test` 页面：由代理直接返回桩页面；
  - 其他地址：一律拒绝。
  
  因此**绝不会连到本机 3000 端口上真实运行的服务**，也不访问外网。插件默认地址是 IP（`127.0.0.1`），`--host-resolver-rules` 对 IP 不生效，这就是改用代理的原因。
- **首次安装**：每个场景都使用全新 profile，storage 为空，不预写任何内容。
- **场景**（本项目的计划）：

| 场景 | 后端 | 验证点 |
|---|---|---|
| S1 首次安装·后端未启动 | 默认地址拒绝连接 | 真实 popup 尺寸 ≥ 360×400；首屏区块可见；当前页面识别正确；顶栏显示「后端未连接」；推荐区显示错误提示而不是空白；诊断页的后端检查为 fail，并给出排查步骤和默认地址 |
| S2 首次安装·后端已启动·主流程 | 默认地址 → 冒烟后端 | 浏览网页、关闭部分页面、按 README 导入样例 → 真实 popup → 已连接 → 同步成功 → 后端 pageCount 增加 → 排序和推荐（含理由）→ 规则解析出 2 张卡片 → 保存 → 后端有 2 条规则 → 整理建议体现规则（docs.internal.com 被保留）→ 诊断通过，每一步截图 |
| S3 修改 API 地址 | 默认地址拒绝，冒烟后端在其他端口 | 诊断页填写新地址并保存 → 当前地址更新 → 顶栏已连接 → 重新检测 → 后端检查通过 |

- **每个场景都会检查**：popup 和 SW 的未捕获异常数必须为 0，console error 的数量记录在 result.json 中。
- **产出**：
  - `evidence/_smoke/<browser>/<scenario>/`：`result.json`、`NN-*.png`、`popup.log`、`sw.log`；
  - 汇总 `evidence/_smoke/summary.json`：`{ pass, browsers, results[{ browser, scenario, pass, required, popupSize, errors, steps, screenshots }], errors[], warnings[] }`。errors 中每一条都带有「[浏览器/场景] 步骤 n」，可以直接分派给开发。

### 计划的步骤类型（扩展场景时使用）

| type | 参数 | 说明 |
|---|---|---|
| `visit` | `urls`、`keepOpen` | 在新 tab 打开页面；`keepOpen: false` 时打开后立即关闭，只留下历史 |
| `importSample` | — | 用 `scripts/import-sample.mjs` 把样例导入冒烟后端 |
| `openPopup` | — | 打开真实 action popup |
| `assertPopupSize` | `minWidth`、`minHeight` | 默认取计划中的 `popup`（360×400） |
| `assertVisible` | `testIds[]` | 全部可见 |
| `waitVisible` / `waitCount` | `testId`、`min`、`timeoutMs` | 等待可见元素数量 |
| `waitText` / `waitNonEmpty` | `testId`、`includes` | 等待文本 |
| `waitAttr` | `testId`、`attr`、`equals` 或 `in` | 等待属性，例如 `data-state=online` |
| `click` / `fill` | `testId`、`value` | 操作 popup 中的元素 |
| `api` | `method`、`path`、`body`、`expect: { status, checks: [{ path, equals \| gte }] }` | 直接请求冒烟后端，核对后端状态 |
| `screenshot` | `name` | 截取 popup |

字符串里可以使用 `${BACKEND_URL}`、`${BACKEND_PORT}`、`${DEFAULT_BASE}`。testId 只能使用 `docs/trace/ui-contract.json` 中登记过的。

## 4. 在 UI 探索和验收流程中使用

UI 探索 agent 和验收流程**必须**用真实 popup 走一遍，不能只看 tab 方式的截图：

```js
import { launchBrowser } from '../../.agents/skills/nav-case-to-script/scripts/lib/real-popup.mjs';

const s = await launchBrowser({ extDir: 'extension', startUrl: 'https://example.com/' });   // 不需要代理时可以不传 proxy
try {
  await s.openRealPopup();
  const size = await s.popupSize();                       // { innerWidth, innerHeight, ... }
  if (size.innerWidth < 360 || size.innerHeight < 400) throw new Error(`popup 塌缩 ${size.innerWidth}×${size.innerHeight}`);
  await s.popupClick('tab-diag');
  await s.waitForAttr('diag-check-backend', 'data-status', ['ok', 'fail']);
  await s.screenshot('evidence/TC-UI-DIAG-001/explore/1.png');
  console.log(s.collectLogs().exceptions);                // 必须为空
} finally {
  await s.close();
}
```

注意：
- 在真实 popup 里点击会在新 tab 打开页面的元素（例如推荐项）时，popup 会因为失焦而关闭；这是真实行为，之后需要重新调用 `openRealPopup()`。
- popup 里的「当前页面」是打开 popup 前处于活动状态的标签页。默认取第一个普通网页（可能是浏览器启动时的 `about:blank`）；要指定时传 `openRealPopup({ focusUrl: 'https://…' })`，会先把该 URL 的标签页置前。
- 如果插件需要连接测试后端，可以像冒烟脚本那样起一个代理，或者在诊断页通过 UI 修改 API 地址（这本身就是真实的用户路径）。不要在真实 popup 场景里预写 storage。
- 真实 popup 场景中**不能**使用 Playwright 的 `page.route` 拦截。

## 5. 排障

| 现象 | 原因与处理 |
|---|---|
| `30 秒内没有拿到 DevToolsActivePort` | 浏览器没能启动，检查 Chromium 是否已安装（`npx playwright install chromium`） |
| `没有找到扩展的 service worker` | 扩展加载失败（manifest 错误或 background 脚本有语法错误），先运行 `node .workflow/validators/validate.mjs code` |
| `无法打开真实 popup：Could not find an active browser window` | 没有处于焦点的普通窗口，库会自动重试 8 次；仍然失败时，确认 startUrl 是一个普通网页 |
| 尺寸低于下限 | 检查 popup 根元素是否用了 `vw` / `vh` / `dvh` / 百分比定尺寸（前端规范禁止），应改为固定的 px 尺寸 |
| 品牌版 Chrome 被记为 skipped | 本机没有安装 Chrome，或者版本不支持 `Extensions.loadUnpacked`（需要 Chrome 126 及以上） |

## 6. 局限

- headless 模式下 popup 高度受窗口限制（约 498），尺寸下限按 360×400 设置，可以在计划的 `popup` 中调整。
- 只覆盖 popup 和 service worker；content script 不在冒烟范围内。
- 品牌版 Chrome 通过 CDP 加载扩展，与用户在 `chrome://extensions` 中手动「加载已解压的扩展程序」等价，但不会弹出开发者模式提示等浏览器界面。
