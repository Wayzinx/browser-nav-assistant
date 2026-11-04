# CTX 插件加载与上下文读取：UI 用例设计

状态：仅完成用例设计；尚未执行真实 UI、脚本或浏览器探索，以下预期不是已验证结果。来源为 `.workflow/context/briefs/case-UI-CTX+MENU.md`、CTX 上下文包、`nav-test-case-design` 与 `.workflow/CONVENTIONS.md`。本分片只覆盖 CTX 的 UI 类型，不含其他模块或 API 用例。

每条独立加载真实扩展，popup 以 tab 打开；外部网页仅离线路由，后端始终使用真实 HTTP。近期历史使用真实 `chrome.history.addUrl`，不能指定历史时间；本分片不构造旧浏览器记录，若后续需旧后端页面须真实 `POST /api/sync` 导入，不能伪造浏览器历史、API 或 runtime 响应。离线通过 `http://127.0.0.1:9` 真实拒绝连接构造。执行后按 Case ID 留痕；finally 关闭本条 context、页面及请求资源。

真实 SW 异常监听必须附着本扩展的实际 `service_worker` CDP target，记录 `Runtime.exceptionThrown`；启动检查通过自动附着并真实重载扩展，先启用 Runtime 再恢复目标执行。popup 使用 `pageerror`。仅记录 `console.error` 不足以证明没有未捕获异常。所有 UI 定位均使用契约登记的 `getByTestId`；重复行以其登记的 URL 子元素文本匹配，不使用新增选择器。

## TC-UI-CTX-001 真实插件 manifest 为 MV3、包含四项权限及两项后端 host 权限，入口文件可加载

- 类型：UI；模块：CTX；优先级：P0；类别：positive；技术：equivalence
- 关联 Feature：F-CTX-01
- 验收标准：F-CTX-01#AC1、F-CTX-01#AC2、F-CTX-01#AC3
- 关联 Code：C-FE-CORE-01

前置条件：

- 每条用例独立使用 Playwright launchPersistentContext：channel=chromium、空 userDataDir、--disable-extensions-except 与 --load-extension 指向真实 extension/；从真实 service worker URL 取得扩展 ID，popup 以 chrome-extension://<id>/popup/popup.html 标签页打开。
- 真实测试后端 ENABLE_TEST_API=1；本条开始前以真实 HTTP POST /api/__test__/reset 隔离数据，将 chrome.storage.local.apiBaseUrl 设置为本条测试后端地址。只对外部 HTTPS 站点 route fulfill 最小 HTML；禁止 route 后端、localhost、127.0.0.1，禁止替换 chrome API 或伪造 runtime 消息响应。
- popup 页面在导航前注册 pageerror；service worker 使用浏览器级 CDP 自动附着实际 chrome-extension://<id>/background/service-worker.js target，启用 Runtime 并记录 Runtime.exceptionThrown。console.error 另行留存，不能替代未捕获异常监听。finally 关闭本条所有页面、独立 context 与请求 context，不停止共享后端。

测试数据：读取仓库真实 extension/manifest.json，不生成错误 manifest 或临时扩展副本。

步骤：

- S1：使用 Node fs 解析 extension/manifest.json，读取 manifest_version、permissions、host_permissions、background 与 action。
- S2：将 background.service_worker 与 action.default_popup 按 extension/ 根目录解析，检查对应真实文件存在；加载同一目录的真实扩展。

预期：

- E1：manifest_version 严格等于 3。
- E2：permissions 同时包含 tabs、history、storage、activeTab 四个字符串。
- E3：host_permissions 同时包含 http://localhost/* 和 http://127.0.0.1/*。
- E4：background.type 严格等于 module；background.service_worker 指向的文件存在。
- E5：action.default_popup 指向的文件存在；实际 popup URL 对应该路径。

证据：

- evidence/TC-UI-CTX-001/：result.json、api/、server.log、extension.log、screenshots/、flow.gif、explore.json（自动化与 UI 探索阶段生成，本次尚未执行）
- artifact: manifest 原始 JSON 与两个入口文件存在性结果

## TC-UI-CTX-002 加载真实扩展后 SW 注册且无未捕获错误，popup 显示标题与六页签

- 类型：UI；模块：CTX；优先级：P0；类别：positive；技术：scenario
- 关联 Feature：F-CTX-02
- 验收标准：F-CTX-02#AC1、F-CTX-02#AC2
- 关联 Code：C-FE-CORE-01、C-FE-CORE-02、C-FE-CORE-04、C-FE-CORE-06、C-FE-CORE-07

前置条件：

- 每条用例独立使用 Playwright launchPersistentContext：channel=chromium、空 userDataDir、--disable-extensions-except 与 --load-extension 指向真实 extension/；从真实 service worker URL 取得扩展 ID，popup 以 chrome-extension://<id>/popup/popup.html 标签页打开。
- 真实测试后端 ENABLE_TEST_API=1；本条开始前以真实 HTTP POST /api/__test__/reset 隔离数据，将 chrome.storage.local.apiBaseUrl 设置为本条测试后端地址。只对外部 HTTPS 站点 route fulfill 最小 HTML；禁止 route 后端、localhost、127.0.0.1，禁止替换 chrome API 或伪造 runtime 消息响应。
- popup 页面在导航前注册 pageerror；service worker 使用浏览器级 CDP 自动附着实际 chrome-extension://<id>/background/service-worker.js target，启用 Runtime 并记录 Runtime.exceptionThrown。console.error 另行留存，不能替代未捕获异常监听。finally 关闭本条所有页面、独立 context 与请求 context，不停止共享后端。

测试数据：页签顺序：首页、上下文、排序、整理、规则、诊断。后端正常可达。

步骤：

- S1：等待真实 service worker 注册并记录 URL。建立浏览器级 CDP Target 自动附着，匹配本扩展的实际 service_worker target；先注册 Runtime.exceptionThrown 监听，再通过真实 chrome.runtime.reload() 重载扩展，自动附着新 worker 时先 Runtime.enable 后 Runtime.runIfWaitingForDebugger，从其启动开始保留异常事件。
- S2：等待重载后的真实 SW 注册，导航前监听 popup pageerror，然后以 tab 打开 popup。
- S3：读取 app-title；依次读取 tab-home、tab-context、tab-ranked、tab-cleanup、tab-rules、tab-diag，并逐个点击后检查对应 panel-home、panel-context、panel-ranked、panel-cleanup、panel-rules、panel-diag。

预期：

- E1：重载后的 context.serviceWorkers 中存在且仅有本扩展的真实 SW，URL 以 chrome-extension://<本扩展 ID>/ 开头且入口路径与 manifest 一致。
- E2：从重载 SW 启动到六页签检查完成，实际 SW target 的 Runtime.exceptionThrown 事件数为 0。
- E3：app-title 文本严格等于「导航助手」。
- E4：六个登记页签各出现 1 个，文本依次为「首页」「上下文」「排序」「整理」「规则」「诊断」。
- E5：每次点击后的对应页签 aria-selected=true、对应 panel 可见，其余五个页签 aria-selected=false、其余 panel 隐藏。
- E6：popup pageerror 事件数为 0。

证据：

- evidence/TC-UI-CTX-002/：result.json、api/、server.log、extension.log、screenshots/、flow.gif、explore.json（自动化与 UI 探索阶段生成，本次尚未执行）
- CDP: targetId、targetInfo.url、Runtime.exceptionThrown 原始事件及监听起止时间
- screenshot: 六个页签切换后的面板

## TC-UI-CTX-003 后端不可达时真实 SW 与 popup 外壳仍加载且无未捕获错误

- 类型：UI；模块：CTX；优先级：P1；类别：exception；技术：error-guessing
- 关联 Feature：F-CTX-02
- 验收标准：F-CTX-02#AC1、F-CTX-02#AC2
- 关联 Code：C-FE-CORE-02、C-FE-CORE-04、C-FE-CORE-06、C-FE-CORE-07

前置条件：

- 每条用例独立使用 Playwright launchPersistentContext：channel=chromium、空 userDataDir、--disable-extensions-except 与 --load-extension 指向真实 extension/；从真实 service worker URL 取得扩展 ID，popup 以 chrome-extension://<id>/popup/popup.html 标签页打开。
- 真实测试后端 ENABLE_TEST_API=1；本条开始前以真实 HTTP POST /api/__test__/reset 隔离数据，将 chrome.storage.local.apiBaseUrl 设置为本条测试后端地址。只对外部 HTTPS 站点 route fulfill 最小 HTML；禁止 route 后端、localhost、127.0.0.1，禁止替换 chrome API 或伪造 runtime 消息响应。
- popup 页面在导航前注册 pageerror；service worker 使用浏览器级 CDP 自动附着实际 chrome-extension://<id>/background/service-worker.js target，启用 Runtime 并记录 Runtime.exceptionThrown。console.error 另行留存，不能替代未捕获异常监听。finally 关闭本条所有页面、独立 context 与请求 context，不停止共享后端。
- 把 apiBaseUrl 设置为确认无监听的 http://127.0.0.1:9；通过真实连接被拒绝形成异常，不停止共享后端。

测试数据：后端目标 http://127.0.0.1:9；外部页面不需要联网。

步骤：

- S1：在实际 SW target 开启 Runtime.exceptionThrown 监听；按 SW 自动附着、真实 chrome.runtime.reload()、Runtime.enable 后放行的流程覆盖本次 SW 启动，再以 tab 打开 popup 并记录 pageerror。
- S2：读取 app-title 与六个 tab-home、tab-context、tab-ranked、tab-cleanup、tab-rules、tab-diag；点击 tab-context，再点击 tab-home。

预期：

- E1：真实 SW 重新注册成功，SW target 的 Runtime.exceptionThrown 事件数为 0。
- E2：app-title 文本为「导航助手」，六个登记页签均可见且各有 1 个。
- E3：点击 tab-context 后 panel-context 可见；点击 tab-home 后 panel-home 可见且 panel-context 隐藏。
- E4：popup pageerror 事件数为 0；真实后端连接失败不会变成未捕获异常。

证据：

- evidence/TC-UI-CTX-003/：result.json、api/、server.log、extension.log、screenshots/、flow.gif、explore.json（自动化与 UI 探索阶段生成，本次尚未执行）
- network: 端口 9 的真实失败请求与拒绝连接结果
- CDP: 本次 worker target 身份和未捕获异常事件

## TC-UI-CTX-004 活动 GitHub PR 页面在当前页面卡片显示完整标题和 URL

- 类型：UI；模块：CTX；优先级：P0；类别：positive；技术：equivalence
- 关联 Feature：F-CTX-03
- 验收标准：F-CTX-03#AC1
- 关联 Code：C-FE-CTX-01、C-FE-CTX-04、C-FE-CTX-05

前置条件：

- 每条用例独立使用 Playwright launchPersistentContext：channel=chromium、空 userDataDir、--disable-extensions-except 与 --load-extension 指向真实 extension/；从真实 service worker URL 取得扩展 ID，popup 以 chrome-extension://<id>/popup/popup.html 标签页打开。
- 真实测试后端 ENABLE_TEST_API=1；本条开始前以真实 HTTP POST /api/__test__/reset 隔离数据，将 chrome.storage.local.apiBaseUrl 设置为本条测试后端地址。只对外部 HTTPS 站点 route fulfill 最小 HTML；禁止 route 后端、localhost、127.0.0.1，禁止替换 chrome API 或伪造 runtime 消息响应。
- popup 页面在导航前注册 pageerror；service worker 使用浏览器级 CDP 自动附着实际 chrome-extension://<id>/background/service-worker.js target，启用 Runtime 并记录 Runtime.exceptionThrown。console.error 另行留存，不能替代未捕获异常监听。finally 关闭本条所有页面、独立 context 与请求 context，不停止共享后端。

测试数据：URL=https://github.com/org/repo/pull/456；离线 HTML title=Refactor auth middleware (#456)。

步骤：

- S1：route https://github.com/** 返回指定 title；打开 PR 页面并等待 document.title 完全一致，bringToFront 使其成为真实活动标签。
- S2：以 tab 打开 popup，读取 current-page-title、current-page-url、current-page-system-badge。

预期：

- E1：current-page-title 文本严格等于「Refactor auth middleware (#456)」。
- E2：current-page-url 文本严格等于 https://github.com/org/repo/pull/456。
- E3：current-page-system-badge 不可见。

证据：

- evidence/TC-UI-CTX-004/：result.json、api/、server.log、extension.log、screenshots/、flow.gif、explore.json（自动化与 UI 探索阶段生成，本次尚未执行）
- screenshot: 活动 PR 与当前页面卡片

## TC-UI-CTX-005 后端不可达时当前页面仍显示 GitHub PR 标题和 URL

- 类型：UI；模块：CTX；优先级：P1；类别：exception；技术：error-guessing
- 关联 Feature：F-CTX-03
- 验收标准：F-CTX-03#AC2
- 关联 Code：C-FE-CTX-01、C-FE-CTX-04、C-FE-CTX-05

前置条件：

- 每条用例独立使用 Playwright launchPersistentContext：channel=chromium、空 userDataDir、--disable-extensions-except 与 --load-extension 指向真实 extension/；从真实 service worker URL 取得扩展 ID，popup 以 chrome-extension://<id>/popup/popup.html 标签页打开。
- 真实测试后端 ENABLE_TEST_API=1；本条开始前以真实 HTTP POST /api/__test__/reset 隔离数据，将 chrome.storage.local.apiBaseUrl 设置为本条测试后端地址。只对外部 HTTPS 站点 route fulfill 最小 HTML；禁止 route 后端、localhost、127.0.0.1，禁止替换 chrome API 或伪造 runtime 消息响应。
- popup 页面在导航前注册 pageerror；service worker 使用浏览器级 CDP 自动附着实际 chrome-extension://<id>/background/service-worker.js target，启用 Runtime 并记录 Runtime.exceptionThrown。console.error 另行留存，不能替代未捕获异常监听。finally 关闭本条所有页面、独立 context 与请求 context，不停止共享后端。
- apiBaseUrl=http://127.0.0.1:9，使用真实拒绝连接。

测试数据：URL=https://github.com/org/repo/pull/456；title=Refactor auth middleware (#456)。

步骤：

- S1：外部 GitHub route 返回指定 HTML，打开 PR 并 bringToFront；记录实际活动标签 URL。
- S2：以 tab 打开 popup，在真实后端连接失败后读取当前页面卡片。

预期：

- E1：current-page-title 文本严格等于「Refactor auth middleware (#456)」。
- E2：current-page-url 文本严格等于 https://github.com/org/repo/pull/456。
- E3：current-page-system-badge 不可见，popup pageerror 事件数为 0。

证据：

- evidence/TC-UI-CTX-005/：result.json、api/、server.log、extension.log、screenshots/、flow.gif、explore.json（自动化与 UI 探索阶段生成，本次尚未执行）
- network: 后端拒绝连接
- screenshot: 离线时当前页面卡片

## TC-UI-CTX-006 依次访问 PR 和 MDN 再打开 popup：排除插件自身并选择最近活动 MDN

- 类型：UI；模块：CTX；优先级：P0；类别：positive；技术：scenario
- 关联 Feature：F-CTX-04
- 验收标准：F-CTX-04#AC1
- 关联 Code：C-FE-CTX-01、C-FE-CTX-05

前置条件：

- 每条用例独立使用 Playwright launchPersistentContext：channel=chromium、空 userDataDir、--disable-extensions-except 与 --load-extension 指向真实 extension/；从真实 service worker URL 取得扩展 ID，popup 以 chrome-extension://<id>/popup/popup.html 标签页打开。
- 真实测试后端 ENABLE_TEST_API=1；本条开始前以真实 HTTP POST /api/__test__/reset 隔离数据，将 chrome.storage.local.apiBaseUrl 设置为本条测试后端地址。只对外部 HTTPS 站点 route fulfill 最小 HTML；禁止 route 后端、localhost、127.0.0.1，禁止替换 chrome API 或伪造 runtime 消息响应。
- popup 页面在导航前注册 pageerror；service worker 使用浏览器级 CDP 自动附着实际 chrome-extension://<id>/background/service-worker.js target，启用 Runtime 并记录 Runtime.exceptionThrown。console.error 另行留存，不能替代未捕获异常监听。finally 关闭本条所有页面、独立 context 与请求 context，不停止共享后端。

测试数据：PR=https://github.com/org/repo/pull/456；MDN=https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API；对应 title=PR 456、Fetch API。

步骤：

- S1：route 两个外部站点返回指定 title；依次打开 PR、MDN 并分别 bringToFront；用真实 chrome.tabs.query 读取，确认 MDN.lastAccessed > PR.lastAccessed，若同毫秒则再次实际激活直到严格大于。
- S2：以 tab 打开 popup，读取当前页面卡片；读取实际 chrome.tabs.query 验证 popup 已成为活动 tab。

预期：

- E1：current-page-url 文本严格等于 https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API。
- E2：current-page-title 文本严格等于「Fetch API」。
- E3：current-page-url 文本不以 chrome-extension:// 开头，且不等于 PR URL。

证据：

- evidence/TC-UI-CTX-006/：result.json、api/、server.log、extension.log、screenshots/、flow.gif、explore.json（自动化与 UI 探索阶段生成，本次尚未执行）
- artifact: 真实 tabId/url/active/lastAccessed 快照
- screenshot: 排除 popup 自身后的当前页面

## TC-UI-CTX-007 当前窗口没有 http(s) 候选时显示系统页标识

- 类型：UI；模块：CTX；优先级：P1；类别：boundary；技术：boundary
- 关联 Feature：F-CTX-04
- 验收标准：F-CTX-04#AC2
- 关联 Code：C-FE-CTX-01、C-FE-CTX-05

前置条件：

- 每条用例独立使用 Playwright launchPersistentContext：channel=chromium、空 userDataDir、--disable-extensions-except 与 --load-extension 指向真实 extension/；从真实 service worker URL 取得扩展 ID，popup 以 chrome-extension://<id>/popup/popup.html 标签页打开。
- 真实测试后端 ENABLE_TEST_API=1；本条开始前以真实 HTTP POST /api/__test__/reset 隔离数据，将 chrome.storage.local.apiBaseUrl 设置为本条测试后端地址。只对外部 HTTPS 站点 route fulfill 最小 HTML；禁止 route 后端、localhost、127.0.0.1，禁止替换 chrome API 或伪造 runtime 消息响应。
- popup 页面在导航前注册 pageerror；service worker 使用浏览器级 CDP 自动附着实际 chrome-extension://<id>/background/service-worker.js target，启用 Runtime 并记录 Runtime.exceptionThrown。console.error 另行留存，不能替代未捕获异常监听。finally 关闭本条所有页面、独立 context 与请求 context，不停止共享后端。
- 关闭本独立 context 内所有 http(s) 标签，只留下 about:blank 和插件 popup；用真实 tabs.query 验证当前窗口 http(s) 候选数量=0。

测试数据：零 http(s) 候选边界；不允许残留夹具自动创建的外部标签。

步骤：

- S1：核对当前窗口非插件标签只包含 about:blank，以 tab 打开 popup。
- S2：读取 current-page-system-badge 和 current-page-url。

预期：

- E1：current-page-system-badge 可见且文本严格等于「系统页 · 不采集」。
- E2：current-page-url 不显示任何 http://、https:// 或 chrome-extension:// 候选 URL。
- E3：popup pageerror 事件数为 0。

证据：

- evidence/TC-UI-CTX-007/：result.json、api/、server.log、extension.log、screenshots/、flow.gif、explore.json（自动化与 UI 探索阶段生成，本次尚未执行）

## TC-UI-CTX-008 重新激活较早创建的 PR 后打开 popup：按 lastAccessed 而非标签创建顺序判定

- 类型：UI；模块：CTX；优先级：P1；类别：state；技术：state-transition
- 关联 Feature：F-CTX-04
- 验收标准：F-CTX-04#AC1
- 关联 Code：C-FE-CTX-01、C-FE-CTX-05

前置条件：

- 每条用例独立使用 Playwright launchPersistentContext：channel=chromium、空 userDataDir、--disable-extensions-except 与 --load-extension 指向真实 extension/；从真实 service worker URL 取得扩展 ID，popup 以 chrome-extension://<id>/popup/popup.html 标签页打开。
- 真实测试后端 ENABLE_TEST_API=1；本条开始前以真实 HTTP POST /api/__test__/reset 隔离数据，将 chrome.storage.local.apiBaseUrl 设置为本条测试后端地址。只对外部 HTTPS 站点 route fulfill 最小 HTML；禁止 route 后端、localhost、127.0.0.1，禁止替换 chrome API 或伪造 runtime 消息响应。
- popup 页面在导航前注册 pageerror；service worker 使用浏览器级 CDP 自动附着实际 chrome-extension://<id>/background/service-worker.js target，启用 Runtime 并记录 Runtime.exceptionThrown。console.error 另行留存，不能替代未捕获异常监听。finally 关闭本条所有页面、独立 context 与请求 context，不停止共享后端。

测试数据：先创建 PR 再创建 MDN；最后重新激活 PR，真实 PR.lastAccessed > MDN.lastAccessed。

步骤：

- S1：离线路由后依次打开 PR 与 MDN；再次 bringToFront PR，用真实 tabs.query 确认 PR.lastAccessed 严格大于 MDN.lastAccessed。
- S2：以 tab 打开 popup，记录当前页面；关闭该 popup，实际激活 MDN 直到其 lastAccessed 更大，再新开 popup。

预期：

- E1：首次 current-page-url 严格等于 https://github.com/org/repo/pull/456。
- E2：第二次 current-page-url 严格等于 https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API。
- E3：两次 current-page-url 均不以 chrome-extension:// 开头。

证据：

- evidence/TC-UI-CTX-008/：result.json、api/、server.log、extension.log、screenshots/、flow.gif、explore.json（自动化与 UI 探索阶段生成，本次尚未执行）
- artifact: 两次真实 lastAccessed 与选择结果

## TC-UI-CTX-009 后端不可达且 popup 活动时仍按最近活动外部页回退

- 类型：UI；模块：CTX；优先级：P1；类别：exception；技术：error-guessing
- 关联 Feature：F-CTX-04
- 验收标准：F-CTX-04#AC1
- 关联 Code：C-FE-CTX-01、C-FE-CTX-05

前置条件：

- 每条用例独立使用 Playwright launchPersistentContext：channel=chromium、空 userDataDir、--disable-extensions-except 与 --load-extension 指向真实 extension/；从真实 service worker URL 取得扩展 ID，popup 以 chrome-extension://<id>/popup/popup.html 标签页打开。
- 真实测试后端 ENABLE_TEST_API=1；本条开始前以真实 HTTP POST /api/__test__/reset 隔离数据，将 chrome.storage.local.apiBaseUrl 设置为本条测试后端地址。只对外部 HTTPS 站点 route fulfill 最小 HTML；禁止 route 后端、localhost、127.0.0.1，禁止替换 chrome API 或伪造 runtime 消息响应。
- popup 页面在导航前注册 pageerror；service worker 使用浏览器级 CDP 自动附着实际 chrome-extension://<id>/background/service-worker.js target，启用 Runtime 并记录 Runtime.exceptionThrown。console.error 另行留存，不能替代未捕获异常监听。finally 关闭本条所有页面、独立 context 与请求 context，不停止共享后端。
- apiBaseUrl=http://127.0.0.1:9。

测试数据：依次实际激活 PR、MDN，MDN 的真实 lastAccessed 严格较大。

步骤：

- S1：route 外部页面并依次打开和激活 PR、MDN，真实 tabs.query 确认 MDN.lastAccessed > PR.lastAccessed。
- S2：以 tab 打开 popup；在真实后端连接失败后读取 current-page-url。

预期：

- E1：current-page-url 严格等于 https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API。
- E2：current-page-url 不以 chrome-extension:// 开头，current-page-system-badge 不可见。
- E3：popup pageerror 事件数为 0。

证据：

- evidence/TC-UI-CTX-009/：result.json、api/、server.log、extension.log、screenshots/、flow.gif、explore.json（自动化与 UI 探索阶段生成，本次尚未执行）

## TC-UI-CTX-010 当前窗口四个外部页面在上下文列表逐条显示标题和完整 URL

- 类型：UI；模块：CTX；优先级：P0；类别：positive；技术：equivalence
- 关联 Feature：F-CTX-05
- 验收标准：F-CTX-05#AC1
- 关联 Code：C-FE-CTX-02、C-FE-CTX-04、C-FE-CTX-06

前置条件：

- 每条用例独立使用 Playwright launchPersistentContext：channel=chromium、空 userDataDir、--disable-extensions-except 与 --load-extension 指向真实 extension/；从真实 service worker URL 取得扩展 ID，popup 以 chrome-extension://<id>/popup/popup.html 标签页打开。
- 真实测试后端 ENABLE_TEST_API=1；本条开始前以真实 HTTP POST /api/__test__/reset 隔离数据，将 chrome.storage.local.apiBaseUrl 设置为本条测试后端地址。只对外部 HTTPS 站点 route fulfill 最小 HTML；禁止 route 后端、localhost、127.0.0.1，禁止替换 chrome API 或伪造 runtime 消息响应。
- popup 页面在导航前注册 pageerror；service worker 使用浏览器级 CDP 自动附着实际 chrome-extension://<id>/background/service-worker.js target，启用 Runtime 并记录 Runtime.exceptionThrown。console.error 另行留存，不能替代未捕获异常监听。finally 关闭本条所有页面、独立 context 与请求 context，不停止共享后端。

测试数据：四组数据：pull/456→PR 456；issues/123→Issue 123；MDN Fetch_API→Fetch API；docs.internal.com/ai-agent-design→AI Agent Design；完整 URL 与 AC1 一致。

步骤：

- S1：分别 route github.com、developer.mozilla.org、docs.internal.com；在同一普通窗口打开 https://github.com/org/repo/pull/456、https://github.com/org/repo/issues/123、https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API、https://docs.internal.com/ai-agent-design。
- S2：以 tab 打开 popup，点击 tab-context，等待 context-loading 不可见；在 context-tabs-list 内读取 context-tab-item 的 context-tab-title 与 context-tab-url。

预期：

- E1：context-tabs-list 中四个指定 URL 各出现且仅出现 1 条；不要求列表总数=4，避免把系统页/插件页展示策略混入本验收。
- E2：四条记录的 context-tab-title 分别严格等于「PR 456」「Issue 123」「Fetch API」「AI Agent Design」。
- E3：四条记录的 context-tab-url 分别严格等于完整的四个输入 URL。
- E4：context-error 不可见。

证据：

- evidence/TC-UI-CTX-010/：result.json、api/、server.log、extension.log、screenshots/、flow.gif、explore.json（自动化与 UI 探索阶段生成，本次尚未执行）
- screenshot: 四条当前窗口记录
- artifact: UI 标题/URL 与真实 tabs.query 对照

## TC-UI-CTX-011 另一普通窗口的页面不会混入当前窗口上下文列表

- 类型：UI；模块：CTX；优先级：P1；类别：negative；技术：decision-table
- 关联 Feature：F-CTX-05
- 验收标准：F-CTX-05#AC2
- 关联 Code：C-FE-CTX-02、C-FE-CTX-04、C-FE-CTX-06

前置条件：

- 每条用例独立使用 Playwright launchPersistentContext：channel=chromium、空 userDataDir、--disable-extensions-except 与 --load-extension 指向真实 extension/；从真实 service worker URL 取得扩展 ID，popup 以 chrome-extension://<id>/popup/popup.html 标签页打开。
- 真实测试后端 ENABLE_TEST_API=1；本条开始前以真实 HTTP POST /api/__test__/reset 隔离数据，将 chrome.storage.local.apiBaseUrl 设置为本条测试后端地址。只对外部 HTTPS 站点 route fulfill 最小 HTML；禁止 route 后端、localhost、127.0.0.1，禁止替换 chrome API 或伪造 runtime 消息响应。
- popup 页面在导航前注册 pageerror；service worker 使用浏览器级 CDP 自动附着实际 chrome-extension://<id>/background/service-worker.js target，启用 Runtime 并记录 Runtime.exceptionThrown。console.error 另行留存，不能替代未捕获异常监听。finally 关闭本条所有页面、独立 context 与请求 context，不停止共享后端。
- 通过真实 chrome.windows.create 创建另一个普通窗口，不使用另一个 context 冒充另一个窗口；finally 关闭本条创建的窗口。

测试数据：窗口 A：https://github.com/org/repo/pull/456；窗口 B：https://example.com/other。

步骤：

- S1：route 外部站点，在窗口 A 打开 PR；使用真实 windows.create 在同一 context 的窗口 B 打开 other，读取真实 windowId 确认 A≠B。
- S2：使用真实 windows.update 聚焦 A，再在 A 通过真实 tabs.create 打开 popup；点击 tab-context，读取 context-tabs-list 内全部 context-tab-url。

预期：

- E1：context-tabs-list 包含 https://github.com/org/repo/pull/456 且恰好 1 条。
- E2：context-tabs-list 的 context-tab-url 中 https://example.com/other 出现次数=0。
- E3：真实 chrome.tabs.query 仍可读取窗口 B 的 other 标签且 URL 未改变，排除因关闭他窗形成假阴性。

证据：

- evidence/TC-UI-CTX-011/：result.json、api/、server.log、extension.log、screenshots/、flow.gif、explore.json（自动化与 UI 探索阶段生成，本次尚未执行）
- artifact: A/B windowId 和前后 tabs.query
- screenshot: 窗口 A 上下文

## TC-UI-CTX-012 后端不可达时当前窗口四条标签仍完整显示

- 类型：UI；模块：CTX；优先级：P1；类别：exception；技术：error-guessing
- 关联 Feature：F-CTX-05
- 验收标准：F-CTX-05#AC1
- 关联 Code：C-FE-CTX-02、C-FE-CTX-04、C-FE-CTX-06

前置条件：

- 每条用例独立使用 Playwright launchPersistentContext：channel=chromium、空 userDataDir、--disable-extensions-except 与 --load-extension 指向真实 extension/；从真实 service worker URL 取得扩展 ID，popup 以 chrome-extension://<id>/popup/popup.html 标签页打开。
- 真实测试后端 ENABLE_TEST_API=1；本条开始前以真实 HTTP POST /api/__test__/reset 隔离数据，将 chrome.storage.local.apiBaseUrl 设置为本条测试后端地址。只对外部 HTTPS 站点 route fulfill 最小 HTML；禁止 route 后端、localhost、127.0.0.1，禁止替换 chrome API 或伪造 runtime 消息响应。
- popup 页面在导航前注册 pageerror；service worker 使用浏览器级 CDP 自动附着实际 chrome-extension://<id>/background/service-worker.js target，启用 Runtime 并记录 Runtime.exceptionThrown。console.error 另行留存，不能替代未捕获异常监听。finally 关闭本条所有页面、独立 context 与请求 context，不停止共享后端。
- apiBaseUrl=http://127.0.0.1:9。

测试数据：同一窗口四条：https://github.com/org/repo/pull/456（PR 456）、https://github.com/org/repo/issues/123（Issue 123）、https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API（Fetch API）、https://docs.internal.com/ai-agent-design（AI Agent Design）。

步骤：

- S1：仅 route 四个外部 URL，真实打开四个标题明确的页面。
- S2：以 tab 打开 popup 并点击 tab-context，待 context-loading 消失；读取 context-tabs-list 内标题与 URL。

预期：

- E1：四个指定 URL 的 context-tab-item 各出现 1 条且对应标题严格等于输入标题。
- E2：context-error 不可见，context-loading 不可见。
- E3：popup pageerror 事件数为 0。

证据：

- evidence/TC-UI-CTX-012/：result.json、api/、server.log、extension.log、screenshots/、flow.gif、explore.json（自动化与 UI 探索阶段生成，本次尚未执行）
- network: 端口 9 真实连接失败
- screenshot: 后端离线下的标签列表

## TC-UI-CTX-013 三条真实新增历史按最后访问时间从新到旧显示

- 类型：UI；模块：CTX；优先级：P0；类别：positive；技术：equivalence
- 关联 Feature：F-CTX-06
- 验收标准：F-CTX-06#AC1
- 关联 Code：C-FE-CTX-03、C-FE-CTX-04、C-FE-CTX-06

前置条件：

- 每条用例独立使用 Playwright launchPersistentContext：channel=chromium、空 userDataDir、--disable-extensions-except 与 --load-extension 指向真实 extension/；从真实 service worker URL 取得扩展 ID，popup 以 chrome-extension://<id>/popup/popup.html 标签页打开。
- 真实测试后端 ENABLE_TEST_API=1；本条开始前以真实 HTTP POST /api/__test__/reset 隔离数据，将 chrome.storage.local.apiBaseUrl 设置为本条测试后端地址。只对外部 HTTPS 站点 route fulfill 最小 HTML；禁止 route 后端、localhost、127.0.0.1，禁止替换 chrome API 或伪造 runtime 消息响应。
- popup 页面在导航前注册 pageerror；service worker 使用浏览器级 CDP 自动附着实际 chrome-extension://<id>/background/service-worker.js target，启用 Runtime 并记录 Runtime.exceptionThrown。console.error 另行留存，不能替代未捕获异常监听。finally 关闭本条所有页面、独立 context 与请求 context，不停止共享后端。
- 本条打开 popup 后再 chrome.history.deleteAll 清空独立 profile 的历史；随后只用真实 chrome.history.addUrl 添加测试记录，之后不导航任何外部页面。

测试数据：按顺序添加 https://history.example/ctx/a、https://history.example/ctx/b、https://history.example/ctx/c。addUrl 不接受自造时间；每次追加后真实 history.search 读回，等上一时间戳推进后再追加，确保 tA<tB<tC。

步骤：

- S1：清空历史后依次真实 history.addUrl 添加 a、b、c；每步用真实 history.search 读回 lastVisitTime，并确保三者严格递增，不覆盖浏览器 API。
- S2：刷新 popup，点击 tab-context，读取 context-history-count、context-history-item 内 context-history-url 和 context-history-time 的 data-ts。

预期：

- E1：context-history-count 文本严格等于「3」，context-history-item 数量=3。
- E2：三项 context-history-url 顺序严格等于 c、b、a 三个完整 URL。
- E3：三项 context-history-time 的 data-ts 分别等于浏览器读回的 tC、tB、tA，且严格递减。
- E4：context-history-empty 与 context-error 均不可见。

证据：

- evidence/TC-UI-CTX-013/：result.json、api/、server.log、extension.log、screenshots/、flow.gif、explore.json（自动化与 UI 探索阶段生成，本次尚未执行）
- artifact: 三次真实 addUrl/readback 的 lastVisitTime
- screenshot: 三条历史顺序

## TC-UI-CTX-014 浏览器有 120 条 30 天内历史时仅展示最近 100 条

- 类型：UI；模块：CTX；优先级：P1；类别：boundary；技术：boundary
- 关联 Feature：F-CTX-06
- 验收标准：F-CTX-06#AC2
- 关联 Code：C-FE-CTX-03、C-FE-CTX-04、C-FE-CTX-06

前置条件：

- 每条用例独立使用 Playwright launchPersistentContext：channel=chromium、空 userDataDir、--disable-extensions-except 与 --load-extension 指向真实 extension/；从真实 service worker URL 取得扩展 ID，popup 以 chrome-extension://<id>/popup/popup.html 标签页打开。
- 真实测试后端 ENABLE_TEST_API=1；本条开始前以真实 HTTP POST /api/__test__/reset 隔离数据，将 chrome.storage.local.apiBaseUrl 设置为本条测试后端地址。只对外部 HTTPS 站点 route fulfill 最小 HTML；禁止 route 后端、localhost、127.0.0.1，禁止替换 chrome API 或伪造 runtime 消息响应。
- popup 页面在导航前注册 pageerror；service worker 使用浏览器级 CDP 自动附着实际 chrome-extension://<id>/background/service-worker.js target，启用 Runtime 并记录 Runtime.exceptionThrown。console.error 另行留存，不能替代未捕获异常监听。finally 关闭本条所有页面、独立 context 与请求 context，不停止共享后端。
- popup 创建后真实 history.deleteAll；不再导航外部页面。

测试数据：用真实 history.addUrl 添加 https://history.example/ctx/cap/001 至 /120，全部是当前实际访问时间；最少确保第20与21条的真实 lastVisitTime 不同，避免第100名边界并列。

步骤：

- S1：清空历史并真实添加 120 个唯一 URL；用真实 history.search({text:"",startTime:Date.now()-30*86400000,maxResults:1000}) 确认独立浏览器历史恰好 120 条，并记录其 lastVisitTime。
- S2：刷新 popup 进入 tab-context；按真实 lastVisitTime 倒序计算前100项 URL 集合，读取 UI 历史列表及条数。

预期：

- E1：context-history-count 文本严格等于「100」，context-history-item 数量=100。
- E2：UI URL 集合严格等于真实历史按 lastVisitTime 倒序取前100条的集合；最后20条不在 UI 中。
- E3：UI 各项 context-history-time 的 data-ts 非递增。

证据：

- evidence/TC-UI-CTX-014/：result.json、api/、server.log、extension.log、screenshots/、flow.gif、explore.json（自动化与 UI 探索阶段生成，本次尚未执行）
- artifact: 120 条真实历史快照和前100条计算结果
- screenshot: 100条上限

## TC-UI-CTX-015 历史数量在 99、100、101 三个边界时展示数量分别为 99、100、100

- 类型：UI；模块：CTX；优先级：P1；类别：boundary；技术：boundary
- 关联 Feature：F-CTX-06
- 验收标准：F-CTX-06#AC2
- 关联 Code：C-FE-CTX-03、C-FE-CTX-06

前置条件：

- 每条用例独立使用 Playwright launchPersistentContext：channel=chromium、空 userDataDir、--disable-extensions-except 与 --load-extension 指向真实 extension/；从真实 service worker URL 取得扩展 ID，popup 以 chrome-extension://<id>/popup/popup.html 标签页打开。
- 真实测试后端 ENABLE_TEST_API=1；本条开始前以真实 HTTP POST /api/__test__/reset 隔离数据，将 chrome.storage.local.apiBaseUrl 设置为本条测试后端地址。只对外部 HTTPS 站点 route fulfill 最小 HTML；禁止 route 后端、localhost、127.0.0.1，禁止替换 chrome API 或伪造 runtime 消息响应。
- popup 页面在导航前注册 pageerror；service worker 使用浏览器级 CDP 自动附着实际 chrome-extension://<id>/background/service-worker.js target，启用 Runtime 并记录 Runtime.exceptionThrown。console.error 另行留存，不能替代未捕获异常监听。finally 关闭本条所有页面、独立 context 与请求 context，不停止共享后端。
- 同一 Case 可参数化 N=99、100、101；每个变体都新建独立 persistent context、reset 后端并自行清空/造历史，禁止复用其他变体数据。

测试数据：每个变体真实 history.addUrl 添加 N 个 https://history.example/ctx/n<N>/<序号>，均在30天内；不把 addUrl 当作可设置旧时间的 API。

步骤：

- S1：每个变体创建 popup 后清空真实浏览器历史，添加恰好 N 条唯一 URL，用真实 history.search(maxResults=1000) 确认数目=N。
- S2：刷新 popup 后点击 tab-context，读取 context-history-count、context-history-item 数量及 URL 唯一性。

预期：

- E1：N=99 时 context-history-count 文本为「99」且 context-history-item 数量=99。
- E2：N=100 时 context-history-count 文本为「100」且 context-history-item 数量=100。
- E3：N=101 时 context-history-count 文本为「100」且 context-history-item 数量=100。
- E4：每个变体 UI 中 context-history-url 均唯一，且全部属于本变体的真实输入集合。

证据：

- evidence/TC-UI-CTX-015/：result.json、api/、server.log、extension.log、screenshots/、flow.gif、explore.json（自动化与 UI 探索阶段生成，本次尚未执行）
- artifact: 三个独立变体的 N、实际输入数量和 UI readback

## TC-UI-CTX-016 清空真实浏览器历史后显示零条与空状态

- 类型：UI；模块：CTX；优先级：P1；类别：state；技术：state-transition
- 关联 Feature：F-CTX-06
- 验收标准：F-CTX-06#AC1
- 关联 Code：C-FE-CTX-03、C-FE-CTX-04、C-FE-CTX-06

前置条件：

- 每条用例独立使用 Playwright launchPersistentContext：channel=chromium、空 userDataDir、--disable-extensions-except 与 --load-extension 指向真实 extension/；从真实 service worker URL 取得扩展 ID，popup 以 chrome-extension://<id>/popup/popup.html 标签页打开。
- 真实测试后端 ENABLE_TEST_API=1；本条开始前以真实 HTTP POST /api/__test__/reset 隔离数据，将 chrome.storage.local.apiBaseUrl 设置为本条测试后端地址。只对外部 HTTPS 站点 route fulfill 最小 HTML；禁止 route 后端、localhost、127.0.0.1，禁止替换 chrome API 或伪造 runtime 消息响应。
- popup 页面在导航前注册 pageerror；service worker 使用浏览器级 CDP 自动附着实际 chrome-extension://<id>/background/service-worker.js target，启用 Runtime 并记录 Runtime.exceptionThrown。console.error 另行留存，不能替代未捕获异常监听。finally 关闭本条所有页面、独立 context 与请求 context，不停止共享后端。

测试数据：独立 profile；先添加 https://history.example/ctx/clear，再 history.deleteAll；popup 为扩展页面，不产生 http(s) 历史。此为空数据派生状态，三条正例由独立正例覆盖。

步骤：

- S1：打开 popup 后用真实 history.addUrl 添加一条历史，使用真实 history.search 读回该 URL，再真实 history.deleteAll。
- S2：确认真实 history.search 的结果=[]；刷新 popup 并进入 tab-context。

预期：

- E1：context-history-count 文本严格等于「0」，context-history-item 数量=0。
- E2：context-history-empty 可见。
- E3：context-loading 与 context-error 均不可见，popup pageerror 事件数为 0。

证据：

- evidence/TC-UI-CTX-016/：result.json、api/、server.log、extension.log、screenshots/、flow.gif、explore.json（自动化与 UI 探索阶段生成，本次尚未执行）
- artifact: 删除前后一条→零条真实浏览器历史

## TC-UI-CTX-017 上下文展示真实历史查询参数：30 天窗口与 maxResults=100

- 类型：UI；模块：CTX；优先级：P0；类别：positive；技术：boundary
- 关联 Feature：F-CTX-06
- 验收标准：F-CTX-06#AC3
- 关联 Code：C-FE-CTX-03、C-FE-CTX-04、C-FE-CTX-06

前置条件：

- 每条用例独立使用 Playwright launchPersistentContext：channel=chromium、空 userDataDir、--disable-extensions-except 与 --load-extension 指向真实 extension/；从真实 service worker URL 取得扩展 ID，popup 以 chrome-extension://<id>/popup/popup.html 标签页打开。
- 真实测试后端 ENABLE_TEST_API=1；本条开始前以真实 HTTP POST /api/__test__/reset 隔离数据，将 chrome.storage.local.apiBaseUrl 设置为本条测试后端地址。只对外部 HTTPS 站点 route fulfill 最小 HTML；禁止 route 后端、localhost、127.0.0.1，禁止替换 chrome API 或伪造 runtime 消息响应。
- popup 页面在导航前注册 pageerror；service worker 使用浏览器级 CDP 自动附着实际 chrome-extension://<id>/background/service-worker.js target，启用 Runtime 并记录 Runtime.exceptionThrown。console.error 另行留存，不能替代未捕获异常监听。finally 关闭本条所有页面、独立 context 与请求 context，不停止共享后端。

测试数据：DAY30=2592000000 毫秒；不新增 ?now= 参数、不改 Date.now，也不替换 history.search。context-history-query 按 UI 契约暴露实际传参。

步骤：

- S1：打开 popup 后记录 tBefore=Date.now()，点击 tab-context，等待 context-loading 消失并记录 tAfter=Date.now()。
- S2：读取 context-history-query 的 data-start-time、data-max-results；将 startTime 解析为有限毫秒数，保留 tBefore/tAfter。

预期：

- E1：data-max-results 解析后严格等于 100。
- E2：data-start-time 解析后的数值为有限数，且位于 [tBefore-2592000000-60000,tAfter-2592000000+60000]。
- E3：tAfter-tBefore 小于 60000 毫秒；若超时本条失败，不能扩大 startTime 容差。

证据：

- evidence/TC-UI-CTX-017/：result.json、api/、server.log、extension.log、screenshots/、flow.gif、explore.json（自动化与 UI 探索阶段生成，本次尚未执行）
- artifact: 原始 data 属性、tBefore/tAfter 与允许区间

## TC-UI-CTX-018 后端不可达时最近三条浏览器历史及查询参数仍可读取

- 类型：UI；模块：CTX；优先级：P1；类别：exception；技术：error-guessing
- 关联 Feature：F-CTX-06
- 验收标准：F-CTX-06#AC1、F-CTX-06#AC3
- 关联 Code：C-FE-CTX-03、C-FE-CTX-04、C-FE-CTX-06

前置条件：

- 每条用例独立使用 Playwright launchPersistentContext：channel=chromium、空 userDataDir、--disable-extensions-except 与 --load-extension 指向真实 extension/；从真实 service worker URL 取得扩展 ID，popup 以 chrome-extension://<id>/popup/popup.html 标签页打开。
- 真实测试后端 ENABLE_TEST_API=1；本条开始前以真实 HTTP POST /api/__test__/reset 隔离数据，将 chrome.storage.local.apiBaseUrl 设置为本条测试后端地址。只对外部 HTTPS 站点 route fulfill 最小 HTML；禁止 route 后端、localhost、127.0.0.1，禁止替换 chrome API 或伪造 runtime 消息响应。
- popup 页面在导航前注册 pageerror；service worker 使用浏览器级 CDP 自动附着实际 chrome-extension://<id>/background/service-worker.js target，启用 Runtime 并记录 Runtime.exceptionThrown。console.error 另行留存，不能替代未捕获异常监听。finally 关闭本条所有页面、独立 context 与请求 context，不停止共享后端。
- apiBaseUrl=http://127.0.0.1:9；打开 popup 后清空历史再造三条，本条不依赖共享后端停机。

测试数据：https://history.example/ctx/offline/a、/b、/c；真实 addUrl/readback 保证 tA<tB<tC。

步骤：

- S1：真实 deleteAll 后依次 addUrl 三条并读回严格递增 lastVisitTime；不再访问外部页面。
- S2：记录 tBefore，刷新 popup 点击 tab-context，等待加载完成后记录 tAfter；读取历史 URL 和 context-history-query 属性。

预期：

- E1：context-history-count 文本为「3」，三条 context-history-url 顺序严格为 c、b、a。
- E2：context-history-query 的 data-max-results=100，data-start-time 位于 [tBefore-2592000000-60000,tAfter-2592000000+60000]，且 tAfter-tBefore<60000。
- E3：context-error 与 context-history-empty 不可见。
- E4：popup pageerror 与本次 SW Runtime.exceptionThrown 事件数均为0。

证据：

- evidence/TC-UI-CTX-018/：result.json、api/、server.log、extension.log、screenshots/、flow.gif、explore.json（自动化与 UI 探索阶段生成，本次尚未执行）
- network: 不可达后端请求
- artifact: 浏览器真实历史与实际查询参数

## TC-UI-CTX-019 仅有 chrome://version 系统页时当前页面降级且无未捕获错误

- 类型：UI；模块：CTX；优先级：P0；类别：positive；技术：equivalence
- 关联 Feature：F-CTX-07、F-CTX-04
- 验收标准：F-CTX-07#AC1、F-CTX-04#AC2
- 关联 Code：C-FE-CORE-05、C-FE-CTX-01、C-FE-CTX-04、C-FE-CTX-05

前置条件：

- 每条用例独立使用 Playwright launchPersistentContext：channel=chromium、空 userDataDir、--disable-extensions-except 与 --load-extension 指向真实 extension/；从真实 service worker URL 取得扩展 ID，popup 以 chrome-extension://<id>/popup/popup.html 标签页打开。
- 真实测试后端 ENABLE_TEST_API=1；本条开始前以真实 HTTP POST /api/__test__/reset 隔离数据，将 chrome.storage.local.apiBaseUrl 设置为本条测试后端地址。只对外部 HTTPS 站点 route fulfill 最小 HTML；禁止 route 后端、localhost、127.0.0.1，禁止替换 chrome API 或伪造 runtime 消息响应。
- popup 页面在导航前注册 pageerror；service worker 使用浏览器级 CDP 自动附着实际 chrome-extension://<id>/background/service-worker.js target，启用 Runtime 并记录 Runtime.exceptionThrown。console.error 另行留存，不能替代未捕获异常监听。finally 关闭本条所有页面、独立 context 与请求 context，不停止共享后端。
- 关闭当前窗口所有 http(s) 页面；真实 tabs.query 确认除插件页面外 http(s) 候选数=0，避免系统页场景回退到残留外部标签。

测试数据：活动非插件标签 chrome://version/；Chromium 对 URL 的末尾斜线规范化不作为失败判据。

步骤：

- S1：真实打开 chrome://version/ 并 bringToFront；以真实 tabs.query 确认这是活动非插件标签且无 http(s) 候选。
- S2：以 tab 打开 popup，读取 current-page-system-badge；持续记录 popup pageerror。

预期：

- E1：current-page-system-badge 可见且文本严格等于「系统页 · 不采集」。
- E2：current-page-url 不显示任何 http(s) URL 或 chrome-extension:// URL。
- E3：popup pageerror 事件数为0。

证据：

- evidence/TC-UI-CTX-019/：result.json、api/、server.log、extension.log、screenshots/、flow.gif、explore.json（自动化与 UI 探索阶段生成，本次尚未执行）
- artifact: 当前窗口零 http(s) 候选的真实 tabs 快照
- screenshot: 系统页降级卡片

## TC-UI-CTX-020 系统页与 React 普通页混合时只给系统页标注跳过

- 类型：UI；模块：CTX；优先级：P0；类别：positive；技术：decision-table
- 关联 Feature：F-CTX-07
- 验收标准：F-CTX-07#AC2
- 关联 Code：C-FE-CORE-05、C-FE-CTX-04、C-FE-CTX-06

前置条件：

- 每条用例独立使用 Playwright launchPersistentContext：channel=chromium、空 userDataDir、--disable-extensions-except 与 --load-extension 指向真实 extension/；从真实 service worker URL 取得扩展 ID，popup 以 chrome-extension://<id>/popup/popup.html 标签页打开。
- 真实测试后端 ENABLE_TEST_API=1；本条开始前以真实 HTTP POST /api/__test__/reset 隔离数据，将 chrome.storage.local.apiBaseUrl 设置为本条测试后端地址。只对外部 HTTPS 站点 route fulfill 最小 HTML；禁止 route 后端、localhost、127.0.0.1，禁止替换 chrome API 或伪造 runtime 消息响应。
- popup 页面在导航前注册 pageerror；service worker 使用浏览器级 CDP 自动附着实际 chrome-extension://<id>/background/service-worker.js target，启用 Runtime 并记录 Runtime.exceptionThrown。console.error 另行留存，不能替代未捕获异常监听。finally 关闭本条所有页面、独立 context 与请求 context，不停止共享后端。

测试数据：chrome://version/；https://react.dev/learn，离线 HTML title=Learn React。

步骤：

- S1：真实打开 chrome://version/；route react.dev 后真实打开 https://react.dev/learn。
- S2：以 tab 打开 popup 并进入 tab-context；在 context-tabs-list 内用各项 context-tab-url 文本匹配系统页与 React 行，再读取各自行内 context-tab-badge。

预期：

- E1：匹配 chrome://version（忽略 Chromium 末尾斜线规范化）的行恰好1条，其 context-tab-badge 文本严格等于「系统页 · 跳过」。
- E2：https://react.dev/learn 行恰好1条，context-tab-title 文本为「Learn React」。
- E3：React 行内 context-tab-badge 数量=0。
- E4：popup pageerror 事件数为0。

证据：

- evidence/TC-UI-CTX-020/：result.json、api/、server.log、extension.log、screenshots/、flow.gif、explore.json（自动化与 UI 探索阶段生成，本次尚未执行）
- screenshot: 系统页与普通页各自标记

## TC-UI-CTX-021 后端不可达且仅有系统页时仍显示降级卡片与跳过标注

- 类型：UI；模块：CTX；优先级：P1；类别：exception；技术：error-guessing
- 关联 Feature：F-CTX-07、F-CTX-04
- 验收标准：F-CTX-07#AC1、F-CTX-07#AC2、F-CTX-04#AC2
- 关联 Code：C-FE-CORE-05、C-FE-CTX-01、C-FE-CTX-04、C-FE-CTX-05、C-FE-CTX-06

前置条件：

- 每条用例独立使用 Playwright launchPersistentContext：channel=chromium、空 userDataDir、--disable-extensions-except 与 --load-extension 指向真实 extension/；从真实 service worker URL 取得扩展 ID，popup 以 chrome-extension://<id>/popup/popup.html 标签页打开。
- 真实测试后端 ENABLE_TEST_API=1；本条开始前以真实 HTTP POST /api/__test__/reset 隔离数据，将 chrome.storage.local.apiBaseUrl 设置为本条测试后端地址。只对外部 HTTPS 站点 route fulfill 最小 HTML；禁止 route 后端、localhost、127.0.0.1，禁止替换 chrome API 或伪造 runtime 消息响应。
- popup 页面在导航前注册 pageerror；service worker 使用浏览器级 CDP 自动附着实际 chrome-extension://<id>/background/service-worker.js target，启用 Runtime 并记录 Runtime.exceptionThrown。console.error 另行留存，不能替代未捕获异常监听。finally 关闭本条所有页面、独立 context 与请求 context，不停止共享后端。
- apiBaseUrl=http://127.0.0.1:9；关闭所有 http(s) 标签并真实确认候选数=0。

测试数据：阶段一仅有 chrome://version/；阶段二本条独立 route 并新增 https://react.dev/learn。

步骤：

- S1：只保留 chrome://version/ 与插件页，以 tab 打开 popup，读取当前页面卡片并点击 tab-context。
- S2：读取系统页行的 context-tab-badge；然后 route react.dev 并真实打开 https://react.dev/learn，重新激活 popup 并刷新、进入 tab-context，读取两行标注。

预期：

- E1：阶段一 current-page-system-badge 文本严格等于「系统页 · 不采集」。
- E2：阶段一和阶段二系统页行的 context-tab-badge 均严格等于「系统页 · 跳过」。
- E3：阶段二 React 行 context-tab-url=https://react.dev/learn，且其 context-tab-badge 数量=0。
- E4：popup pageerror 与本次 SW Runtime.exceptionThrown 事件数均为0。

证据：

- evidence/TC-UI-CTX-021/：result.json、api/、server.log、extension.log、screenshots/、flow.gif、explore.json（自动化与 UI 探索阶段生成，本次尚未执行）
- network: 真实拒绝连接
- screenshot: 离线系统页及混合列表

## Feature / AC / 用例 / 类别覆盖表

| Feature | AC | 覆盖用例 | 类别 |
|---|---|---|---|
| F-CTX-01 | AC1 | TC-UI-CTX-001 | positive |
| F-CTX-01 | AC2 | TC-UI-CTX-001 | positive |
| F-CTX-01 | AC3 | TC-UI-CTX-001 | positive |
| F-CTX-02 | AC1 | TC-UI-CTX-002、TC-UI-CTX-003 | positive、exception |
| F-CTX-02 | AC2 | TC-UI-CTX-002、TC-UI-CTX-003 | positive、exception |
| F-CTX-03 | AC1 | TC-UI-CTX-004 | positive |
| F-CTX-03 | AC2 | TC-UI-CTX-005 | exception |
| F-CTX-04 | AC1 | TC-UI-CTX-006、TC-UI-CTX-008、TC-UI-CTX-009 | positive、state、exception |
| F-CTX-04 | AC2 | TC-UI-CTX-007、TC-UI-CTX-019、TC-UI-CTX-021 | boundary、positive、exception |
| F-CTX-05 | AC1 | TC-UI-CTX-010、TC-UI-CTX-012 | positive、exception |
| F-CTX-05 | AC2 | TC-UI-CTX-011 | negative |
| F-CTX-06 | AC1 | TC-UI-CTX-013、TC-UI-CTX-016、TC-UI-CTX-018 | positive、state、exception |
| F-CTX-06 | AC2 | TC-UI-CTX-014、TC-UI-CTX-015 | boundary |
| F-CTX-06 | AC3 | TC-UI-CTX-017、TC-UI-CTX-018 | positive、exception |
| F-CTX-07 | AC1 | TC-UI-CTX-019、TC-UI-CTX-021 | positive、exception |
| F-CTX-07 | AC2 | TC-UI-CTX-020、TC-UI-CTX-021 | positive、exception |

## Code 覆盖表

| Code ID | 覆盖用例 |
|---|---|
| C-FE-CORE-01 | TC-UI-CTX-001、TC-UI-CTX-002 |
| C-FE-CORE-02 | TC-UI-CTX-002、TC-UI-CTX-003 |
| C-FE-CORE-04 | TC-UI-CTX-002、TC-UI-CTX-003 |
| C-FE-CORE-05 | TC-UI-CTX-019、TC-UI-CTX-020、TC-UI-CTX-021 |
| C-FE-CORE-06 | TC-UI-CTX-002、TC-UI-CTX-003 |
| C-FE-CORE-07 | TC-UI-CTX-002、TC-UI-CTX-003 |
| C-FE-CTX-01 | TC-UI-CTX-004、TC-UI-CTX-005、TC-UI-CTX-006、TC-UI-CTX-007、TC-UI-CTX-008、TC-UI-CTX-009、TC-UI-CTX-019、TC-UI-CTX-021 |
| C-FE-CTX-02 | TC-UI-CTX-010、TC-UI-CTX-011、TC-UI-CTX-012 |
| C-FE-CTX-03 | TC-UI-CTX-013、TC-UI-CTX-014、TC-UI-CTX-015、TC-UI-CTX-016、TC-UI-CTX-017、TC-UI-CTX-018 |
| C-FE-CTX-04 | TC-UI-CTX-004、TC-UI-CTX-005、TC-UI-CTX-010、TC-UI-CTX-011、TC-UI-CTX-012、TC-UI-CTX-013、TC-UI-CTX-014、TC-UI-CTX-016、TC-UI-CTX-017、TC-UI-CTX-018、TC-UI-CTX-019、TC-UI-CTX-020、TC-UI-CTX-021 |
| C-FE-CTX-05 | TC-UI-CTX-004、TC-UI-CTX-005、TC-UI-CTX-006、TC-UI-CTX-007、TC-UI-CTX-008、TC-UI-CTX-009、TC-UI-CTX-019、TC-UI-CTX-021 |
| C-FE-CTX-06 | TC-UI-CTX-010、TC-UI-CTX-011、TC-UI-CTX-012、TC-UI-CTX-013、TC-UI-CTX-014、TC-UI-CTX-015、TC-UI-CTX-016、TC-UI-CTX-017、TC-UI-CTX-018、TC-UI-CTX-020、TC-UI-CTX-021 |

## 类别分布与豁免

以下统计直接由本分片 JSON 聚合，仅代表设计分布；正式全项目 `check-cases --json` 统计由主会话在内存隔离的只读校验中核对，不运行会写合并文件的原生 validator。

| 类别 | 数量 |
|---|---:|
| positive | 9 |
| exception | 6 |
| boundary | 3 |
| state | 2 |
| negative | 1 |

合计 21 条；7 个 Feature、16 条 AC、12 个 C-FE 代码点。100 条上限包含 99/100/101 参数化边界和独立 120 条场景。所有数量只表示设计覆盖，运行通过数量为 0，未执行数量为 21。

| Feature | 豁免类别 | 原因 |
|---|---|---|
| F-CTX-01 | exception | 本 Feature 只约束仓库静态 manifest 声明、入口文件存在性与 MV3 格式，不包含运行时外部资源交互。破坏 manifest 后 Chromium 会拒绝加载，无法在原真实插件上形成 UI 异常用例；不改生产文件或制造临时假插件。实际启动及后端不可达异常由 F-CTX-02 的真实 SW/popup 用例覆盖。 |

执行风险：启动异常证据必须来自重载后实际 worker 的完整监听窗口，不能用最终 worker 存在或 console.error=0 代替；历史排序必须真实读回不同的 lastVisitTime；系统页卡片用例必须确认零 http(s) 候选；跨窗口用例必须在同一 context 创建两个真实 windowId。三十天查询仅断言契约暴露的实际 startTime/maxResults，不通过注入假历史去声称已验证旧浏览器记录的过滤。
