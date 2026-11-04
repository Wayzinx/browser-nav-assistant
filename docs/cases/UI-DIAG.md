# DIAG 插件诊断 UI 用例分片

> 对应任务：`.workflow/context/briefs/case-UI-DIAG.md`。本文件与 `docs/trace/cases/UI-DIAG.json` 一一对应；汇总表仅由 validator 自动合并。当前为用例设计，执行结果尚未产生。

## 独立执行与数据配方

- 范围：F-DIAG-01～08、F-DIAG-11 的 9 个 FE Feature，共 24 条 AC。F-DIAG-09/10 的产品 API 验收由 API 分片负责。
- 脚本阶段一个 Case ID 对应一个 `tests/ui/<CaseID>.spec.mjs`，每条自行 reset 与造数；证据写入 `evidence/<CaseID>/`。本阶段不创建脚本或执行 PASS 证据。
- 使用 CONVENTIONS §5 的 persistent Chromium（`channel=chromium`）加载扩展，popup 以 tab 打开；外部页面 route 离线化，当前历史用 `chrome.history.addUrl`，旧页面只用真实 `POST /api/sync` 导入 D-01 平移样例。任何 API base 均不 route。
- 后端不可达由已确认无监听的 `http://127.0.0.1:9` 构造。保存 4100 的验收用例固定 `TEST_PORT=4100`；其他场景使用本条真实后端地址 B，避免共享数据。
- 权限失败加载本条临时扩展副本，只在副本 manifest 删除目标权限；不修改源 extension/。临时 context、后端、故障服务、扩展副本和工具目录全部在 finally 关闭/清理。
- UI 元素只用已登记 `getByTestId`；重复的 `diag-item-*` 需先定位所属检查容器，再在容器内定位子元素。11项枚举使用以下确切清单，禁止通配选择器：

- `diag-check-backend`
- `diag-check-tabs`
- `diag-check-history`
- `diag-check-storage`
- `diag-check-api-base-url`
- `diag-check-last-sync`
- `diag-check-rule-count`
- `diag-check-active-tab`
- `diag-check-privacy`
- `diag-check-incognito`
- `diag-check-version`

## 关键边界和验收依据

- 同步时间场景：正式 `SNAPSHOT_FILE` 开关启用真实快照后端，真实导入、health 读回后才写本地历史同步记录，避免重启/空库优先分支；不虚构 health 时间参数或版本环境变量。
- 规则缓存：以 `LIST_RULES` 的 network/cache 消息自然生成并读回，不猜测未冻结的 `cache.rules.data` 内部形状。消息使用契约 `{type,payload,requestId}` 与 `{ok,data}` 信封。
- 重新检测：用真实输入变更与临时插桩副本的函数计数同时验证；计数来源为项目已有覆盖率配方。阶段4需在隔离工具目录准备 `istanbul-lib-instrument`，当前工作区尚未安装此依赖。缺少计数即不能声称全部检查已重跑。
- 版本不兼容仅使用独立 UI 依赖故障服务，经真实 HTTP 返回版本2；明确不计为产品 health API 通过。
- 报告先制造实际含浏览 URL 的诊断详情，再检查真实剪贴板与 DOM 完全相同且已清除浏览 URL。
- 未承诺恢复后红点立即消失、保存提示包含地址、默认值不得落盘、固定1024字节误差或3000ms性能指标；这些不作为产品要求。

## 用例

### TC-UI-DIAG-001 后端可用时打开诊断页签：「后端服务连接」通过并显示 version=1.0.0 与本次耗时（毫秒）

- 优先级：P0 ｜ 类别：positive ｜ 技术：equivalence
- 关联 Feature：F-DIAG-01
- 验收引用：F-DIAG-01#AC1
- 关联 Code：C-FE-DIAG-01、C-FE-DIAG-09、C-FE-DIAG-11、C-FE-CORE-03
- 未来脚本：`tests/ui/TC-UI-DIAG-001.spec.mjs`
- 前置条件：
  - 每条用例使用独立 persistent Chromium context（channel=chromium）加载真实扩展，以 tab 打开 popup；真实产品后端启用 ENABLE_TEST_API=1，api 夹具在本条开始前调用 POST /api/__test__/reset；仅 route 外部站点，绝不 route 任何 API base。
  - 后端已启动（Playwright webServer，ENABLE_TEST_API=1）且使用默认配置
  - 夹具已把 chrome.storage.local.apiBaseUrl 写成测试后端地址（TEST_PORT，默认 4100）
  - 外部站点已由夹具离线化，且没有打开任何外部页面
  - finally 关闭本条创建的全部 popup、context、请求 context；如创建临时扩展副本/产品后端/依赖故障服务，先关闭 context，再停止并等待进程退出、关闭监听，最后删除本条临时目录；不清理其他用例资源。
- 测试数据：真实产品后端 GET /api/health 返回 status="ok"、version="1.0.0"；耗时为本次检查实际测得的非负有限毫秒数，不额外规定性能 SLA。；UI定位：所有重复diag-item-*均在所属登记diag-check容器内getByTestId查找。11项枚举只使用docs文档开头列出的完整登记testId，不用通配选择器。
- 步骤：
  - S1：以 tab 方式打开 popup（chrome-extension://<扩展 id>/popup/popup.html），等待顶栏 connection-status 出现
  - S2：点击 testId tab-diag 进入诊断页签，等待 testId diag-loading 消失、testId diag-checked-at 出现
  - S3：读取 testId diag-check-backend 的 data-status 及其子元素 diag-item-name / diag-item-value / diag-item-detail 文本，并读取 testId diag-summary 文本
- 预期：
  - E1：S1 后 connection-status 的 data-state="online"，文本「后端已连接」
  - E2：S2 后 panel-diag 可见、diag-loading 不可见；diag-checked-at 的 data-ts 为毫秒时间戳且与 Date.now() 相差 < 60000
  - E3：S3 的 diag-check-backend data-status="ok"，diag-item-name 文本为「后端服务连接」
  - E4：diag-item-value 包含 "1.0.0"；该项 diag-item-value 或 diag-item-detail 中显示明确以 ms 或「毫秒」标识的本次耗时，数值可解析为非负有限数。
  - E5：diag-summary 中的通过、警告、失败计数分别与 chrome.storage.local.lastDiagnostics.summary.ok / warn / fail 相同，不依赖文案中数字和名称的排列顺序。
- 证据目录：`evidence/TC-UI-DIAG-001/`
  - screenshot: 后端连接通过的诊断页
  - api: GET /api/health 请求响应与目标地址
  - server.log: 本次健康检查

### TC-UI-DIAG-002 后端不可达时「后端服务连接」失败，显示「连接被拒绝」并给出 4 条排查步骤（第 1 条含 ./scripts/start.sh）

- 优先级：P1 ｜ 类别：exception ｜ 技术：error-guessing
- 关联 Feature：F-DIAG-01
- 验收引用：F-DIAG-01#AC2
- 关联 Code：C-FE-DIAG-01、C-FE-DIAG-09、C-FE-DIAG-11
- 未来脚本：`tests/ui/TC-UI-DIAG-002.spec.mjs`
- 前置条件：
  - 每条用例使用独立 persistent Chromium context（channel=chromium）加载真实扩展，以 tab 打开 popup；真实产品后端启用 ENABLE_TEST_API=1，api 夹具在本条开始前调用 POST /api/__test__/reset；仅 route 外部站点，绝不 route 任何 API base。
  - 后端不可达场景由「没有服务监听的端口」构造（http://127.0.0.1:9），不是 route/mock
  - finally 关闭本条创建的全部 popup、context、请求 context；如创建临时扩展副本/产品后端/依赖故障服务，先关闭 context，再停止并等待进程退出、关闭监听，最后删除本条临时目录；不清理其他用例资源。
- 测试数据：排查步骤文案取自 PRD 第 9 章 / 前端方案 §9 第 1 行：(1) 运行 ./scripts/start.sh，(2) 核对端口与 API Base URL，(3) 确认 host_permissions 包含该地址，(4) 浏览器直接打开 /api/health；UI定位：所有重复diag-item-*均在所属登记diag-check容器内getByTestId查找。11项枚举只使用docs文档开头列出的完整登记testId，不用通配选择器。
- 步骤：
  - S1：调用夹具的 useUnreachableBackend()，把 chrome.storage.local.apiBaseUrl 写成 http://127.0.0.1:9
  - S2：打开 popup 并点击 tab-diag 进入诊断页签，等待 diag-loading 消失
  - S3：读取 testId diag-check-backend 的 data-status、diag-item-detail、testId diag-item-hint 内全部 diag-item-hint-step 文本，以及页面中 登记的 11 个检查项数量
- 预期：
  - E1：S3 的 diag-check-backend data-status="fail"
  - E2：diag-check-backend 内的 diag-item-detail 包含错误类型「连接被拒绝」。
  - E3：diag-item-hint 内 diag-item-hint-step 数量 = 4，且第 1 条包含 "./scripts/start.sh"
  - E4：第 2 条包含 "API Base URL"，第 3 条包含 "host_permissions"，第 4 条包含 "/api/health"
  - E5：诊断未被中断：页面中 上述11个登记检查项 数量 = 11，且 testId diag-summary 的失败计数 ≥ 1
- 证据目录：`evidence/TC-UI-DIAG-002/`
  - screenshot: 后端不可达的诊断页
  - extension.log: CHECK_CONNECTION 失败记录

### TC-UI-DIAG-003 后端不可达时顶栏「后端未连接」且诊断页签出现红点，改回可用地址后重新打开 popup 显示「后端已连接」

- 优先级：P1 ｜ 类别：state ｜ 技术：state-transition
- 关联 Feature：F-DIAG-01
- 验收引用：F-DIAG-01#AC3
- 关联 Code：C-FE-DIAG-02、C-FE-CORE-03
- 未来脚本：`tests/ui/TC-UI-DIAG-003.spec.mjs`
- 前置条件：
  - 每条用例使用独立 persistent Chromium context（channel=chromium）加载真实扩展，以 tab 打开 popup；真实产品后端启用 ENABLE_TEST_API=1，api 夹具在本条开始前调用 POST /api/__test__/reset；仅 route 外部站点，绝不 route 任何 API base。
  - 不可达地址用没有服务的端口 http://127.0.0.1:9，可用地址取测试后端地址（TEST_PORT）
  - finally 关闭本条创建的全部 popup、context、请求 context；如创建临时扩展副本/产品后端/依赖故障服务，先关闭 context，再停止并等待进程退出、关闭监听，最后删除本条临时目录；不清理其他用例资源。
- 测试数据：可用地址 = http://127.0.0.1:<TEST_PORT>（默认 4100，即本次测试后端）；storageKeys.apiBaseUrl 由 SET_API_BASE_URL 写入；UI定位：所有重复diag-item-*均在所属登记diag-check容器内getByTestId查找。11项枚举只使用docs文档开头列出的完整登记testId，不用通配选择器。
- 步骤：
  - S1：useUnreachableBackend() 后以 tab 方式打开 popup，读取 testId connection-status 与 testId tab-diag-alert
  - S2：点击 tab-diag 进入诊断页签，在 testId diag-api-base-url-input 填入测试后端地址并点击 testId diag-api-base-url-save，等待 testId diag-api-base-url-saved 出现
  - S3：读取 chrome.storage.local.apiBaseUrl
  - S4：关闭 popup 后重新以 tab 打开（reopenPopup），再次读取 connection-status 与 tab-diag-alert
- 预期：
  - E1：S1 的 connection-status data-state="offline"、文本「后端未连接」
  - E2：S1 的 tab-diag-alert 可见（诊断页签上的红点）
  - E3：S2 的 diag-api-base-url-saved 可见，diag-api-base-url-error 不可见。
  - E4：S3 的 apiBaseUrl 等于 "http://127.0.0.1:<TEST_PORT>"
  - E5：S4 的 connection-status data-state="online"，文本为「后端已连接」；此时红点可能仍由先前持久化的失败诊断控制，不把红点消失作为此 AC 的要求。
- 证据目录：`evidence/TC-UI-DIAG-003/`
  - screenshot: 未连接的顶栏与红点
  - screenshot: 恢复后的顶栏

### TC-UI-DIAG-004 存储中没有 apiBaseUrl 时诊断页显示默认地址 http://127.0.0.1:3000

- 优先级：P0 ｜ 类别：positive ｜ 技术：equivalence
- 关联 Feature：F-DIAG-02
- 验收引用：F-DIAG-02#AC1
- 关联 Code：C-FE-DIAG-03、C-FE-CORE-04、C-FE-CORE-03
- 未来脚本：`tests/ui/TC-UI-DIAG-004.spec.mjs`
- 前置条件：
  - 每条用例使用独立 persistent Chromium context（channel=chromium）加载真实扩展，以 tab 打开 popup；真实产品后端启用 ENABLE_TEST_API=1，api 夹具在本条开始前调用 POST /api/__test__/reset；仅 route 外部站点，绝不 route 任何 API base。
  - 用 swEval 执行 chrome.storage.local.remove('apiBaseUrl')，模拟首次安装（默认值来自共享常量 DEFAULTS）
  - finally 关闭本条创建的全部 popup、context、请求 context；如创建临时扩展副本/产品后端/依赖故障服务，先关闭 context，再停止并等待进程退出、关闭监听，最后删除本条临时目录；不清理其他用例资源。
- 测试数据：默认值 http://127.0.0.1:3000 来自 D-11 / FE-API-02 与 ui-contract.storageKeys.apiBaseUrl；UI定位：所有重复diag-item-*均在所属登记diag-check容器内getByTestId查找。11项枚举只使用docs文档开头列出的完整登记testId，不用通配选择器。
- 步骤：
  - S1：在 service worker 中删除 apiBaseUrl，然后以 tab 方式打开 popup 并进入诊断页签
  - S2：读取 testId diag-api-base-url-current 文本、testId diag-api-base-url-input 的 value，以及 testId diag-check-api-base-url 的 data-status 与 diag-item-value 文本
- 预期：
  - E1：diag-api-base-url-current 文本 = "http://127.0.0.1:3000"
  - E2：diag-api-base-url-input 的 value = "http://127.0.0.1:3000"
  - E3：diag-check-api-base-url data-status="ok"，diag-item-value 文本包含 "http://127.0.0.1:3000"
- 证据目录：`evidence/TC-UI-DIAG-004/`
  - screenshot: 诊断页显示默认地址

### TC-UI-DIAG-005 把地址保存为 http://127.0.0.1:4100 后重新打开：地址持久化，真实后端请求全部使用新地址

- 优先级：P0 ｜ 类别：positive ｜ 技术：state-transition
- 关联 Feature：F-DIAG-02
- 验收引用：F-DIAG-02#AC2
- 关联 Code：C-FE-DIAG-03、C-FE-CORE-03、C-FE-CORE-04
- 未来脚本：`tests/ui/TC-UI-DIAG-005.spec.mjs`
- 前置条件：
  - 每条用例使用独立 persistent Chromium context（channel=chromium）加载真实扩展，以 tab 打开 popup；真实产品后端启用 ENABLE_TEST_API=1，api 夹具在本条开始前调用 POST /api/__test__/reset；仅 route 外部站点，绝不 route 任何 API base。
  - 基线地址先指向没有服务的端口（http://127.0.0.1:9），保证「换地址后请求真的换目标」可被观察到
  - finally 关闭本条创建的全部 popup、context、请求 context；如创建临时扩展副本/产品后端/依赖故障服务，先关闭 context，再停止并等待进程退出、关闭监听，最后删除本条临时目录；不清理其他用例资源。
- 测试数据：本条 TEST_PORT=4100；目标固定 B=http://127.0.0.1:4100，独占本条产品后端。旧地址 O=http://127.0.0.1:9 确认无监听。诊断 UI 的健康检查和配置查询为实际 HTTP，不路由或伪造返回。；UI定位：所有重复diag-item-*均在所属登记diag-check容器内getByTestId查找。11项枚举只使用docs文档开头列出的完整登记testId，不用通配选择器。
- 步骤：
  - S1：把 apiBaseUrl 写成 O，打开 popup → tab-diag，等待初轮完成并记录后端连接失败；等待旧地址请求均结束。
  - S2：在 context.on("request") 注册只读监听，用 request.serviceWorker() 识别扩展 SW 来源并记录 URL/method；仅记录，不拦截或改变请求。在 diag-api-base-url-input 填入 B，点击 diag-api-base-url-save，等待保存提示。
  - S3：关闭并重新打开 popup，点击 tab-diag 后点击 diag-rerun-button；等待本轮完成，读取 diag-api-base-url-current、输入框值、storage.apiBaseUrl、diag-check-backend 和 connection-status。
  - S4：从保存完成到本轮诊断结束，收集扩展发起的全部 /api/ 请求；用真实后端 access 日志与响应关联证明健康检查和配置查询已到达 B。
- 预期：
  - E1：S1 的 diag-check-backend data-status="fail"（旧地址没有服务）。
  - E2：S2 的 diag-api-base-url-saved 可见，diag-api-base-url-error 不可见。
  - E3：重新打开后的 diag-api-base-url-current 文本、输入框值、chrome.storage.local.apiBaseUrl 均等于 "http://127.0.0.1:4100"。
  - E4：S3 的 diag-check-backend data-status="ok"，version 显示 "1.0.0"，connection-status data-state="online"。
  - E5：S4 至少观察到 GET /api/health、GET /api/config；保存后的全部后端请求 origin 均等于 "http://127.0.0.1:4100"，不再向 O 发起新请求，且真实后端记录了这些请求。
- 证据目录：`evidence/TC-UI-DIAG-005/`
  - screenshot: 重开后的地址与连接状态
  - network: 扩展 SW 请求目标、时间、方法、真实响应
  - storage: apiBaseUrl 读回
  - server.log: 请求关联

### TC-UI-DIAG-006 输入 not-a-url 保存时提示「地址格式错误」，storage 中的 apiBaseUrl 保持原值

- 优先级：P1 ｜ 类别：negative ｜ 技术：error-guessing
- 关联 Feature：F-DIAG-02
- 验收引用：F-DIAG-02#AC3
- 关联 Code：C-FE-DIAG-03
- 未来脚本：`tests/ui/TC-UI-DIAG-006.spec.mjs`
- 前置条件：
  - 每条用例使用独立 persistent Chromium context（channel=chromium）加载真实扩展，以 tab 打开 popup；真实产品后端启用 ENABLE_TEST_API=1，api 夹具在本条开始前调用 POST /api/__test__/reset；仅 route 外部站点，绝不 route 任何 API base。
  - 先用夹具把 apiBaseUrl 写成测试后端地址作为原值
  - finally 关闭本条创建的全部 popup、context、请求 context；如创建临时扩展副本/产品后端/依赖故障服务，先关闭 context，再停止并等待进程退出、关闭监听，最后删除本条临时目录；不清理其他用例资源。
- 测试数据：非法输入 not-a-url；错误文案「地址格式错误」来自 ui-contract 的 diag-api-base-url-error；UI定位：所有重复diag-item-*均在所属登记diag-check容器内getByTestId查找。11项枚举只使用docs文档开头列出的完整登记testId，不用通配选择器。
- 步骤：
  - S1：打开 popup → 诊断页签，在 diag-api-base-url-input 填入 "not-a-url" 并点击 diag-api-base-url-save
  - S2：读取 testId diag-api-base-url-error、testId diag-api-base-url-saved 与 chrome.storage.local.apiBaseUrl
  - S3：再点击一次 diag-rerun-button，读取 diag-api-base-url-current
- 预期：
  - E1：S2 的 diag-api-base-url-error 可见，文本包含「地址格式错误」
  - E2：S2 的 chrome.storage.local.apiBaseUrl 仍为 "http://127.0.0.1:<TEST_PORT>"（保持原值）
  - E3：S2 的 diag-api-base-url-saved 不可见（没有保存成功提示）
  - E4：S3 的 diag-api-base-url-current 仍显示 "http://127.0.0.1:<TEST_PORT>"
- 证据目录：`evidence/TC-UI-DIAG-006/`
  - screenshot: 地址格式错误提示

### TC-UI-DIAG-007 端口越界的地址（65536）按格式错误拒绝，storage 中的 apiBaseUrl 保持原值

- 优先级：P1 ｜ 类别：boundary ｜ 技术：boundary
- 关联 Feature：F-DIAG-02
- 验收引用：F-DIAG-02#AC3
- 关联 Code：C-FE-DIAG-03
- 未来脚本：`tests/ui/TC-UI-DIAG-007.spec.mjs`
- 前置条件：
  - 每条用例使用独立 persistent Chromium context（channel=chromium）加载真实扩展，以 tab 打开 popup；真实产品后端启用 ENABLE_TEST_API=1，api 夹具在本条开始前调用 POST /api/__test__/reset；仅 route 外部站点，绝不 route 任何 API base。
  - 先用夹具把 apiBaseUrl 写成测试后端地址作为原值
  - finally 关闭本条创建的全部 popup、context、请求 context；如创建临时扩展副本/产品后端/依赖故障服务，先关闭 context，再停止并等待进程退出、关闭监听，最后删除本条临时目录；不清理其他用例资源。
- 测试数据：URL 端口合法上限为 65535（max+1 = 65536）；new URL("http://127.0.0.1:65536") 解析失败，落入「地址格式错误」等价类；UI定位：所有重复diag-item-*均在所属登记diag-check容器内getByTestId查找。11项枚举只使用docs文档开头列出的完整登记testId，不用通配选择器。
- 步骤：
  - S1：打开 popup → 诊断页签，在 diag-api-base-url-input 填入 "http://127.0.0.1:65536" 并点击 diag-api-base-url-save
  - S2：读取 diag-api-base-url-error、diag-api-base-url-saved、diag-api-base-url-current 与 chrome.storage.local.apiBaseUrl
- 预期：
  - E1：S2 的 diag-api-base-url-error 可见，文本包含「地址格式错误」
  - E2：S2 的 chrome.storage.local.apiBaseUrl 仍为 "http://127.0.0.1:<TEST_PORT>"
  - E3：S2 的 diag-api-base-url-current 仍显示 "http://127.0.0.1:<TEST_PORT>"，diag-api-base-url-saved 不可见
- 证据目录：`evidence/TC-UI-DIAG-007/`
  - screenshot: 端口越界的错误提示

### TC-UI-DIAG-008 保存未授权的本机 HTTPS 地址显示授权警告，改回 4100 后地址与真实请求恢复

- 优先级：P1 ｜ 类别：exception ｜ 技术：error-guessing
- 关联 Feature：F-DIAG-02
- 验收引用：F-DIAG-02#AC2
- 关联 Code：C-FE-DIAG-03、C-FE-CORE-03、C-FE-CORE-04
- 未来脚本：`tests/ui/TC-UI-DIAG-008.spec.mjs`
- 前置条件：
  - 每条用例使用独立 persistent Chromium context（channel=chromium）加载真实扩展，以 tab 打开 popup；真实产品后端启用 ENABLE_TEST_API=1，api 夹具在本条开始前调用 POST /api/__test__/reset；仅 route 外部站点，绝不 route 任何 API base。
  - 本条仅用本机协议未授权场景；不向 example.invalid 等外部主机发送后端请求，也不对本机 API 做 route。
  - finally 关闭本条创建的全部 popup、context、请求 context；如创建临时扩展副本/产品后端/依赖故障服务，先关闭 context，再停止并等待进程退出、关闭监听，最后删除本条临时目录；不清理其他用例资源。
- 测试数据：原 manifest 仅授权 http://127.0.0.1/* 和 http://localhost/*；U=https://127.0.0.1:4100 的协议未授权，不涉及外部站点 route。B=http://127.0.0.1:4100 为本条已启动的真实产品后端。；UI定位：所有重复diag-item-*均在所属登记diag-check容器内getByTestId查找。11项枚举只使用docs文档开头列出的完整登记testId，不用通配选择器。
- 步骤：
  - S1：本条 TEST_PORT=4100；用默认扩展打开 popup → tab-diag，在 diag-api-base-url-input 输入 U 并点击保存。
  - S2：读取 diag-api-base-url-saved 文本、storage.apiBaseUrl；点击 diag-rerun-button 后读取 diag-check-api-base-url 的状态与排查步骤。
  - S3：将输入改为 B，点击保存；在保存前注册 context.on("request") 只读监听，保存后关闭并重新打开 popup → tab-diag，完成一轮检测。
  - S4：读取当前地址、输入框、storage 与后端检查，核对从 B 保存完成起扩展 SW 实际 /api/ 请求的 origin。
- 预期：
  - E1：S2 的 diag-api-base-url-saved 可见，提示明确包含「未授权」或「未授予」的说明；storage.apiBaseUrl=U。
  - E2：S2 的 diag-check-api-base-url data-status="warn"，其 diag-item-hint-step 至少一条包含 "host_permissions"；登记的检查项共 11 个。
  - E3：S4 重开后的当前地址、输入框与 storage.apiBaseUrl 都等于 "http://127.0.0.1:4100"，diag-check-api-base-url data-status="ok"。
  - E4：S4 的 diag-check-backend data-status="ok"，且观察到真实 GET /api/health、GET /api/config；B 保存完成后的全部 /api/ 新请求 origin 均为 B。
- 证据目录：`evidence/TC-UI-DIAG-008/`
  - screenshot: 未授权说明和恢复后地址
  - network: SW 实际请求和真实响应
  - storage: 地址读回

### TC-UI-DIAG-009 当前窗口打开 https://react.dev/learn 时「tabs 权限」显示通过

- 优先级：P0 ｜ 类别：positive ｜ 技术：equivalence
- 关联 Feature：F-DIAG-03
- 验收引用：F-DIAG-03#AC1
- 关联 Code：C-FE-DIAG-04、C-FE-DIAG-11
- 未来脚本：`tests/ui/TC-UI-DIAG-009.spec.mjs`
- 前置条件：
  - 每条用例使用独立 persistent Chromium context（channel=chromium）加载真实扩展，以 tab 打开 popup；真实产品后端启用 ENABLE_TEST_API=1，api 夹具在本条开始前调用 POST /api/__test__/reset；仅 route 外部站点，绝不 route 任何 API base。
  - react.dev 由夹具 mocksites/默认 route 离线化，只提供 <title>，不访问外网
  - finally 关闭本条创建的全部 popup、context、请求 context；如创建临时扩展副本/产品后端/依赖故障服务，先关闭 context，再停止并等待进程退出、关闭监听，最后删除本条临时目录；不清理其他用例资源。
- 测试数据：tabs 检查 = permissions.contains({permissions:['tabs']}) 且 tabs.query({}) 中至少一个 http(s) 标签页 url 可读（前端方案 §9 第 2 行）；UI定位：所有重复diag-item-*均在所属登记diag-check容器内getByTestId查找。11项枚举只使用docs文档开头列出的完整登记testId，不用通配选择器。
- 步骤：
  - S1：以 tab 方式打开 https://react.dev/learn（夹具离线化），保持该标签页是当前活动标签页
  - S2：以 tab 方式打开 popup → 诊断页签，等待 diag-loading 消失
  - S3：读取 testId diag-check-tabs 的 data-status、diag-item-name、diag-item-status 文本
- 预期：
  - E1：S3 的 diag-check-tabs data-status="ok"
  - E2：diag-item-name 文本为「tabs 权限」，diag-item-status 文本为「通过」
  - E3：登记的 11 个检查项数量 = 11（其余检查项照常渲染）
- 证据目录：`evidence/TC-UI-DIAG-009/`
  - screenshot: tabs 权限通过

### TC-UI-DIAG-010 加载删掉 tabs 权限的扩展副本时「tabs 权限」失败，并给出两条排查建议

- 优先级：P1 ｜ 类别：exception ｜ 技术：error-guessing
- 关联 Feature：F-DIAG-03
- 验收引用：F-DIAG-03#AC2
- 关联 Code：C-FE-DIAG-04、C-FE-DIAG-09、C-FE-DIAG-11
- 未来脚本：`tests/ui/TC-UI-DIAG-010.spec.mjs`
- 前置条件：
  - 每条用例使用独立 persistent Chromium context（channel=chromium）加载真实扩展，以 tab 打开 popup；真实产品后端启用 ENABLE_TEST_API=1，api 夹具在本条开始前调用 POST /api/__test__/reset；仅 route 外部站点，绝不 route 任何 API base。
  - 把 extension/ 复制到临时目录（不改产品源码），从 manifest.json 的 permissions 中删除 "tabs"，用 chromium.launchPersistentContext + --load-extension 指向该副本（真实扩展，权限确实缺失）
  - finally 关闭本条创建的全部 popup、context、请求 context；如创建临时扩展副本/产品后端/依赖故障服务，先关闭 context，再停止并等待进程退出、关闭监听，最后删除本条临时目录；不清理其他用例资源。
- 测试数据：排查建议文案取自 PRD 第 9 章第 2 行：「检查 manifest 的 permissions」与「在 chrome://extensions 中重新加载」；UI定位：所有重复diag-item-*均在所属登记diag-check容器内getByTestId查找。11项枚举只使用docs文档开头列出的完整登记testId，不用通配选择器。
- 步骤：
  - S1：上述临时副本把 apiBaseUrl 写成测试后端地址，然后以 tab 方式打开 popup → 诊断页签，等待 diag-loading 消失
  - S2：读取 diag-check-tabs 的 data-status、diag-item-detail 与全部 diag-item-hint-step 文本
  - S3：读取 diag-check-history 的 data-status 与 登记的 11 个检查项数量
- 预期：
  - E1：S2 的 diag-check-tabs data-status="fail"
  - E2：S2 的 diag-item-detail 非空，说明权限缺失的原因；diag-item-name 明确为「tabs 权限」。
  - E3：S2 的 diag-item-hint-step 至少 2 条，其中一条包含「检查 manifest 的 permissions」，另一条包含「在 chrome://extensions 中重新加载」
  - E4：S3 的 diag-check-history data-status="ok"（只删了 tabs，history 不受影响），登记的 11 个检查项数量 = 11
- 证据目录：`evidence/TC-UI-DIAG-010/`
  - screenshot: tabs 权限失败的诊断页
  - extension.log: 临时副本的 console

### TC-UI-DIAG-011 manifest 声明了 history 权限时「history 权限」显示通过

- 优先级：P0 ｜ 类别：positive ｜ 技术：equivalence
- 关联 Feature：F-DIAG-04
- 验收引用：F-DIAG-04#AC1
- 关联 Code：C-FE-DIAG-04、C-FE-DIAG-11
- 未来脚本：`tests/ui/TC-UI-DIAG-011.spec.mjs`
- 前置条件：
  - 每条用例使用独立 persistent Chromium context（channel=chromium）加载真实扩展，以 tab 打开 popup；真实产品后端启用 ENABLE_TEST_API=1，api 夹具在本条开始前调用 POST /api/__test__/reset；仅 route 外部站点，绝不 route 任何 API base。
  - 使用未改动的 extension/ 目录（manifest 含 history 权限）
  - finally 关闭本条创建的全部 popup、context、请求 context；如创建临时扩展副本/产品后端/依赖故障服务，先关闭 context，再停止并等待进程退出、关闭监听，最后删除本条临时目录；不清理其他用例资源。
- 测试数据：history 检查 = contains(['history']) 且 history.search({text:'', startTime:now−1d, maxResults:1}) 不抛错（前端方案 §9 第 3 行）；UI定位：所有重复diag-item-*均在所属登记diag-check容器内getByTestId查找。11项枚举只使用docs文档开头列出的完整登记testId，不用通配选择器。
- 步骤：
  - S1：通过 service worker 的 chrome.history.addUrl({url:"https://react.dev/learn"}) 写入本条当前时间的历史；不使用addUrl伪造旧时间或访问次数。
  - S2：打开 popup → 诊断页签，等待 diag-loading 消失
  - S3：读取 testId diag-check-history 的 data-status、diag-item-name、diag-item-status 文本
- 预期：
  - E1：S3 的 diag-check-history data-status="ok"
  - E2：diag-item-name 文本为「history 权限」，diag-item-status 文本为「通过」
  - E3：登记的 11 个检查项数量 = 11
- 证据目录：`evidence/TC-UI-DIAG-011/`
  - screenshot: history 权限通过

### TC-UI-DIAG-012 加载删掉 history 权限的扩展副本时「history 权限」失败，并提示检查 manifest 的 permissions

- 优先级：P1 ｜ 类别：exception ｜ 技术：error-guessing
- 关联 Feature：F-DIAG-04
- 验收引用：F-DIAG-04#AC2
- 关联 Code：C-FE-DIAG-04、C-FE-DIAG-09、C-FE-DIAG-11
- 未来脚本：`tests/ui/TC-UI-DIAG-012.spec.mjs`
- 前置条件：
  - 每条用例使用独立 persistent Chromium context（channel=chromium）加载真实扩展，以 tab 打开 popup；真实产品后端启用 ENABLE_TEST_API=1，api 夹具在本条开始前调用 POST /api/__test__/reset；仅 route 外部站点，绝不 route 任何 API base。
  - 把 extension/ 复制到临时目录，从 manifest.json 的 permissions 中删除 "history"，以 --load-extension 加载该副本（不改产品源码）
  - finally 关闭本条创建的全部 popup、context、请求 context；如创建临时扩展副本/产品后端/依赖故障服务，先关闭 context，再停止并等待进程退出、关闭监听，最后删除本条临时目录；不清理其他用例资源。
- 测试数据：排查建议文案取自 PRD 第 9 章第 3 行：「检查 manifest 的 permissions」；UI定位：所有重复diag-item-*均在所属登记diag-check容器内getByTestId查找。11项枚举只使用docs文档开头列出的完整登记testId，不用通配选择器。
- 步骤：
  - S1：上述临时副本把 apiBaseUrl 写成测试后端地址，然后打开 popup → 诊断页签，等待 diag-loading 消失
  - S2：读取 diag-check-history 的 data-status、diag-item-detail 与全部 diag-item-hint-step 文本
  - S3：读取 diag-check-tabs 的 data-status 与 登记的 11 个检查项数量
- 预期：
  - E1：S2 的 diag-check-history data-status="fail"
  - E2：S2 的 diag-item-hint-step 至少 1 条包含「检查 manifest 的 permissions」
  - E3：S2 的 diag-item-detail 非空，说明权限缺失的原因；diag-item-name 明确为「history 权限」。
  - E4：S3 的 diag-check-tabs data-status="ok"（只删了 history），登记的 11 个检查项数量 = 11
- 证据目录：`evidence/TC-UI-DIAG-012/`
  - screenshot: history 权限失败的诊断页

### TC-UI-DIAG-013 插件已加载时「storage 可用」通过，并显示已使用字节数

- 优先级：P0 ｜ 类别：positive ｜ 技术：equivalence
- 关联 Feature：F-DIAG-05
- 验收引用：F-DIAG-05#AC1
- 关联 Code：C-FE-DIAG-05、C-FE-DIAG-11
- 未来脚本：`tests/ui/TC-UI-DIAG-013.spec.mjs`
- 前置条件：
  - 每条用例使用独立 persistent Chromium context（channel=chromium）加载真实扩展，以 tab 打开 popup；真实产品后端启用 ENABLE_TEST_API=1，api 夹具在本条开始前调用 POST /api/__test__/reset；仅 route 外部站点，绝不 route 任何 API base。
  - 插件已加载（未改动 extension/），storage 可写
  - finally 关闭本条创建的全部 popup、context、请求 context；如创建临时扩展副本/产品后端/依赖故障服务，先关闭 context，再停止并等待进程退出、关闭监听，最后删除本条临时目录；不清理其他用例资源。
- 测试数据：检查 = 写 __diag__ → 读比对 → 删除（finally），value 为 getBytesInUse(null) 字节数（前端方案 §9 第 4 行）；UI定位：所有重复diag-item-*均在所属登记diag-check容器内getByTestId查找。11项枚举只使用docs文档开头列出的完整登记testId，不用通配选择器。
- 步骤：
  - S1：打开 popup → 诊断页签，等待 diag-loading 消失
  - S2：读取 testId diag-check-storage 的 data-status 与其 diag-item-value / diag-item-detail 文本
  - S3：在 service worker 中读取 chrome.storage.local.getBytesInUse(null)
- 预期：
  - E1：diag-check-storage data-status="ok"，对应 diag-item-status 文本为「通过」。
  - E2：diag-item-value 或 diag-item-detail 显示已用字节数，数值可解析为非负整数，并用「字节」或 bytes/B 标明单位；S3 的后测 getBytesInUse 仅作为观测，不与检测时快照使用任意固定误差比较。
- 证据目录：`evidence/TC-UI-DIAG-013/`
  - screenshot: storage 可用与字节数

### TC-UI-DIAG-014 诊断完成后 chrome.storage.local 中不残留 __diag__ 探测键

- 优先级：P1 ｜ 类别：state ｜ 技术：state-transition
- 关联 Feature：F-DIAG-05
- 验收引用：F-DIAG-05#AC2
- 关联 Code：C-FE-DIAG-05、C-FE-DIAG-09
- 未来脚本：`tests/ui/TC-UI-DIAG-014.spec.mjs`
- 前置条件：
  - 每条用例使用独立 persistent Chromium context（channel=chromium）加载真实扩展，以 tab 打开 popup；真实产品后端启用 ENABLE_TEST_API=1，api 夹具在本条开始前调用 POST /api/__test__/reset；仅 route 外部站点，绝不 route 任何 API base。
  - 使用真实后端（默认配置）
  - finally 关闭本条创建的全部 popup、context、请求 context；如创建临时扩展副本/产品后端/依赖故障服务，先关闭 context，再停止并等待进程退出、关闭监听，最后删除本条临时目录；不清理其他用例资源。
- 测试数据：探测键名 __diag__（ui-contract.storageKeys.__diag__：写 → 读 → 删，诊断结束后不得残留）；UI定位：所有重复diag-item-*均在所属登记diag-check容器内getByTestId查找。11项枚举只使用docs文档开头列出的完整登记testId，不用通配选择器。
- 步骤：
  - S1：打开 popup → 诊断页签，等待 diag-loading 消失、11 项检测完成
  - S2：在 service worker 中读取 chrome.storage.local.get(null)，检查键名集合
  - S3：再点击 diag-rerun-button，等待检测完成后重复 S2 的读取
- 预期：
  - E1：S2 的键名集合不包含 "__diag__"
  - E2：S3 的键名集合同样不包含 "__diag__"（每次检测都清理）
  - E3：两次检测都完成：diag-check-storage data-status="ok"，且 登记的 11 个检查项数量 = 11
- 证据目录：`evidence/TC-UI-DIAG-014/`
  - screenshot: 检测完成后的诊断页
  - storage dump: get(null) 的键名列表

### TC-UI-DIAG-015 从未同步时「最近一次同步」警告「从未同步」，并提供「立即同步」入口

- 优先级：P1 ｜ 类别：state ｜ 技术：state-transition
- 关联 Feature：F-DIAG-06
- 验收引用：F-DIAG-06#AC1
- 关联 Code：C-FE-DIAG-06、C-FE-DIAG-11
- 未来脚本：`tests/ui/TC-UI-DIAG-015.spec.mjs`
- 前置条件：
  - 每条用例使用独立 persistent Chromium context（channel=chromium）加载真实扩展，以 tab 打开 popup；真实产品后端启用 ENABLE_TEST_API=1，api 夹具在本条开始前调用 POST /api/__test__/reset；仅 route 外部站点，绝不 route 任何 API base。
  - 在 service worker 中删除 syncState 键（模拟从未同步）、apiBaseUrl 指向测试后端
  - finally 关闭本条创建的全部 popup、context、请求 context；如创建临时扩展副本/产品后端/依赖故障服务，先关闭 context，再停止并等待进程退出、关闭监听，最后删除本条临时目录；不清理其他用例资源。
- 测试数据：syncState 结构依 ui-contract.storageKeys.syncState；从未同步时 status 为 idle、lastSuccessAt 为 null；UI定位：所有重复diag-item-*均在所属登记diag-check容器内getByTestId查找。11项枚举只使用docs文档开头列出的完整登记testId，不用通配选择器。
- 步骤：
  - S1：swEval 执行 chrome.storage.local.remove('syncState')，然后打开 popup → 诊断页签，等待 diag-loading 消失
  - S2：读取 diag-check-last-sync 的 data-status、diag-item-detail 文本，并检查 testId diag-sync-now-button 是否可见
- 预期：
  - E1：S2 的 diag-check-last-sync data-status="warn"
  - E2：diag-item-detail 文本包含「从未同步」
  - E3：diag-sync-now-button 可见（提供同步入口）
  - E4：该诊断项没有把其他项带崩：登记的 11 个检查项数量 = 11
- 证据目录：`evidence/TC-UI-DIAG-015/`
  - screenshot: 从未同步的警告与同步入口

### TC-UI-DIAG-016 最近一次成功同步在 10 分钟前时显示通过，并显示最近同步时间与上传条数

- 优先级：P0 ｜ 类别：positive ｜ 技术：scenario
- 关联 Feature：F-DIAG-06
- 验收引用：F-DIAG-06#AC2
- 关联 Code：C-FE-DIAG-06、C-FE-DIAG-11
- 未来脚本：`tests/ui/TC-UI-DIAG-016.spec.mjs`
- 前置条件：
  - 本条自行启动真实产品后端：PORT=P ENABLE_TEST_API=1 SNAPSHOT_FILE=<本条临时目录>/snapshot.json node server/src/index.js；P为本条专用空闲端口，B=http://127.0.0.1:P；真实 GET /api/health 就绪后执行 POST /api/__test__/reset。扩展用独立 persistent Chromium context，popup 以 tab 打开，外站离线，绝不 route B。
  - SNAPSHOT_FILE 是后端方案 §3.5 的正式开关；不改源码、不伪造 health，不使用不存在的 health?now 或 APP_VERSION 环境覆盖。finally 先关 context/请求 context，再 SIGTERM 本条后端并等待退出、删除本条临时目录。
- 测试数据：捕获本轮服务工作线程 Date.now() 为 T；L=T−10×60000（10 分钟）。样例按 D-01 平移后真实导入；health必须persistence="snapshot"、pageCount=10、lastSyncAt非null，因此不会触发memory.startedAt>lastSuccessAt/空库分支。syncState={status:"success",startedAt:L,lastSyncAt:L,lastSuccessAt:L,lastError:null,cursor:null,cursorBase:{apiBaseUrl:B,serverStartedAt:H.startedAt},fullReason:null,mode:"full",trigger:"user",stats:{uploaded:14,filtered:0,received:R.received,created:R.created,updated:R.updated,rejected:R.rejected}}；connection={status:"online",recoverPending:false,lastErrorCode:null}，其他必要时间字段取本轮T。；UI定位：所有重复diag-item-*均在所属登记diag-check容器内getByTestId查找。11项枚举只使用docs文档开头列出的完整登记testId，不用通配选择器。
- 步骤：
  - S1：在 B 上真实 POST /api/sync 导入 samplePayload（resource.json 按 D-01 平移），保留完整响应 R；GET /api/health 保留 H，确认快照模式、10个页面和非null同步时间。
  - S2：在 SW 捕获 T，令 L=T−10×60000，写入 testData 所列完整 syncState、apiBaseUrl=B 和 connection；读回确认 L 与统计值，之后再打开 popup。
  - S3：以 tab 打开 popup → tab-diag，等待 diag-loading 消失，读取 diag-check-last-sync 的 data-status、diag-item-detail 和 diag-item-value；保留本轮 lastDiagnostics。
- 预期：
  - E1：S1 的真实导入响应 HTTP 200，received=14、created=10、updated=4、rejected=0；H.persistence="snapshot"、H.pageCount=10、H.lastSyncAt=R.syncedAt。
  - E2：S3 的 diag-check-last-sync data-status="ok"，状态文本为「通过」。
  - E3：最近同步详情或数值显示上传条数 "14"，同步时间按该浏览器的时区/显示格式与 L 对应的分钟完全一致（由 L 计算期望，不使用 ±1 分钟容差）。
  - E4：该项文本不包含「后端数据少于本地同步记录」，也不包含「超过 24 小时未同步」。
- 证据目录：`evidence/TC-UI-DIAG-016/`
  - api: B 的 reset、sync、health 请求响应
  - storage: 写入和读回的 syncState/connection
  - screenshot: 本轮最近同步状态
  - server.log: 本条真实 snapshot 后端

### TC-UI-DIAG-017 最近一次同步失败时显示失败与失败原因，并建议先处理「后端服务连接」

- 优先级：P1 ｜ 类别：exception ｜ 技术：error-guessing
- 关联 Feature：F-DIAG-06
- 验收引用：F-DIAG-06#AC3
- 关联 Code：C-FE-DIAG-06、C-FE-DIAG-09、C-FE-DIAG-11
- 未来脚本：`tests/ui/TC-UI-DIAG-017.spec.mjs`
- 前置条件：
  - 使用真实产品后端 B、独立扩展 context，api 夹具先 POST /api/__test__/reset；外部站点离线，绝不 route B。
  - 先真实 POST /api/sync 导入平移样例使 pageCount=10；设置非网络错误以构造本地最近同步失败展示，不把合成的本地记录视为实际执行了失败同步。
  - finally 关闭本条全部 context；不修改产品源码与其他用例资源。
- 测试数据：非网络错误 lastError={code:"VALIDATION_FAILED",message:"openTabs 必须为数组"}；该错误码来自 POST /api/sync 契约。同步失败分支位于重启分支之前；设置 lastSuccessAt=T−5min（非null）、connection.recoverPending=false，避免打开在线 popup 时触发网络恢复同步。；UI定位：所有重复diag-item-*均在所属登记diag-check容器内getByTestId查找。11项枚举只使用docs文档开头列出的完整登记testId，不用通配选择器。
- 步骤：
  - S1：真实导入样例后在 SW 捕获 T，写 apiBaseUrl=B 与 syncState={status:"error",startedAt:T,lastSyncAt:T,lastSuccessAt:T−300000,lastError:{code:"VALIDATION_FAILED",message:"openTabs 必须为数组"},cursor:null,cursorBase:null,fullReason:null,mode:"full",trigger:"user",stats:{uploaded:0,filtered:0,received:0,created:0,updated:0,rejected:0}}；写 connection={status:"online",since:T,lastCheckedAt:T,lastErrorCode:null,recoverPending:false}。
  - S2：注册 context.on("request") 只读监听并以 tab 打开 popup → tab-diag，完成检测。
  - S3：读取 diag-check-last-sync 的状态、detail 和 hint，读回 syncState；核对打开 popup 后是否产生了新 POST /api/sync。
- 预期：
  - E1：diag-check-last-sync data-status="fail"，状态文本为「失败」。
  - E2：diag-item-detail 包含固定失败原因「openTabs 必须为数组」。
  - E3：该项 diag-item-hint-step 至少1条包含「后端服务连接」。
  - E4：登记的11个检查项均渲染，diag-check-backend data-status="ok"；syncState 仍为 error/VALIDATION_FAILED，打开后没有自动 POST /api/sync 覆盖本条失败记录。
- 证据目录：`evidence/TC-UI-DIAG-017/`
  - api: 真实样例导入
  - storage: 非网络错误读回
  - network: popup 打开后的请求列表
  - screenshot: 最近一次同步失败

### TC-UI-DIAG-018 最近一次成功同步在 25 小时前（24 小时 + 1 小时）时警告「超过 24 小时未同步」

- 优先级：P1 ｜ 类别：boundary ｜ 技术：boundary
- 关联 Feature：F-DIAG-06
- 验收引用：F-DIAG-06#AC4
- 关联 Code：C-FE-DIAG-06、C-FE-DIAG-11
- 未来脚本：`tests/ui/TC-UI-DIAG-018.spec.mjs`
- 前置条件：
  - 本条自行启动真实产品后端：PORT=P ENABLE_TEST_API=1 SNAPSHOT_FILE=<本条临时目录>/snapshot.json node server/src/index.js；P为本条专用空闲端口，B=http://127.0.0.1:P；真实 GET /api/health 就绪后执行 POST /api/__test__/reset。扩展用独立 persistent Chromium context，popup 以 tab 打开，外站离线，绝不 route B。
  - SNAPSHOT_FILE 是后端方案 §3.5 的正式开关；不改源码、不伪造 health，不使用不存在的 health?now 或 APP_VERSION 环境覆盖。finally 先关 context/请求 context，再 SIGTERM 本条后端并等待退出、删除本条临时目录。
- 测试数据：捕获本轮服务工作线程 Date.now() 为 T；L=T−1500×60000（25 小时）。样例按 D-01 平移后真实导入；health必须persistence="snapshot"、pageCount=10、lastSyncAt非null，因此不会触发memory.startedAt>lastSuccessAt/空库分支。syncState={status:"success",startedAt:L,lastSyncAt:L,lastSuccessAt:L,lastError:null,cursor:null,cursorBase:{apiBaseUrl:B,serverStartedAt:H.startedAt},fullReason:null,mode:"full",trigger:"user",stats:{uploaded:14,filtered:0,received:R.received,created:R.created,updated:R.updated,rejected:R.rejected}}；connection={status:"online",recoverPending:false,lastErrorCode:null}，其他必要时间字段取本轮T。；UI定位：所有重复diag-item-*均在所属登记diag-check容器内getByTestId查找。11项枚举只使用docs文档开头列出的完整登记testId，不用通配选择器。
- 步骤：
  - S1：在 B 上真实 POST /api/sync 导入 samplePayload（resource.json 按 D-01 平移），保留完整响应 R；GET /api/health 保留 H，确认快照模式、10个页面和非null同步时间。
  - S2：在 SW 捕获 T，令 L=T−1500×60000，写入 testData 所列完整 syncState、apiBaseUrl=B 和 connection；读回确认 L 与统计值，之后再打开 popup。
  - S3：以 tab 打开 popup → tab-diag，等待 diag-loading 消失，读取 diag-check-last-sync 的 data-status、diag-item-detail 和 diag-item-value；保留本轮 lastDiagnostics。
- 预期：
  - E1：S1 的真实导入响应 HTTP 200，pageCount=10；H.persistence="snapshot"、H.pageCount=10、H.lastSyncAt=R.syncedAt 且非null。
  - E2：S3 的 diag-check-last-sync data-status="warn"，状态文本为「警告」。
  - E3：diag-item-detail 包含「超过 24 小时未同步」；本条时间距24小时阈值为1小时，未测试不稳定的恰好24小时。
  - E4：该项文本不包含「后端数据少于本地同步记录」，排查步骤中提供「立即同步」建议。
- 证据目录：`evidence/TC-UI-DIAG-018/`
  - api: B 的 reset、sync、health 请求响应
  - storage: 写入和读回的 syncState/connection
  - screenshot: 本轮最近同步状态
  - server.log: 本条真实 snapshot 后端

### TC-UI-DIAG-019 后端 2 条规则且插件缓存也是 2 条时「当前规则数量」显示 2 并通过

- 优先级：P0 ｜ 类别：positive ｜ 技术：decision-table
- 关联 Feature：F-DIAG-07
- 验收引用：F-DIAG-07#AC1
- 关联 Code：C-FE-DIAG-07、C-FE-DIAG-11
- 未来脚本：`tests/ui/TC-UI-DIAG-019.spec.mjs`
- 前置条件：
  - 每条用例使用独立 persistent Chromium context（channel=chromium）加载真实扩展，以 tab 打开 popup；真实产品后端启用 ENABLE_TEST_API=1，api 夹具在本条开始前调用 POST /api/__test__/reset；仅 route 外部站点，绝不 route 任何 API base。
  - 后端已 reset（夹具自动完成）；规则通过真实 HTTP POST /api/rules 保存，id 取响应值
  - finally 关闭本条创建的全部 popup、context、请求 context；如创建临时扩展副本/产品后端/依赖故障服务，先关闭 context，再停止并等待进程退出、关闭监听，最后删除本条临时目录；不清理其他用例资源。
- 测试数据：规则①={"rawText": "把 7 天没访问过的 GitHub issue 建议归档", "type": "archive_candidate", "domain": "github.com", "urlPattern": "/issues/", "inactiveDays": 7, "action": "suggest_archive"}；规则②={"rawText": "docs.internal.com 的页面永远不要归档", "type": "never_archive", "domain": "docs.internal.com", "action": "keep"}。规则 id 只取真实保存响应，禁止硬编码。在 popup 的 page.evaluate 中调用 chrome.runtime.sendMessage({type:"LIST_RULES",payload:{source:<network或cache>},requestId:<本条唯一值>})，响应按 {ok,data} 信封读取 data.rules / data.fromCache；不猜测 cache.rules.data 的内部形状。；UI定位：所有重复diag-item-*均在所属登记diag-check容器内getByTestId查找。11项枚举只使用docs文档开头列出的完整登记testId，不用通配选择器。
- 步骤：
  - S1：真实 POST /api/rules 提交 {rules:[规则①,规则②]}；记录201响应中的正式规则 id 和 ruleCount。
  - S2：打开 popup，待首页请求完成；通过 LIST_RULES{source:"network"} 让产品自然写规则缓存，再 LIST_RULES{source:"cache"} 读回，确认2条；真实 GET /api/health 确认 ruleCount=2。
  - S3：点击 tab-diag，待本轮检测完成，读取 diag-check-rule-count 的状态、数值与详情。
- 预期：
  - E1：S1 HTTP 201，ruleCount=2，两条返回规则 id 非空且不同。
  - E2：S2 的 LIST_RULES cache 响应 ok=true、data.fromCache=true、data.rules.length=2，且 id 集合等于 S1；health.ruleCount=2。
  - E3：S3 的 diag-check-rule-count data-status="ok"、diag-item-status 为「通过」，diag-item-value="2"。
  - E4：该项 detail 不包含「规则数不一致」，真实 GET /api/rules 仍 total=2。
- 证据目录：`evidence/TC-UI-DIAG-019/`
  - api: POST /api/rules（201）、GET health/rules
  - message: LIST_RULES network/cache 响应
  - screenshot: 规则数一致通过

### TC-UI-DIAG-020 缓存 1 条、health.ruleCount=2 时先警告「规则数不一致」，自动重新拉取后显示 2

- 优先级：P1 ｜ 类别：state ｜ 技术：state-transition
- 关联 Feature：F-DIAG-07
- 验收引用：F-DIAG-07#AC2
- 关联 Code：C-FE-DIAG-07、C-FE-DIAG-09、C-FE-DIAG-11
- 未来脚本：`tests/ui/TC-UI-DIAG-020.spec.mjs`
- 前置条件：
  - 每条用例使用独立 persistent Chromium context（channel=chromium）加载真实扩展，以 tab 打开 popup；真实产品后端启用 ENABLE_TEST_API=1，api 夹具在本条开始前调用 POST /api/__test__/reset；仅 route 外部站点，绝不 route 任何 API base。
  - 后端已 reset；规则通过真实 HTTP 保存；缓存按 ui-contract.storageKeys.cache 的结构写入
  - finally 关闭本条创建的全部 popup、context、请求 context；如创建临时扩展副本/产品后端/依赖故障服务，先关闭 context，再停止并等待进程退出、关闭监听，最后删除本条临时目录；不清理其他用例资源。
- 测试数据：规则①={"rawText": "把 7 天没访问过的 GitHub issue 建议归档", "type": "archive_candidate", "domain": "github.com", "urlPattern": "/issues/", "inactiveDays": 7, "action": "suggest_archive"}；规则②={"rawText": "docs.internal.com 的页面永远不要归档", "type": "never_archive", "domain": "docs.internal.com", "action": "keep"}。规则 id 只取真实保存响应，禁止硬编码。在 popup 的 page.evaluate 中调用 chrome.runtime.sendMessage({type:"LIST_RULES",payload:{source:<network或cache>},requestId:<本条唯一值>})，响应按 {ok,data} 信封读取 data.rules / data.fromCache；不猜测 cache.rules.data 的内部形状。；UI定位：所有重复diag-item-*均在所属登记diag-check容器内getByTestId查找。11项枚举只使用docs文档开头列出的完整登记testId，不用通配选择器。
- 步骤：
  - S1：本条 reset 后仅真实 POST /api/rules 保存规则①（201，ruleCount=1），记录返回 id；打开 popup 并等待首页请求结束。
  - S2：在同一 popup 用 LIST_RULES network 生成1条缓存，LIST_RULES cache 读回 data.rules.length=1。
  - S3：直接通过真实 POST /api/rules 保存规则②（不走插件保存动作，因此不触发其缓存失效）；真实 GET /api/health 返回ruleCount=2，再 LIST_RULES cache 读回仍为1条。
  - S4：先在context.on("request")注册只读监听，记录扩展SW的GET /api/rules请求；再点击tab-diag（若已进入则点击diag-rerun-button），等待本轮完成，读取diag-check-rule-count的状态、detail与value。
  - S5：用 LIST_RULES cache 读回刷新后的规则；真实 GET /api/rules 读回 total。
- 预期：
  - E1：S3 的真实后端 health.ruleCount=2，而同一时刻的 LIST_RULES cache 返回 fromCache=true、rules.length=1，错配前置成立。
  - E2：S4 的 diag-check-rule-count data-status="warn"，detail 包含「规则数不一致」。
  - E3：S4 的扩展 SW 自动发起真实 GET /api/rules；diag-item-value="2"，表明自动重拉后的数量已展示。
  - E4：S5 的 LIST_RULES cache 返回 data.fromCache=true、data.rules.length=2，id 集合与本条两次保存响应一致。
  - E5：S5 的真实 GET /api/rules 返回 total=2，无诊断写库副作用。
- 证据目录：`evidence/TC-UI-DIAG-020/`
  - api: 本条两次规则保存和 health/readback
  - message: 重拉前后 LIST_RULES cache 响应
  - network: 自动 GET /api/rules
  - screenshot: 不一致警告与刷新后的2

### TC-UI-DIAG-021 规则数离线时警告，恢复同一后端并重检后2条一致且通过

- 优先级：P1 ｜ 类别：exception ｜ 技术：error-guessing
- 关联 Feature：F-DIAG-07
- 验收引用：F-DIAG-07#AC1
- 关联 Code：C-FE-DIAG-07、C-FE-DIAG-11
- 未来脚本：`tests/ui/TC-UI-DIAG-021.spec.mjs`
- 前置条件：
  - 每条用例使用独立 persistent Chromium context（channel=chromium）加载真实扩展，以 tab 打开 popup；真实产品后端启用 ENABLE_TEST_API=1，api 夹具在本条开始前调用 POST /api/__test__/reset；仅 route 外部站点，绝不 route 任何 API base。
  - 缓存中已有 2 条规则（本地缓存存在），随后把 apiBaseUrl 指向 http://127.0.0.1:9
  - finally 关闭本条创建的全部 popup、context、请求 context；如创建临时扩展副本/产品后端/依赖故障服务，先关闭 context，再停止并等待进程退出、关闭监听，最后删除本条临时目录；不清理其他用例资源。
- 测试数据：规则①={"rawText": "把 7 天没访问过的 GitHub issue 建议归档", "type": "archive_candidate", "domain": "github.com", "urlPattern": "/issues/", "inactiveDays": 7, "action": "suggest_archive"}；规则②={"rawText": "docs.internal.com 的页面永远不要归档", "type": "never_archive", "domain": "docs.internal.com", "action": "keep"}。规则 id 只取真实保存响应，禁止硬编码。在 popup 的 page.evaluate 中调用 chrome.runtime.sendMessage({type:"LIST_RULES",payload:{source:<network或cache>},requestId:<本条唯一值>})，响应按 {ok,data} 信封读取 data.rules / data.fromCache；不猜测 cache.rules.data 的内部形状。；UI定位：所有重复diag-item-*均在所属登记diag-check容器内getByTestId查找。11项枚举只使用docs文档开头列出的完整登记testId，不用通配选择器。
- 步骤：
  - S1：本条 reset 后真实 POST /api/rules 保存规则①和②（201）；打开 popup 待首页请求结束，LIST_RULES network 自然生成2条缓存，LIST_RULES cache 和真实 health 均核对2条。
  - S2：把 apiBaseUrl 写为已确认无监听的 http://127.0.0.1:9；在同一 popup 点击 tab-diag/diag-rerun-button，等待完成并读取规则数状态与排查建议。
  - S3：在 SW 恢复 apiBaseUrl=B；关闭再重新打开 popup，点击 tab-diag → diag-rerun-button，完成检测后读规则数状态/value，再读 LIST_RULES cache 与真实 health。
- 预期：
  - E1：S2 的 diag-check-rule-count data-status="warn"，hint 至少一条说明「规则页签」或「重新拉取」。
  - E2：S2 的 diag-check-backend data-status="fail"、diag-check-storage data-status="ok"，11项检查均渲染。
  - E3：S3 恢复后的 health.ruleCount=2，LIST_RULES cache 返回 data.rules.length=2；diag-check-rule-count data-status="ok"，diag-item-value="2"，证明AC1要求的两端一致通过。
- 证据目录：`evidence/TC-UI-DIAG-021/`
  - api: 真实规则保存及恢复后 health
  - message: 两次规则缓存读回
  - screenshot: 离线警告及恢复后通过

### TC-UI-DIAG-022 默认配置下附加三项：activeTab 通过、隐私过滤通过、无痕模式为提示且说明无痕数据不被采集

- 优先级：P0 ｜ 类别：positive ｜ 技术：equivalence
- 关联 Feature：F-DIAG-08
- 验收引用：F-DIAG-08#AC1
- 关联 Code：C-FE-DIAG-04、C-FE-DIAG-08、C-FE-DIAG-11
- 未来脚本：`tests/ui/TC-UI-DIAG-022.spec.mjs`
- 前置条件：
  - 每条用例使用独立 persistent Chromium context（channel=chromium）加载真实扩展，以 tab 打开 popup；真实产品后端启用 ENABLE_TEST_API=1，api 夹具在本条开始前调用 POST /api/__test__/reset；仅 route 外部站点，绝不 route 任何 API base。
  - 真实后端以默认配置启动（enablePrivacyFilter=true、privacySensitiveKeywords 4 个、未保存任何 privacy_filter 规则）
  - finally 关闭本条创建的全部 popup、context、请求 context；如创建临时扩展副本/产品后端/依赖故障服务，先关闭 context，再停止并等待进程退出、关闭监听，最后删除本条临时目录；不清理其他用例资源。
- 测试数据：状态文本取值：通过 / 警告 / 失败 / 提示（ui-contract 的 diag-item-status）；隐私过滤 detail 列出关键词数与来源（前端方案 §9 第 9 行）；UI定位：所有重复diag-item-*均在所属登记diag-check容器内getByTestId查找。11项枚举只使用docs文档开头列出的完整登记testId，不用通配选择器。
- 步骤：
  - S1：打开 popup → 诊断页签，等待 diag-loading 消失
  - S2：读取 diag-check-active-tab、diag-check-privacy、diag-check-incognito 的 data-status，以及各自的 diag-item-status / diag-item-detail 文本
- 预期：
  - E1：diag-check-active-tab data-status="ok"，diag-item-status 文本为「通过」
  - E2：diag-check-privacy data-status="ok"，diag-item-status 文本为「通过」，diag-item-detail 文本包含关键词数 "4"
  - E3：diag-check-incognito data-status="info"，diag-item-status 文本为「提示」，diag-item-detail 文本包含「无痕窗口的数据不会被采集」
  - E4：三项都在同一页面渲染，登记的 11 个检查项数量 = 11
- 证据目录：`evidence/TC-UI-DIAG-022/`
  - screenshot: activeTab / 隐私过滤 / 无痕模式三项

### TC-UI-DIAG-023 enablePrivacyFilter=false 时「隐私过滤」显示警告并提示检查后端配置

- 优先级：P1 ｜ 类别：state ｜ 技术：decision-table
- 关联 Feature：F-DIAG-08
- 验收引用：F-DIAG-08#AC2
- 关联 Code：C-FE-DIAG-08、C-FE-DIAG-11
- 未来脚本：`tests/ui/TC-UI-DIAG-023.spec.mjs`
- 前置条件：
  - 每条用例使用独立 persistent Chromium context（channel=chromium）加载真实扩展，以 tab 打开 popup；真实产品后端启用 ENABLE_TEST_API=1，api 夹具在本条开始前调用 POST /api/__test__/reset；仅 route 外部站点，绝不 route 任何 API base。
  - 用真实接口 PUT /api/config 关闭隐私过滤（不 mock 后端）
  - finally 关闭本条创建的全部 popup、context、请求 context；如创建临时扩展副本/产品后端/依赖故障服务，先关闭 context，再停止并等待进程退出、关闭监听，最后删除本条临时目录；不清理其他用例资源。
- 测试数据：PUT /api/config 请求体 { enablePrivacyFilter:false }；hint 文案取自前端方案 §9 第 9 行「检查后端配置 enablePrivacyFilter」；UI定位：所有重复diag-item-*均在所属登记diag-check容器内getByTestId查找。11项枚举只使用docs文档开头列出的完整登记testId，不用通配选择器。
- 步骤：
  - S1：PUT /api/config，请求体 { enablePrivacyFilter:false }，断言响应 enablePrivacyFilter=false
  - S2：打开 popup → 诊断页签，等待 diag-loading 消失
  - S3：读取 diag-check-privacy 的 data-status、diag-item-detail 与 diag-item-hint-step 文本，并读取 diag-check-active-tab 的 data-status
- 预期：
  - E1：S1 返回 200，body.enablePrivacyFilter=false
  - E2：S3 的 diag-check-privacy data-status="warn"
  - E3：其 diag-item-hint-step 至少 1 条包含 "enablePrivacyFilter"
  - E4：diag-check-active-tab data-status="ok"（只有隐私项随配置变化）
- 证据目录：`evidence/TC-UI-DIAG-023/`
  - api: PUT /api/config 请求响应
  - screenshot: 隐私过滤警告

### TC-UI-DIAG-024 health.version 主版本为 2 时「版本兼容」失败，并提示升级插件或后端

- 优先级：P1 ｜ 类别：exception ｜ 技术：error-guessing
- 关联 Feature：F-DIAG-08
- 验收引用：F-DIAG-08#AC3
- 关联 Code：C-FE-DIAG-08、C-FE-DIAG-11
- 未来脚本：`tests/ui/TC-UI-DIAG-024.spec.mjs`
- 前置条件：
  - 本条是 UI 依赖故障场景：独立 Node http.createServer 绑定127.0.0.1空闲端口P；不是产品后端验收，也不属于F-DIAG-09。用真实HTTP传输，不使用Playwright route，不改产品源码或APP_VERSION。
  - 记录服务启动时刻 Ts；health返回{status:"ok",version:"2.3.1",uptime:floor((Date.now()−Ts)/1000),pageCount:0,ruleCount:0,enabledRuleCount:0,lastSyncAt:null,persistence:"memory",startedAt:Ts}；config返回api-contract的完整默认config；rules返回{rules:[],total:0}，其他无数据读接口返回其契约空集合。每个响应设置application/json和允许扩展origin的CORS头，OPTIONS返回204并声明允许的headers/methods。
  - 服务listen完成后用Playwright request真实GET health/config确认就绪，才加载独立扩展context并把apiBaseUrl写为该地址；清空syncState且connection.recoverPending=false，避免自动同步。
  - finally先关闭扩展及请求context，再server.close并等待监听关闭，删除本条临时目录；不占用产品后端端口。
- 测试数据：插件 EXPECTED_API_MAJOR=1，依赖故障服务health.version="2.3.1"；主版本2与1不同，应提示升级插件或后端。该fixture只证明UI版本诊断，不证明产品health接口。；UI定位：所有重复diag-item-*均在所属登记diag-check容器内getByTestId查找。11项枚举只使用docs文档开头列出的完整登记testId，不用通配选择器。
- 步骤：
  - S1：启动临时真实 HTTP 服务并记录地址 http://127.0.0.1:<临时端口>
  - S2：在 service worker 中写入 chrome.storage.local.apiBaseUrl = 临时服务地址
  - S3：打开 popup → 诊断页签，等待 diag-loading 消失
  - S4：读取 diag-check-version 的 data-status、diag-item-detail 与全部 diag-item-hint-step 文本，并读取 diag-check-backend 的 data-status 与 登记的 11 个检查项数量
- 预期：
  - E1：S4 的 diag-check-version data-status="fail"
  - E2：diag-item-detail 文本同时包含 "2.3.1" 与期望主版本 "1"
  - E3：diag-item-hint-step 至少 1 条同时提到「升级插件」或「升级后端」
  - E4：S4 的 diag-check-backend data-status="ok"（该服务可连通），登记的 11 个检查项数量 = 11
- 证据目录：`evidence/TC-UI-DIAG-024/`
  - screenshot: 版本兼容失败
  - 临时服务日志: /api/health 请求

### TC-UI-DIAG-025 失败项不只显示错误码：每个失败项都有原因说明与至少 1 条可直接执行的排查步骤

- 优先级：P1 ｜ 类别：exception ｜ 技术：error-guessing
- 关联 Feature：F-DIAG-11
- 验收引用：F-DIAG-11#AC1
- 关联 Code：C-FE-DIAG-09、C-FE-DIAG-11
- 未来脚本：`tests/ui/TC-UI-DIAG-025.spec.mjs`
- 前置条件：
  - 每条用例使用独立 persistent Chromium context（channel=chromium）加载真实扩展，以 tab 打开 popup；真实产品后端启用 ENABLE_TEST_API=1，api 夹具在本条开始前调用 POST /api/__test__/reset；仅 route 外部站点，绝不 route 任何 API base。
  - 用没有服务的端口（http://127.0.0.1:9）制造至少 1 个失败项；不 mock 后端
  - finally 关闭本条创建的全部 popup、context、请求 context；如创建临时扩展副本/产品后端/依赖故障服务，先关闭 context，再停止并等待进程退出、关闭监听，最后删除本条临时目录；不清理其他用例资源。
- 测试数据：「可直接执行」的判定：hint 步骤文本包含命令（./scripts/start.sh）、路径（/api/health）或配置键（host_permissions），不是纯错误码；UI定位：所有重复diag-item-*均在所属登记diag-check容器内getByTestId查找。11项枚举只使用docs文档开头列出的完整登记testId，不用通配选择器。
- 步骤：
  - S1：useUnreachableBackend()，打开 popup → 诊断页签，等待 diag-loading 消失
  - S2：枚举所有 上述11个登记检查项 项，筛出 data-status="fail" 的项，逐项读取 diag-item-detail 与其 diag-item-hint-step 文本
  - S3：检查每个失败项的 hint 中是否至少有一条包含命令 / 路径 / 配置键
- 预期：
  - E1：S2 至少筛出1个失败项（本场景为「后端服务连接」），其 diag-item-detail 包含具体失败原因「连接被拒绝」。
  - E2：每个失败项的 diag-item-hint-step 数量 ≥ 1
  - E3：S3 的判定为真：每个失败项都有一条 hint 命中 "./scripts/start.sh" / "/api/health" / "host_permissions" / "API Base URL" 之一
  - E4：失败项的 diag-item-detail 不是裸错误码（不匹配 /^[A-Z_]+$/）
- 证据目录：`evidence/TC-UI-DIAG-025/`
  - screenshot: 失败项的展开排查步骤

### TC-UI-DIAG-026 从首页诊断入口进入诊断页签后「重新检测」：11 项重新执行、检测时间更新

- 优先级：P0 ｜ 类别：positive ｜ 技术：state-transition
- 关联 Feature：F-DIAG-11
- 验收引用：F-DIAG-11#AC2
- 关联 Code：C-FE-DIAG-12、C-FE-DIAG-11、C-FE-DIAG-09
- 未来脚本：`tests/ui/TC-UI-DIAG-026.spec.mjs`
- 前置条件：
  - 本条真实产品后端已reset，扩展独立加载。复用项目collect-coverage.mjs的插桩配方把extension/复制到本条临时目录，仅增加Istanbul计数，业务返回值保持不变；不运行会删除共享coverage目录的全量collect脚本。用EXT_DIR加载临时副本，popup仍以tab打开。
  - 脚本阶段需准备istanbul-lib-instrument（现有collect脚本已有依赖提示）；当前依赖尚未安装，实施时安装在本条隔离工具目录并用createRequire解析，不改产品package.json。插桩失败、缺fnMap/f或计数无法映射时本条不得宣称已验证重新执行。
  - fnMap/f来自SW globalThis.__coverage__；按注册文件路径和pack已登记函数名定位，不依赖不稳定的数字key。finally关闭context/请求context并删除本条临时扩展、隔离工具目录；不修改源extension/。
- 测试数据：规则①={"rawText": "把 7 天没访问过的 GitHub issue 建议归档", "type": "archive_candidate", "domain": "github.com", "urlPattern": "/issues/", "inactiveDays": 7, "action": "suggest_archive"}；规则②={"rawText": "docs.internal.com 的页面永远不要归档", "type": "never_archive", "domain": "docs.internal.com", "action": "keep"}。规则 id 只取真实保存响应，禁止硬编码。 11项testId固定为["diag-check-backend", "diag-check-tabs", "diag-check-history", "diag-check-storage", "diag-check-api-base-url", "diag-check-last-sync", "diag-check-rule-count", "diag-check-active-tab", "diag-check-privacy", "diag-check-incognito", "diag-check-version"]；函数观测为runDiagnostics、safeCheck及checkBackend/checkTabs/checkHistory/checkStorage/checkLastSync/checkRuleCount/checkActiveTab/checkPrivacy/checkIncognito/checkVersion。；UI定位：所有重复diag-item-*均在所属登记diag-check容器内getByTestId查找。11项枚举只使用docs文档开头列出的完整登记testId，不用通配选择器。 第11项apiBaseUrl使用实际源码中传给safeCheck的检查回调；按该项id和回调的源码范围定位fnMap/f，不虚构checkApiBaseUrl导出名，不用safeCheck总数代替该回调的执行证据。脚本若找不到独立回调计数即报证据缺失，不能静默跳过。
- 步骤：
  - S1：真实API保存规则①（201），打开popup首页后通过LIST_RULES network形成1条缓存；点击home-diag-entry进入诊断，记录T1=diag-checked-at.data-ts、11个登记testId的状态，并读取SW覆盖率计数快照A。
  - S2：保持同一popup：真实PUT /api/config设enablePrivacyFilter=false；真实POST /api/rules仅保存规则②使后端2条而缓存仍1；在SW写完整非恢复syncState.error（lastSuccessAt非null，code=VALIDATION_FAILED，message="诊断重检输入已变化"）及connection.recoverPending=false。读取coverage快照B，作为点击前基线。
  - S3：注册context.on("request")只读记录本轮真实health/config/rules请求，点击diag-rerun-button；等待11项完成、diag-loading消失，读取T2、11项结果以及coverage快照C。
  - S4：比较C与B的函数计数增量：映射10个已登记check函数，并按apiBaseUrl检查项对应的实际源码回调位置映射第11项的fnMap/f；读取lastDiagnostics.items和LIST_RULES cache。所有状态选择器均逐个getByTestId使用登记列表。
- 预期：
  - E1：home-diag-entry 可见，点击后panel-diag可见；T1为毫秒时间戳，11个登记项齐全且首次隐私过滤为ok、规则数value="1"。
  - E2：T2>T1；lastDiagnostics.checkedAt=T2，items.length=11且id集合与契约11项完全相同，页面11项均有合法data-status。
  - E3：本轮真实输入变化得到新结果：diag-check-privacy由ok变warn；diag-check-last-sync变fail且含「诊断重检输入已变化」；diag-check-rule-count提示不一致且value="2"，LIST_RULES cache读回2条。
  - E4：点击后C−B中runDiagnostics≥1、safeCheck≥11，testData所列10个check函数各≥1，且apiBaseUrl检查项对应的实际回调函数计数增量≥1；11项各自都有执行证据，不能仅以safeCheck总数、时间变化或整批旧结果代替。
  - E5：本轮实际产生扩展SW的GET /api/health、GET /api/config和不一致触发的GET /api/rules；API Base URL项仍显示实际B，检查项均来自本轮执行。
- 证据目录：`evidence/TC-UI-DIAG-026/`
  - screenshot: 首页入口和重检前后状态
  - coverage: B/C原始fnMap/f及按函数名计算的增量
  - api: 配置、规则变更和health读回
  - network: 点击后SW请求
  - message: LIST_RULES cache读回

### TC-UI-DIAG-027 同步样例后「复制诊断报告」：真实剪贴板与 diag-report-output 一致，含检查结果/版本/配置且不含浏览 URL

- 优先级：P0 ｜ 类别：positive ｜ 技术：scenario
- 关联 Feature：F-DIAG-11
- 验收引用：F-DIAG-11#AC3
- 关联 Code：C-FE-DIAG-10、C-FE-DIAG-11、C-FE-DIAG-09
- 未来脚本：`tests/ui/TC-UI-DIAG-027.spec.mjs`
- 前置条件：
  - 每条用例使用独立 persistent Chromium context（channel=chromium）加载真实扩展，以 tab 打开 popup；真实产品后端启用 ENABLE_TEST_API=1，api 夹具在本条开始前调用 POST /api/__test__/reset；仅 route 外部站点，绝不 route 任何 API base。
  - 样例通过真实 POST /api/sync 导入（夹具 api.loadSample()，时间按 D-01 平移）
  - 在 persistent context 上授予 clipboard-read / clipboard-write 权限（origin 为 chrome-extension://<扩展 id>）
  - finally 关闭本条创建的全部 popup、context、请求 context；如创建临时扩展副本/产品后端/依赖故障服务，先关闭 context，再停止并等待进程退出、关闭监听，最后删除本条临时目录；不清理其他用例资源。
- 测试数据：先真实POST /api/sync导入D-01平移resource.json（14项→10页）。隐私探针URL U=https://github.com/org/repo/issues/123；非恢复错误message="诊断隐私探针："+U，code=VALIDATION_FAILED。报告允许保留apiBaseUrl=B，其他字符串中的浏览URL必须清除；先确认诊断detail确实含U，再断言输出不含U，避免无输入的弱隐私断言。；UI定位：所有重复diag-item-*均在所属登记diag-check容器内getByTestId查找。11项枚举只使用docs文档开头列出的完整登记testId，不用通配选择器。
- 步骤：
  - S1：本条reset后 api.loadSample() 真实导入平移样例，记录响应R并断言pageCount=10；授予本条扩展origin的clipboard-read/clipboard-write，popup保持前台。
  - S2：在SW捕获T，写完整syncState={status:"error",startedAt:T,lastSyncAt:T,lastSuccessAt:T−300000,lastError:{code:"VALIDATION_FAILED",message:"诊断隐私探针："+U},cursor:null,cursorBase:null,fullReason:null,mode:"full",trigger:"user",stats:{uploaded:14,filtered:0,received:R.received,created:R.created,updated:R.updated,rejected:R.rejected}}、apiBaseUrl=B及connection.recoverPending=false。
  - S3：打开popup → tab-diag，等待11项完成，先确认diag-check-last-sync内diag-item-detail实际含U；点击diag-copy-report-button，等待diag-report-output出现，读取文本J。
  - S4：在popup内执行navigator.clipboard.readText读取真实剪贴板K；逐字比较K和J，JSON.parse后逐字段检查检查结果、版本、配置和浏览URL清除情况。
- 预期：
  - E1：S3复制前diag-check-last-sync data-status="fail"且detail确实含完整U，隐私过滤输入成立。
  - E2：J与K均可JSON.parse，K===J（真实剪贴板与页面输出逐字一致）。
  - E3：报告含数字generatedAt、extensionVersion="1.0.0"、apiBaseUrl=B、11项checks（每项有id/status/detail）和config.cleanupThresholdDays=14。
  - E4：报告全文不含U、不含"github.com/org/repo"，也不含resource.json任何页面URL；递归检查所有字符串，除apiBaseUrl字段外不存在http(s) URL，apiBaseUrl仍完整等于B。
- 证据目录：`evidence/TC-UI-DIAG-027/`
  - api: POST /api/sync 请求响应
  - screenshot: 复制前含URL的诊断项及复制后的报告
  - clipboard.txt: 与DOM一致的原文
  - report.json: 解析内容与URL检查结果

## Feature → AC → Case 覆盖表

| Feature | AC | 用例 |
|---|---|---|
| F-DIAG-01 | AC1 | TC-UI-DIAG-001 |
| F-DIAG-01 | AC2 | TC-UI-DIAG-002 |
| F-DIAG-01 | AC3 | TC-UI-DIAG-003 |
| F-DIAG-02 | AC1 | TC-UI-DIAG-004 |
| F-DIAG-02 | AC2 | TC-UI-DIAG-005、TC-UI-DIAG-008 |
| F-DIAG-02 | AC3 | TC-UI-DIAG-006、TC-UI-DIAG-007 |
| F-DIAG-03 | AC1 | TC-UI-DIAG-009 |
| F-DIAG-03 | AC2 | TC-UI-DIAG-010 |
| F-DIAG-04 | AC1 | TC-UI-DIAG-011 |
| F-DIAG-04 | AC2 | TC-UI-DIAG-012 |
| F-DIAG-05 | AC1 | TC-UI-DIAG-013 |
| F-DIAG-05 | AC2 | TC-UI-DIAG-014 |
| F-DIAG-06 | AC1 | TC-UI-DIAG-015 |
| F-DIAG-06 | AC2 | TC-UI-DIAG-016 |
| F-DIAG-06 | AC3 | TC-UI-DIAG-017 |
| F-DIAG-06 | AC4 | TC-UI-DIAG-018 |
| F-DIAG-07 | AC1 | TC-UI-DIAG-019、TC-UI-DIAG-021 |
| F-DIAG-07 | AC2 | TC-UI-DIAG-020 |
| F-DIAG-08 | AC1 | TC-UI-DIAG-022 |
| F-DIAG-08 | AC2 | TC-UI-DIAG-023 |
| F-DIAG-08 | AC3 | TC-UI-DIAG-024 |
| F-DIAG-11 | AC1 | TC-UI-DIAG-025 |
| F-DIAG-11 | AC2 | TC-UI-DIAG-026 |
| F-DIAG-11 | AC3 | TC-UI-DIAG-027 |

## Feature 类别覆盖与豁免

| Feature | 类别分布（本 UI 分片） | 豁免 | 缺口 |
|---|---|---|---|
| F-DIAG-01 | positive=1、exception=1、state=1 | 无 | 无 |
| F-DIAG-02 | positive=2、negative=1、boundary=1、exception=1 | 无 | 无 |
| F-DIAG-03 | positive=1、exception=1 | 无 | 无 |
| F-DIAG-04 | positive=1、exception=1 | 无 | 无 |
| F-DIAG-05 | positive=1、state=1 | exception | 无 |
| F-DIAG-06 | state=1、positive=1、exception=1、boundary=1 | 无 | 无 |
| F-DIAG-07 | positive=1、state=1、exception=1 | 无 | 无 |
| F-DIAG-08 | positive=1、state=1、exception=1 | 无 | 无 |
| F-DIAG-11 | exception=1、positive=2 | 无 | 无 |

- F-DIAG-05 / exception：真实临时Chromium profile中磁盘/配额充足；项目没有稳定的storage故障注入接口。直接去掉storage权限会破坏后台共享状态，使popup无法走到storage单项诊断；填满配额又会影响其他诊断状态写入，无法稳定隔离该分支。在不改产品实现、不替换chrome.storage返回值的边界内，此异常路径暂不自动化；正常写读删和无残留由013/014验证，但不能据此声称异常finally路径已通过，需后续代码评审检查finally清理并在具备稳定故障环境后补测。

## 类别分布统计

数值直接取自技能 `checkCases({root})` 返回的 stats：临时校验根仅复制本分片和本模块9个FE Feature，完整结果保存在 `.workflow/context/logs/case-UI-DIAG-scoped-quality.json`。其中“E2E至少5条”属于其他类型的全局要求，单独列为范围外；没有删除该检查。

- UI 用例：27；AC覆盖：24/24；类别缺口：0；waiver：1。

| 类别 | 数量 |
|---|---|
| positive | 11 |
| exception | 8 |
| state | 5 |
| negative | 1 |
| boundary | 2 |

| 优先级 | 数量 |
|---|---|
| P0 | 11 |
| P1 | 16 |

## Code → Case 覆盖

| Code ID | 用例 |
|---|---|
| C-FE-CORE-03 | TC-UI-DIAG-001、TC-UI-DIAG-003、TC-UI-DIAG-004、TC-UI-DIAG-005、TC-UI-DIAG-008 |
| C-FE-CORE-04 | TC-UI-DIAG-004、TC-UI-DIAG-005、TC-UI-DIAG-008 |
| C-FE-DIAG-01 | TC-UI-DIAG-001、TC-UI-DIAG-002 |
| C-FE-DIAG-02 | TC-UI-DIAG-003 |
| C-FE-DIAG-03 | TC-UI-DIAG-004、TC-UI-DIAG-005、TC-UI-DIAG-006、TC-UI-DIAG-007、TC-UI-DIAG-008 |
| C-FE-DIAG-04 | TC-UI-DIAG-009、TC-UI-DIAG-010、TC-UI-DIAG-011、TC-UI-DIAG-012、TC-UI-DIAG-022 |
| C-FE-DIAG-05 | TC-UI-DIAG-013、TC-UI-DIAG-014 |
| C-FE-DIAG-06 | TC-UI-DIAG-015、TC-UI-DIAG-016、TC-UI-DIAG-017、TC-UI-DIAG-018 |
| C-FE-DIAG-07 | TC-UI-DIAG-019、TC-UI-DIAG-020、TC-UI-DIAG-021 |
| C-FE-DIAG-08 | TC-UI-DIAG-022、TC-UI-DIAG-023、TC-UI-DIAG-024 |
| C-FE-DIAG-09 | TC-UI-DIAG-001、TC-UI-DIAG-002、TC-UI-DIAG-010、TC-UI-DIAG-012、TC-UI-DIAG-014、TC-UI-DIAG-017、TC-UI-DIAG-020、TC-UI-DIAG-025、TC-UI-DIAG-026、TC-UI-DIAG-027 |
| C-FE-DIAG-10 | TC-UI-DIAG-027 |
| C-FE-DIAG-11 | TC-UI-DIAG-001、TC-UI-DIAG-002、TC-UI-DIAG-009、TC-UI-DIAG-010、TC-UI-DIAG-011、TC-UI-DIAG-012、TC-UI-DIAG-013、TC-UI-DIAG-015、TC-UI-DIAG-016、TC-UI-DIAG-017、TC-UI-DIAG-018、TC-UI-DIAG-019、TC-UI-DIAG-020、TC-UI-DIAG-021、TC-UI-DIAG-022、TC-UI-DIAG-023、TC-UI-DIAG-024、TC-UI-DIAG-025、TC-UI-DIAG-026、TC-UI-DIAG-027 |
| C-FE-DIAG-12 | TC-UI-DIAG-026 |

## 设计自检与后续工作

- 当前分片仅有 type=UI、module=DIAG；S/E连续编号；全部 AC 有用例，全部本模块前端代码点有引用。
- 技能按本分片校验：UI错误 0，警告 0；保留的范围外检查：E2E 用例只有 0 条，本技能要求至少 5 条（validator 下限为 3 条），需覆盖 PROBLEM.md 验收流程。
- 当前阶段没有运行 UI。后续按每条 Case ID 实施脚本、执行并留存截图、真实请求响应、前后端日志、剪贴板与函数计数等证据；storage故障路径依豁免保留为未自动化。
