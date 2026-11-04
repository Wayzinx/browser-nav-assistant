# INCR 插件 UI 测试用例

范围：仅 F-INCR-01 的 UI 设计，覆盖3条AC和2个专属前端代码点；另引用历史采集 C-FE-CTX-03。

本轮交付用例设计，未运行浏览器或产品测试；下述步骤供后续逐 Case ID 转成 Playwright 脚本。源码待实现不改变冻结预期。本分片不修改汇总产物、源码、规范或其他模块。

## 配方与审查口径

- 一例一脚本，独立 reset 与扩展 context；外站 route 离线化，后端真实HTTP，popup 以 tab 打开。
- UI 真实同步请求必须单独只读观察并 recordApi；api.seed 的请求不能充当 UI 上报证据。
- uploaded 是 activeTab(0/1)+openTabs+history 去重前条数；filtered 只计敏感词/无痕，系统页只跳过。
- 游标为上次成功批的客户端 startedAt；5分钟重叠允许重传。GET_CONTEXT 的 context-history-query 不是同步窗口。同步窗口从点击至实际POST前、独立于初始/刷新请求的 history.query 日志取证。
- 旧页面只经后端导入，addUrl 不支持回填时间/次数。边界用例明确记录实际时间或构造已登记的游标持久态，不引入未登记 now/delay 接口。
- refs 表示正向或对应反向/异常场景的AC目标；覆盖表中的主证明列只列实际完整证明该AC的正向/恢复场景，避免把反例挂接等同于正例证明。

## TC-UI-INCR-001 同一非空后端连续同步：保留5分钟重叠历史并上传两个普通窗口的全部标签

- 优先级：P1；类别：positive；设计技术：scenario
- Feature：F-INCR-01
- AC：F-INCR-01#AC1、F-INCR-01#AC2、F-INCR-01#AC3
- Code：C-FE-INCR-01、C-FE-CTX-03

前置条件：

- 每条用例独立从 tests/fixtures/extension.mjs 导入 test/expect，加载 MV3 插件到独立 Chromium persistent context（channel=chromium）；api 夹具自动 POST /api/__test__/reset，ext.setApiBase 指向 TEST_PORT 的真实后端。脚本结束由夹具关闭 context；不依赖其他用例。
- 清理 chrome.history.deleteAll 和扩展 storage 中的 syncState、cache、connection；保留 apiBaseUrl，关闭无关标签页。外站只由 ext.mockSites/context.route 离线化，不 route、mock 或替换 localhost/127.0.0.1、后端 /api、浏览器 API、业务模块或 DOM。popup 以 chrome-extension://<extensionId>/popup/popup.html 的 tab 打开；元素只用 ui-contract 登记的 getByTestId。
- 点击前注册 BrowserContext request/response/requestfailed 的只读观察，按目标后端 origin、method=POST、path=/api/sync 筛选 SW 请求；不对 SW 请求调用 frame()。记录真实 postDataJSON、响应 status/body 和失败原因至 evidence.recordApi，等待异步取证任务完成后移除监听。setup 的 api.seed/loadSample 不计入 UI 同步请求数；server.log 仅用于访问计数，不能代替请求体证据。
- 初次打开 popup 后等首页初始网络请求结束；connection 无 recoverPending、syncState 无网络失败恢复标记，确认无自发 POST /api/sync 后才开始本次点击计数。浏览器当前历史只能通过 chrome.history.addUrl（ext.seedHistory）和真实离线页面导航构造，不能伪造 lastVisitTime/visitCount；旧页面只经真实 POST /api/sync 导入。

测试数据：A=https://github.com/org/repo/pull/456；B=https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API；C=https://example.com/other。第一次成功后读取真实 cursor=T；整个两批期间不 reset/重启后端、不改 apiBaseUrl。T−5分钟内的 A/B 必须在第二批重叠上传，不能误判为只上传新 C。

步骤：

- S1：通过 ext.mockSites 离线登记 A/B；依次 ext.openTabs([A,B])，B 最后活动，ext.seedHistory([A,B]) 用 chrome.history.addUrl 写当前访问；等待 chrome.history.search 确认 http(s) URL 集合恰为 {A,B}。打开 popup 后当前页面按契约排除插件自身，回退到 B。
- S2：打开 popup 点击 sync-button 并等待第一批完成；保存其真实请求和 syncState.cursor=T、startedAt。调用 GET /api/health 记录同一 backend.startedAt、pageCount>0；保留 A/B 标签。
- S3：用 chrome.windows.create({type:"normal",url:C}) 在同一 context 创建第二个普通窗口；仅对 C 外站 route 离线化，ext.seedHistory([C]) 写当前历史并等待 chrome.tabs.query 确认两个普通窗口的 A/B/C 都存在。两批间隔控制在1分钟以内，保留同一 popup，点击 sync-button 再同步一次。
- S4：保存第二批真实请求与 history.query 日志参数，读取新 syncState、真实 GET /api/health；截图。最后关闭本例新增窗口，夹具关闭 context。

预期：

- E1：第一批真实请求 mode="full" 且不含 cursor；第一批成功 storage.syncState.cursor=lastSuccessAt=该批 startedAt=T。
- E2：第二批真实请求 mode="incremental"、cursor=T；该批采集的 history.query.startTime=T−300000、maxResults=100。
- E3：第二批 history URL 集合恰为 {A,B,C}，每项 lastVisitTime>=T−300000；旧 A/B 在5分钟重叠内仍被上传，而非只有新增 C。
- E4：第二批 openTabs URL 集合恰为 {A,B,C}，跨两个普通窗口完整上传；不包含 popup 的 chrome-extension:// URL。
- E5：两批各只有1次真实 POST 且 HTTP 200；最终 GET /api/health.pageCount=3，新 storage.syncState.cursor=lastSuccessAt=第二批 startedAt 且大于T。

证据：

- evidence/TC-UI-INCR-001/api/：真实 setup/health/readback，以及单独记录的 SW POST /api/sync 请求、响应或 requestfailed；请求次数只统计步骤内的被测区间。
- evidence/TC-UI-INCR-001/：result.json 对应各 [En]；screenshots/ 保存关键 UI，flow.gif、server.log、extension.log 由夹具留存；evidence.note 保存本例 storage、时间及网络观察快照。explore.json 由后续 UI 探索阶段生成，本轮不伪造执行结果。

## TC-UI-INCR-002 已有有效游标时点全量同步：忽略游标并按30天窗口重新采集

- 优先级：P1；类别：positive；设计技术：state-transition
- Feature：F-INCR-01
- AC：F-INCR-01#AC2
- Code：C-FE-INCR-01、C-FE-INCR-02、C-FE-CTX-03

前置条件：

- 每条用例独立从 tests/fixtures/extension.mjs 导入 test/expect，加载 MV3 插件到独立 Chromium persistent context（channel=chromium）；api 夹具自动 POST /api/__test__/reset，ext.setApiBase 指向 TEST_PORT 的真实后端。脚本结束由夹具关闭 context；不依赖其他用例。
- 清理 chrome.history.deleteAll 和扩展 storage 中的 syncState、cache、connection；保留 apiBaseUrl，关闭无关标签页。外站只由 ext.mockSites/context.route 离线化，不 route、mock 或替换 localhost/127.0.0.1、后端 /api、浏览器 API、业务模块或 DOM。popup 以 chrome-extension://<extensionId>/popup/popup.html 的 tab 打开；元素只用 ui-contract 登记的 getByTestId。
- 点击前注册 BrowserContext request/response/requestfailed 的只读观察，按目标后端 origin、method=POST、path=/api/sync 筛选 SW 请求；不对 SW 请求调用 frame()。记录真实 postDataJSON、响应 status/body 和失败原因至 evidence.recordApi，等待异步取证任务完成后移除监听。setup 的 api.seed/loadSample 不计入 UI 同步请求数；server.log 仅用于访问计数，不能代替请求体证据。
- 初次打开 popup 后等首页初始网络请求结束；connection 无 recoverPending、syncState 无网络失败恢复标记，确认无自发 POST /api/sync 后才开始本次点击计数。浏览器当前历史只能通过 chrome.history.addUrl（ext.seedHistory）和真实离线页面导航构造，不能伪造 lastVisitTime/visitCount；旧页面只经真实 POST /api/sync 导入。

测试数据：A=https://github.com/org/repo/pull/456；B=https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API；第一次正常同步建立有效游标T；最近30天默认 historyLookbackDays=30、maxHistoryItems=100。只用 addUrl 当前记录，30天范围由同步采集的实际 history.query 参数证明，不能从后端旧页推导浏览器历史。

步骤：

- S1：通过 ext.mockSites 离线登记 A/B；依次 ext.openTabs([A,B])，B 最后活动，ext.seedHistory([A,B]) 用 chrome.history.addUrl 写当前访问；等待 chrome.history.search 确认 http(s) URL 集合恰为 {A,B}。打开 popup 后当前页面按契约排除插件自身，回退到 B。
- S2：打开 popup，先点击 sync-button 并等本例首次成功，保存 cursor=T；GET /api/health 确认非空、同一实例。等首页/同步刷新结束，不切换上下文页；开始新网络与 extension.log 观察区间。
- S3：记录点击前时间 t0，点击 sync-full-button，记录本批 syncState.startedAt 与实际 POST 发送前时间 t1；只收集该次点击至该次 POST 之间的采集 history.query 事件，排除初始 GET_CONTEXT 和成功后的推荐刷新。保存真实 POST；等成功后读取 syncState 与两个按钮状态。

预期：

- E1：手动全量这批实际 POST.mode="full" 且 cursor 字段不存在，即使点击前 storage.syncState.cursor=T 且后端实例有效。
- E2：该批同步采集 history.query.maxResults=100，startTime 在 [t0−2592000000,t1−2592000000] 内；不使用 context-history-query 的固定上下文窗口冒充此证据。
- E3：该批 history URL 集合恰为 {A,B}，两条 lastVisitTime 均在该次真实30天窗口内；HTTP status=200。
- E4：sync-status.data-status="success"，storage.syncState.mode="full"、cursor=本批 startedAt，sync-button 和 sync-full-button 都恢复 enabled。

证据：

- evidence/TC-UI-INCR-002/api/：真实 setup/health/readback，以及单独记录的 SW POST /api/sync 请求、响应或 requestfailed；请求次数只统计步骤内的被测区间。
- evidence/TC-UI-INCR-002/：result.json 对应各 [En]；screenshots/ 保存关键 UI，flow.gif、server.log、extension.log 由夹具留存；evidence.note 保存本例 storage、时间及网络观察快照。explore.json 由后续 UI 探索阶段生成，本轮不伪造执行结果。

## TC-UI-INCR-003 首次全量有101条浏览器历史：只上传最新100条并省略cursor

- 优先级：P2；类别：boundary；设计技术：boundary
- Feature：F-INCR-01
- AC：F-INCR-01#AC2
- Code：C-FE-INCR-01、C-FE-CTX-03

前置条件：

- 每条用例独立从 tests/fixtures/extension.mjs 导入 test/expect，加载 MV3 插件到独立 Chromium persistent context（channel=chromium）；api 夹具自动 POST /api/__test__/reset，ext.setApiBase 指向 TEST_PORT 的真实后端。脚本结束由夹具关闭 context；不依赖其他用例。
- 清理 chrome.history.deleteAll 和扩展 storage 中的 syncState、cache、connection；保留 apiBaseUrl，关闭无关标签页。外站只由 ext.mockSites/context.route 离线化，不 route、mock 或替换 localhost/127.0.0.1、后端 /api、浏览器 API、业务模块或 DOM。popup 以 chrome-extension://<extensionId>/popup/popup.html 的 tab 打开；元素只用 ui-contract 登记的 getByTestId。
- 点击前注册 BrowserContext request/response/requestfailed 的只读观察，按目标后端 origin、method=POST、path=/api/sync 筛选 SW 请求；不对 SW 请求调用 frame()。记录真实 postDataJSON、响应 status/body 和失败原因至 evidence.recordApi，等待异步取证任务完成后移除监听。setup 的 api.seed/loadSample 不计入 UI 同步请求数；server.log 仅用于访问计数，不能代替请求体证据。
- 初次打开 popup 后等首页初始网络请求结束；connection 无 recoverPending、syncState 无网络失败恢复标记，确认无自发 POST /api/sync 后才开始本次点击计数。浏览器当前历史只能通过 chrome.history.addUrl（ext.seedHistory）和真实离线页面导航构造，不能伪造 lastVisitTime/visitCount；旧页面只经真实 POST /api/sync 导入。

测试数据：https://example.com/h/001 到 /101 共101个URL，只用 chrome.history.addUrl 当前访问构造；逐次确认 lastVisitTime 严格递增（必要时等待下一毫秒再 add下一条），防止同毫秒排序不确定。无 http(s) tab，当前页是系统页，activeTab=null、openTabs=[]。默认 config.maxHistoryItems=100。

步骤：

- S1：只保留系统页面；清空浏览历史后逐条用 chrome.history.addUrl 写 /001..101，读取实际 history.search({text:"",startTime:0,maxResults:500}) 确认共101条且 lastVisitTime 按构造顺序严格递增；不导入任何后端旧页冒充历史。
- S2：打开 popup 等初始请求结束，开始被测日志/网络观察；记录 t0，点击 sync-button，记录真实 POST 前 t1 与本批采集 history.query 参数；等待同步成功。
- S3：读取实际 POST.history、storage.syncState、sync-uploaded-count、真实 GET /api/health，保留所有URL和实际时间清单。

预期：

- E1：首次实际 POST.mode="full" 且不含 cursor，activeTab=null、openTabs=[]。
- E2：本批同步采集 history.query.maxResults=100，startTime 在 [t0−2592000000,t1−2592000000] 内。
- E3：实际 POST.history.length=100，URL 集合恰为 /002..101，不包含最旧 /001；每条 lastVisitTime 都来自真实浏览器记录且在30天范围内。
- E4：HTTP 200、received=100、created=100、pageCount=100；GET /api/health.pageCount=100，sync-uploaded-count="100"。

证据：

- evidence/TC-UI-INCR-003/api/：真实 setup/health/readback，以及单独记录的 SW POST /api/sync 请求、响应或 requestfailed；请求次数只统计步骤内的被测区间。
- evidence/TC-UI-INCR-003/：result.json 对应各 [En]；screenshots/ 保存关键 UI，flow.gif、server.log、extension.log 由夹具留存；evidence.note 保存本例 storage、时间及网络观察快照。explore.json 由后续 UI 探索阶段生成，本轮不伪造执行结果。

## TC-UI-INCR-004 以真实历史时间夹住增量窗口：5分钟前后1分钟分别纳入和排除同一记录

- 优先级：P2；类别：boundary；设计技术：boundary
- Feature：F-INCR-01
- AC：F-INCR-01#AC1
- Code：C-FE-INCR-01、C-FE-CTX-03

前置条件：

- 每条用例独立从 tests/fixtures/extension.mjs 导入 test/expect，加载 MV3 插件到独立 Chromium persistent context（channel=chromium）；api 夹具自动 POST /api/__test__/reset，ext.setApiBase 指向 TEST_PORT 的真实后端。脚本结束由夹具关闭 context；不依赖其他用例。
- 清理 chrome.history.deleteAll 和扩展 storage 中的 syncState、cache、connection；保留 apiBaseUrl，关闭无关标签页。外站只由 ext.mockSites/context.route 离线化，不 route、mock 或替换 localhost/127.0.0.1、后端 /api、浏览器 API、业务模块或 DOM。popup 以 chrome-extension://<extensionId>/popup/popup.html 的 tab 打开；元素只用 ui-contract 登记的 getByTestId。
- 点击前注册 BrowserContext request/response/requestfailed 的只读观察，按目标后端 origin、method=POST、path=/api/sync 筛选 SW 请求；不对 SW 请求调用 frame()。记录真实 postDataJSON、响应 status/body 和失败原因至 evidence.recordApi，等待异步取证任务完成后移除监听。setup 的 api.seed/loadSample 不计入 UI 同步请求数；server.log 仅用于访问计数，不能代替请求体证据。
- 初次打开 popup 后等首页初始网络请求结束；connection 无 recoverPending、syncState 无网络失败恢复标记，确认无自发 POST /api/sync 后才开始本次点击计数。浏览器当前历史只能通过 chrome.history.addUrl（ext.seedHistory）和真实离线页面导航构造，不能伪造 lastVisitTime/visitCount；旧页面只经真实 POST /api/sync 导入。
- 这是游标输入边界的持久态夹具；允许写已登记的 syncState，但不伪造历史访问时间、不 mock Date/history。自然产生的成功游标链路由本模块正例独立验证。两个分支之间不 reset 后端。

测试数据：M=https://example.com/window-marker，经 addUrl 得到真实 lastVisitTime=H；后端先以 api.seed 导入一个 sentinel=https://example.com/server-sentinel（activeTab=null、openTabs=[]、history=[{url:sentinel,lastVisitTime:Date.now(),visitCount:1}]）保持非空。从真实 health 读取 base={apiBaseUrl,serverStartedAt:health.startedAt}。分支A设T_in=H+240000，则窗口起点H−60000；分支B设T_out=H+360000，则窗口起点H+60000。未来游标是显式测试输入，不声称是真实成功时间；契约未禁止此输入。不造30天前浏览器记录、不添加未登记now参数。

步骤：

- S1：按 testData 通过真实 POST 导入 sentinel；只保留系统页，ext.seedHistory([M]) 并用真实 history.search 读取 H，确保 http(s) 历史只有 M；打开 popup，完成初始请求。
- S2：保留同一 base 和 backend，在 storage.syncState 写完整 success 状态（lastError=null、cursor=T_in、lastSuccessAt=T_in、cursorBase=base），connection 无恢复标记；点击 sync-button，记录该批实际窗口和 POST 后等成功。
- S3：重新只修改同一状态的 cursor/lastSuccessAt 为 T_out（保留真实 base），不访问 M、不增加历史、不 reset；点击 sync-button，记录第二分支真实窗口和 POST；检查两分支服务端结果。

预期：

- E1：分支A实际 POST.mode="incremental"、cursor=T_in；本次同步 history.query.startTime=T_in−300000=H−60000，history URL 集合恰为 {M}。
- E2：分支B实际 POST.mode="incremental"、cursor=T_out；本次同步 history.query.startTime=T_out−300000=H+60000，history=[]。
- E3：两分支都没有 http(s) tab，实际 openTabs=[]、activeTab=null；sentinel 只存在后端，两个请求的 history 都不含 sentinel。
- E4：分支A HTTP 200、created=1、pageCount=2；分支B HTTP 200、received=0、created=0、pageCount=2，最终 GET /api/health.pageCount=2。

证据：

- evidence/TC-UI-INCR-004/api/：真实 setup/health/readback，以及单独记录的 SW POST /api/sync 请求、响应或 requestfailed；请求次数只统计步骤内的被测区间。
- evidence/TC-UI-INCR-004/：result.json 对应各 [En]；screenshots/ 保存关键 UI，flow.gif、server.log、extension.log 由夹具留存；evidence.note 保存本例 storage、时间及网络观察快照。explore.json 由后续 UI 探索阶段生成，本轮不伪造执行结果。

## TC-UI-INCR-005 增量时真实后端不可达：不推进游标，恢复后按原游标补传

- 优先级：P1；类别：exception；设计技术：state-transition
- Feature：F-INCR-01
- AC：F-INCR-01#AC1、F-INCR-01#AC3
- Code：C-FE-INCR-01

前置条件：

- 每条用例独立从 tests/fixtures/extension.mjs 导入 test/expect，加载 MV3 插件到独立 Chromium persistent context（channel=chromium）；api 夹具自动 POST /api/__test__/reset，ext.setApiBase 指向 TEST_PORT 的真实后端。脚本结束由夹具关闭 context；不依赖其他用例。
- 清理 chrome.history.deleteAll 和扩展 storage 中的 syncState、cache、connection；保留 apiBaseUrl，关闭无关标签页。外站只由 ext.mockSites/context.route 离线化，不 route、mock 或替换 localhost/127.0.0.1、后端 /api、浏览器 API、业务模块或 DOM。popup 以 chrome-extension://<extensionId>/popup/popup.html 的 tab 打开；元素只用 ui-contract 登记的 getByTestId。
- 点击前注册 BrowserContext request/response/requestfailed 的只读观察，按目标后端 origin、method=POST、path=/api/sync 筛选 SW 请求；不对 SW 请求调用 frame()。记录真实 postDataJSON、响应 status/body 和失败原因至 evidence.recordApi，等待异步取证任务完成后移除监听。setup 的 api.seed/loadSample 不计入 UI 同步请求数；server.log 仅用于访问计数，不能代替请求体证据。
- 初次打开 popup 后等首页初始网络请求结束；connection 无 recoverPending、syncState 无网络失败恢复标记，确认无自发 POST /api/sync 后才开始本次点击计数。浏览器当前历史只能通过 chrome.history.addUrl（ext.seedHistory）和真实离线页面导航构造，不能伪造 lastVisitTime/visitCount；旧页面只经真实 POST /api/sync 导入。

测试数据：浏览器先只有 A=https://github.com/org/repo/pull/456，实际成功同步建立 T 与 cursorBase=base0；失败前新增 B=https://example.com/retry，保留 A/B 打开。同一后端不重启/reset，失败只把 apiBaseUrl 通过夹具原始storage写为 http://127.0.0.1:9；不用 SET_API_BASE_URL（该业务消息会主动 resetCursor）。恢复写回原始URL。

步骤：

- S1：外站离线登记 A/B，只打开 A 并 addUrl A；打开 popup 点击 sync-button，等真实成功后记录 cursor=T、lastSuccessAt 和 cursorBase=base0；当前后端非空。
- S2：打开 B 并 addUrl B，保持已有 popup 打开；ext.useUnreachableBackend() 后点击 sync-button；等待失败并读取 storage、sync-status、sync-error-message，保留真实 requestfailed，确认原后端页面仍只有A。
- S3：用 ext.setApiBase 写回原URL；重新打开 popup，由已冻结的 RECOVER_IF_NEEDED 在线恢复路径自然补传，不额外点击和该恢复竞争。只读观察这一次恢复的 POST，等待 success，读取新游标和真实 ranked/health。

预期：

- E1：失败时 sync-status.data-status="error" 且包含「同步失败」，storage.syncState.lastError.code="BACKEND_UNREACHABLE"、message 非空。
- E2：失败后 storage.syncState.cursor=T、lastSuccessAt=失败前值、cursorBase 深度等于base0，原后端 GET /api/health.pageCount=1。
- E3：恢复产生1次实际 POST，mode="incremental"、cursor=T；history URL 集合包含 A/B，所有 lastVisitTime>=T−300000，openTabs URL 集合恰为 {A,B}。
- E4：恢复 POST 为 HTTP 200；最终 ranked URL 集合恰为 {A,B}、health.pageCount=2，storage.syncState.cursor=lastSuccessAt=恢复批 startedAt且大于T，sync-status.data-status="success"。

证据：

- evidence/TC-UI-INCR-005/api/：真实 setup/health/readback，以及单独记录的 SW POST /api/sync 请求、响应或 requestfailed；请求次数只统计步骤内的被测区间。
- evidence/TC-UI-INCR-005/：result.json 对应各 [En]；screenshots/ 保存关键 UI，flow.gif、server.log、extension.log 由夹具留存；evidence.note 保存本例 storage、时间及网络观察快照。explore.json 由后续 UI 探索阶段生成，本轮不伪造执行结果。

## TC-UI-INCR-006 游标绑定地址与当前地址不匹配：拒用旧游标并自动改为全量

- 优先级：P2；类别：negative；设计技术：decision-table
- Feature：F-INCR-01
- AC：F-INCR-01#AC2
- Code：C-FE-INCR-01

前置条件：

- 每条用例独立从 tests/fixtures/extension.mjs 导入 test/expect，加载 MV3 插件到独立 Chromium persistent context（channel=chromium）；api 夹具自动 POST /api/__test__/reset，ext.setApiBase 指向 TEST_PORT 的真实后端。脚本结束由夹具关闭 context；不依赖其他用例。
- 清理 chrome.history.deleteAll 和扩展 storage 中的 syncState、cache、connection；保留 apiBaseUrl，关闭无关标签页。外站只由 ext.mockSites/context.route 离线化，不 route、mock 或替换 localhost/127.0.0.1、后端 /api、浏览器 API、业务模块或 DOM。popup 以 chrome-extension://<extensionId>/popup/popup.html 的 tab 打开；元素只用 ui-contract 登记的 getByTestId。
- 点击前注册 BrowserContext request/response/requestfailed 的只读观察，按目标后端 origin、method=POST、path=/api/sync 筛选 SW 请求；不对 SW 请求调用 frame()。记录真实 postDataJSON、响应 status/body 和失败原因至 evidence.recordApi，等待异步取证任务完成后移除监听。setup 的 api.seed/loadSample 不计入 UI 同步请求数；server.log 仅用于访问计数，不能代替请求体证据。
- 初次打开 popup 后等首页初始网络请求结束；connection 无 recoverPending、syncState 无网络失败恢复标记，确认无自发 POST /api/sync 后才开始本次点击计数。浏览器当前历史只能通过 chrome.history.addUrl（ext.seedHistory）和真实离线页面导航构造，不能伪造 lastVisitTime/visitCount；旧页面只经真实 POST /api/sync 导入。

测试数据：A=https://github.com/org/repo/pull/456；B=https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API；本例先自然建立有效游标T，再仅把已登记的 syncState.cursorBase.apiBaseUrl 写为 http://127.0.0.1:4197（不向该端口发请求），实际 apiBaseUrl 仍为真实测试后端；其余服务器身份与页面均不变。测试旧游标绑定失效，不能靠后端空库触发另一条分支。

步骤：

- S1：通过 ext.mockSites 离线登记 A/B；依次 ext.openTabs([A,B])，B 最后活动，ext.seedHistory([A,B]) 用 chrome.history.addUrl 写当前访问；等待 chrome.history.search 确认 http(s) URL 集合恰为 {A,B}。打开 popup 后当前页面按契约排除插件自身，回退到 B。
- S2：打开 popup 点击 sync-button 并等本例自然成功；GET /api/health 确认 pageCount=2、lastSyncAt 非 null；仅修改 syncState.cursorBase.apiBaseUrl，保留cursor=T、lastError=null 和无恢复标记。
- S3：在仍打开的 popup 点 sync-button；记录本批真实 POST 与采集窗口、状态 fullReason；随后真实 GET /api/health。

预期：

- E1：本批实际 POST.mode="full" 且 cursor 字段不存在，不能沿用不匹配的T。
- E2：storage.syncState.fullReason="api_base_changed"、mode="full"，该批历史采集 startTime 约为点击时间−2592000000（处于点击前/POST前时间区间计算的上下界内），maxResults=100。
- E3：本批 history URL 集合恰为 {A,B}，HTTP 200、created=0、pageCount=2；GET /api/health.pageCount=2，没有因失效绑定重复建页或删除旧页。
- E4：storage.syncState.cursorBase.apiBaseUrl 回写为本例真实 apiBaseUrl，cursor=本批 startedAt，sync-status.data-status="success"。

证据：

- evidence/TC-UI-INCR-006/api/：真实 setup/health/readback，以及单独记录的 SW POST /api/sync 请求、响应或 requestfailed；请求次数只统计步骤内的被测区间。
- evidence/TC-UI-INCR-006/：result.json 对应各 [En]；screenshots/ 保存关键 UI，flow.gif、server.log、extension.log 由夹具留存；evidence.note 保存本例 storage、时间及网络观察快照。explore.json 由后续 UI 探索阶段生成，本轮不伪造执行结果。

## TC-UI-INCR-007 后端真实reset但本地仍有游标：server_empty触发全量恢复

- 优先级：P1；类别：exception；设计技术：state-transition
- Feature：F-INCR-01
- AC：F-INCR-01#AC2
- Code：C-FE-INCR-01

前置条件：

- 每条用例独立从 tests/fixtures/extension.mjs 导入 test/expect，加载 MV3 插件到独立 Chromium persistent context（channel=chromium）；api 夹具自动 POST /api/__test__/reset，ext.setApiBase 指向 TEST_PORT 的真实后端。脚本结束由夹具关闭 context；不依赖其他用例。
- 清理 chrome.history.deleteAll 和扩展 storage 中的 syncState、cache、connection；保留 apiBaseUrl，关闭无关标签页。外站只由 ext.mockSites/context.route 离线化，不 route、mock 或替换 localhost/127.0.0.1、后端 /api、浏览器 API、业务模块或 DOM。popup 以 chrome-extension://<extensionId>/popup/popup.html 的 tab 打开；元素只用 ui-contract 登记的 getByTestId。
- 点击前注册 BrowserContext request/response/requestfailed 的只读观察，按目标后端 origin、method=POST、path=/api/sync 筛选 SW 请求；不对 SW 请求调用 frame()。记录真实 postDataJSON、响应 status/body 和失败原因至 evidence.recordApi，等待异步取证任务完成后移除监听。setup 的 api.seed/loadSample 不计入 UI 同步请求数；server.log 仅用于访问计数，不能代替请求体证据。
- 初次打开 popup 后等首页初始网络请求结束；connection 无 recoverPending、syncState 无网络失败恢复标记，确认无自发 POST /api/sync 后才开始本次点击计数。浏览器当前历史只能通过 chrome.history.addUrl（ext.seedHistory）和真实离线页面导航构造，不能伪造 lastVisitTime/visitCount；旧页面只经真实 POST /api/sync 导入。

测试数据：A=https://github.com/org/repo/pull/456；B=https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API；本例先成功同步并持有真实游标T，随后只通过真实 POST /api/__test__/reset 清空后端；保留扩展syncState、API地址、普通标签和浏览器历史。reset 是本例步骤，不是跨用例依赖。

步骤：

- S1：通过 ext.mockSites 离线登记 A/B；依次 ext.openTabs([A,B])，B 最后活动，ext.seedHistory([A,B]) 用 chrome.history.addUrl 写当前访问；等待 chrome.history.search 确认 http(s) URL 集合恰为 {A,B}。打开 popup 后当前页面按契约排除插件自身，回退到 B。
- S2：打开 popup 点 sync-button 并等成功，记录本例 cursor=T、cursorBase；等待所有刷新结束，再 api.reset()。GET /api/health 确认 pageCount=0、lastSyncAt=null，storage.syncState.cursor 仍为T。
- S3：在同一 popup 点击 sync-button，记录实际 POST、历史窗口、syncState.fullReason 和成功状态；最后分别调用 GET /api/health 与 GET /api/pages/ranked 两个真实接口核对恢复。

预期：

- E1：reset 后本地 cursor=T，但实际恢复 POST.mode="full" 且 cursor 字段省略；storage.syncState.fullReason="server_empty"。
- E2：恢复批同步采集 history.query.maxResults=100，startTime 处于该批点击前/POST前时间减2592000000的区间内；请求 history URL 集合恰为 {A,B}。
- E3：恢复实际 POST 返回 HTTP 200、created=2、pageCount=2；真实 GET /api/pages/ranked URL 集合恰为 {A,B}、GET /api/health.pageCount=2。
- E4：sync-status.data-status="success"，storage.syncState.cursor=恢复批 startedAt，不能仍保留失效旧游标T。

证据：

- evidence/TC-UI-INCR-007/api/：真实 setup/health/readback，以及单独记录的 SW POST /api/sync 请求、响应或 requestfailed；请求次数只统计步骤内的被测区间。
- evidence/TC-UI-INCR-007/：result.json 对应各 [En]；screenshots/ 保存关键 UI，flow.gif、server.log、extension.log 由夹具留存；evidence.note 保存本例 storage、时间及网络观察快照。explore.json 由后续 UI 探索阶段生成，本轮不伪造执行结果。

## Feature → Case 覆盖表

| Feature | AC | acceptanceRefs关联用例 | 实际主证明 |
|---|---|---|---|
| F-INCR-01 | F-INCR-01#AC1 | TC-UI-INCR-001、TC-UI-INCR-004、TC-UI-INCR-005 | TC-UI-INCR-001、TC-UI-INCR-004、TC-UI-INCR-005 |
| F-INCR-01 | F-INCR-01#AC2 | TC-UI-INCR-001、TC-UI-INCR-002、TC-UI-INCR-003、TC-UI-INCR-006、TC-UI-INCR-007 | TC-UI-INCR-001、TC-UI-INCR-002、TC-UI-INCR-003、TC-UI-INCR-006、TC-UI-INCR-007 |
| F-INCR-01 | F-INCR-01#AC3 | TC-UI-INCR-001、TC-UI-INCR-005 | TC-UI-INCR-001、TC-UI-INCR-005 |

| Feature | 类别分布 | 缺口 | waiver |
|---|---|---|---|
| F-INCR-01 | positive=2，boundary=2，exception=2，negative=1 | 0 | 无 |

## 类别分布统计

统计来源：以原始 Feature 注册表中的本模块 inScope FE Feature 和本 JSON 分片构造临时 root，调用 nav-test-case-design/scripts/check-cases.mjs 导出的 checkCases({root})，取 stats.byCategory，不手算、不改检查器。此隔离统计中的全局 E2E 数量提示不属于本 UI 任务；完整模块结果以两条指定 validator 为准。

| 类别 | 数量 |
|---|---:|
| positive | 2 |
| boundary | 2 |
| exception | 2 |
| negative | 1 |

用例共 7 条；AC 覆盖 3/3；类别缺口 0；waiver 0。

openQuestions：无。产品未实现与其他模块/类型缺口不通过修改契约、编造执行证据或豁免规避。
