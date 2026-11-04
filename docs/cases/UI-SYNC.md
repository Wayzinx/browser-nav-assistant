# SYNC 插件 UI 测试用例

范围：仅 F-SYNC-01 与 F-SYNC-06 的 UI 设计，覆盖8条AC和5个专属前端代码点。BE-only Feature/API 用例由其他分片负责。

本轮交付用例设计，未运行浏览器或产品测试；下述步骤供后续逐 Case ID 转成 Playwright 脚本。源码待实现不改变冻结预期。本分片不修改汇总产物、源码、规范或其他模块。

## 配方与审查口径

- 一例一脚本，独立 reset 与扩展 context；外站 route 离线化，后端真实HTTP，popup 以 tab 打开。
- UI 真实同步请求必须单独只读观察并 recordApi；api.seed 的请求不能充当 UI 上报证据。
- uploaded 是 activeTab(0/1)+openTabs+history 去重前条数；filtered 只计敏感词/无痕，系统页只跳过。
- 游标为上次成功批的客户端 startedAt；5分钟重叠允许重传。GET_CONTEXT 的 context-history-query 不是同步窗口。同步窗口从点击至实际POST前、独立于初始/刷新请求的 history.query 日志取证。
- 旧页面只经后端导入，addUrl 不支持回填时间/次数。边界用例明确记录实际时间或构造已登记的游标持久态，不引入未登记 now/delay 接口。
- refs 表示正向或对应反向/异常场景的AC目标；覆盖表中的主证明列只列实际完整证明该AC的正向/恢复场景，避免把反例挂接等同于正例证明。

## TC-UI-SYNC-001 两条普通页面首次同步：真实上报三个上下文字段并展示上传5条、过滤0条

- 优先级：P0；类别：positive；设计技术：scenario
- Feature：F-SYNC-01、F-SYNC-06
- AC：F-SYNC-01#AC1、F-SYNC-06#AC1
- Code：C-FE-SYNC-01、C-FE-SYNC-02、C-FE-SYNC-03、C-FE-SYNC-04、C-FE-SYNC-05

前置条件：

- 每条用例独立从 tests/fixtures/extension.mjs 导入 test/expect，加载 MV3 插件到独立 Chromium persistent context（channel=chromium）；api 夹具自动 POST /api/__test__/reset，ext.setApiBase 指向 TEST_PORT 的真实后端。脚本结束由夹具关闭 context；不依赖其他用例。
- 清理 chrome.history.deleteAll 和扩展 storage 中的 syncState、cache、connection；保留 apiBaseUrl，关闭无关标签页。外站只由 ext.mockSites/context.route 离线化，不 route、mock 或替换 localhost/127.0.0.1、后端 /api、浏览器 API、业务模块或 DOM。popup 以 chrome-extension://<extensionId>/popup/popup.html 的 tab 打开；元素只用 ui-contract 登记的 getByTestId。
- 点击前注册 BrowserContext request/response/requestfailed 的只读观察，按目标后端 origin、method=POST、path=/api/sync 筛选 SW 请求；不对 SW 请求调用 frame()。记录真实 postDataJSON、响应 status/body 和失败原因至 evidence.recordApi，等待异步取证任务完成后移除监听。setup 的 api.seed/loadSample 不计入 UI 同步请求数；server.log 仅用于访问计数，不能代替请求体证据。
- 初次打开 popup 后等首页初始网络请求结束；connection 无 recoverPending、syncState 无网络失败恢复标记，确认无自发 POST /api/sync 后才开始本次点击计数。浏览器当前历史只能通过 chrome.history.addUrl（ext.seedHistory）和真实离线页面导航构造，不能伪造 lastVisitTime/visitCount；旧页面只经真实 POST /api/sync 导入。

测试数据：A=https://github.com/org/repo/pull/456；B=https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API。只有两个普通页面和两个不同 URL 的浏览器历史，activeTab=B；uploaded=1+2+2=5（去重前），filtered=0；不使用 resource.json 的14条接口统计代替浏览器采集。

步骤：

- S1：通过 ext.mockSites 离线登记 A/B；依次 ext.openTabs([A,B])，B 最后活动，ext.seedHistory([A,B]) 用 chrome.history.addUrl 写当前访问；等待 chrome.history.search 确认 http(s) URL 集合恰为 {A,B}。打开 popup 后当前页面按契约排除插件自身，回退到 B。
- S2：在只读网络观察已启用后 ext.openPopup()；记录 sync-status 初始状态，点击 sync-button 一次，等待本次真实 POST 和同步完成；等该批缓存刷新请求结束。
- S3：调用真实 GET /api/pages/ranked 和 GET /api/health；通过 ext.getStorage 读取 syncState/cache，读取 sync-status、sync-uploaded-count、sync-filtered-count、sync-status-time，ext.snap 截图。

预期：

- E1：被测区间只有 1 次 POST /api/sync；真实请求 activeTab.url=B，openTabs URL 集合恰为 {A,B}，history URL 集合恰为 {A,B}，且 activeTab、openTabs、history 三个字段都存在。
- E2：真实请求 mode="full" 且没有 cursor 字段；POST 返回 HTTP 200，received=5、created=2、updated=3、rejected=0、pageCount=2。
- E3：GET /api/pages/ranked 的 pages URL 集合恰为 {A,B}，GET /api/health.pageCount=2。
- E4：sync-status 的 data-status="success" 且文本包含「同步成功」；sync-uploaded-count 的纯数字文本="5"，sync-filtered-count 的纯数字文本="0"。
- E5：storage.syncState.status="success"、stats.uploaded=5、stats.filtered=0、lastError=null，cursor=lastSuccessAt=本次 startedAt；sync-status-time 可见并含与本例持久化同步时间对应的 HH:mm。
- E6：本批真实缓存刷新完成后 cache.ranked.data.pages URL 集合包含 A/B，cache.cleanup.data、cache.rules.data、cache.config.data 均非 null，cache.recommendations 至少有当前 B 对应的缓存项；各缓存项 cachedAt 为本次点击后时间戳。

证据：

- evidence/TC-UI-SYNC-001/api/：真实 setup/health/readback，以及单独记录的 SW POST /api/sync 请求、响应或 requestfailed；请求次数只统计步骤内的被测区间。
- evidence/TC-UI-SYNC-001/：result.json 对应各 [En]；screenshots/ 保存关键 UI，flow.gif、server.log、extension.log 由夹具留存；evidence.note 保存本例 storage、时间及网络观察快照。explore.json 由后续 UI 探索阶段生成，本轮不伪造执行结果。

## TC-UI-SYNC-002 普通页面旁有chrome系统页：请求不含系统URL且系统跳过不增加过滤计数

- 优先级：P1；类别：negative；设计技术：equivalence
- Feature：F-SYNC-01、F-SYNC-06
- AC：F-SYNC-01#AC2、F-SYNC-06#AC1
- Code：C-FE-SYNC-01、C-FE-SYNC-03、C-FE-SYNC-05

前置条件：

- 每条用例独立从 tests/fixtures/extension.mjs 导入 test/expect，加载 MV3 插件到独立 Chromium persistent context（channel=chromium）；api 夹具自动 POST /api/__test__/reset，ext.setApiBase 指向 TEST_PORT 的真实后端。脚本结束由夹具关闭 context；不依赖其他用例。
- 清理 chrome.history.deleteAll 和扩展 storage 中的 syncState、cache、connection；保留 apiBaseUrl，关闭无关标签页。外站只由 ext.mockSites/context.route 离线化，不 route、mock 或替换 localhost/127.0.0.1、后端 /api、浏览器 API、业务模块或 DOM。popup 以 chrome-extension://<extensionId>/popup/popup.html 的 tab 打开；元素只用 ui-contract 登记的 getByTestId。
- 点击前注册 BrowserContext request/response/requestfailed 的只读观察，按目标后端 origin、method=POST、path=/api/sync 筛选 SW 请求；不对 SW 请求调用 frame()。记录真实 postDataJSON、响应 status/body 和失败原因至 evidence.recordApi，等待异步取证任务完成后移除监听。setup 的 api.seed/loadSample 不计入 UI 同步请求数；server.log 仅用于访问计数，不能代替请求体证据。
- 初次打开 popup 后等首页初始网络请求结束；connection 无 recoverPending、syncState 无网络失败恢复标记，确认无自发 POST /api/sync 后才开始本次点击计数。浏览器当前历史只能通过 chrome.history.addUrl（ext.seedHistory）和真实离线页面导航构造，不能伪造 lastVisitTime/visitCount；旧页面只经真实 POST /api/sync 导入。

测试数据：A=https://github.com/org/repo/pull/456；B=https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API；额外打开 chrome://version/。系统页不是敏感词/无痕，不算 filtered（前端方案§5.3）。

步骤：

- S1：通过 ext.mockSites 离线登记 A/B；依次 ext.openTabs([A,B])，B 最后活动，ext.seedHistory([A,B]) 用 chrome.history.addUrl 写当前访问；等待 chrome.history.search 确认 http(s) URL 集合恰为 {A,B}。打开 popup 后当前页面按契约排除插件自身，回退到 B。
- S2：用 context.newPage 打开 chrome://version/ 并保留；启用只读观察后以 tab 打开 popup，点击 sync-button；等待 POST 和 sync-status 最终状态。
- S3：读取真实 POST 请求体、GET /api/pages/ranked、sync-filtered-count；保存系统 tab 存在的 chrome.tabs.query 快照与 popup 截图。

预期：

- E1：浏览器 tabs 快照中存在 chrome://version/，但实际 POST 的 activeTab、openTabs、history 中 chrome:// URL 数量=0，chrome-extension:// URL 数量=0。
- E2：实际 POST 的 openTabs URL 集合恰为 {A,B}，activeTab.url=B；HTTP 200，后端 pages URL 集合恰为 {A,B}，pageCount=2。
- E3：sync-status 的 data-status="success" 且包含「同步成功」，sync-filtered-count 文本="0"；系统页跳过不能使该计数变成1。

证据：

- evidence/TC-UI-SYNC-002/api/：真实 setup/health/readback，以及单独记录的 SW POST /api/sync 请求、响应或 requestfailed；请求次数只统计步骤内的被测区间。
- evidence/TC-UI-SYNC-002/：result.json 对应各 [En]；screenshots/ 保存关键 UI，flow.gif、server.log、extension.log 由夹具留存；evidence.note 保存本例 storage、时间及网络观察快照。explore.json 由后续 UI 探索阶段生成，本轮不伪造执行结果。

## TC-UI-SYNC-003 同一页面任务内快速再点同步：立即禁用且只发送一次POST

- 优先级：P1；类别：boundary；设计技术：state-transition
- Feature：F-SYNC-01
- AC：F-SYNC-01#AC3
- Code：C-FE-SYNC-01、C-FE-SYNC-02、C-FE-SYNC-03

前置条件：

- 每条用例独立从 tests/fixtures/extension.mjs 导入 test/expect，加载 MV3 插件到独立 Chromium persistent context（channel=chromium）；api 夹具自动 POST /api/__test__/reset，ext.setApiBase 指向 TEST_PORT 的真实后端。脚本结束由夹具关闭 context；不依赖其他用例。
- 清理 chrome.history.deleteAll 和扩展 storage 中的 syncState、cache、connection；保留 apiBaseUrl，关闭无关标签页。外站只由 ext.mockSites/context.route 离线化，不 route、mock 或替换 localhost/127.0.0.1、后端 /api、浏览器 API、业务模块或 DOM。popup 以 chrome-extension://<extensionId>/popup/popup.html 的 tab 打开；元素只用 ui-contract 登记的 getByTestId。
- 点击前注册 BrowserContext request/response/requestfailed 的只读观察，按目标后端 origin、method=POST、path=/api/sync 筛选 SW 请求；不对 SW 请求调用 frame()。记录真实 postDataJSON、响应 status/body 和失败原因至 evidence.recordApi，等待异步取证任务完成后移除监听。setup 的 api.seed/loadSample 不计入 UI 同步请求数；server.log 仅用于访问计数，不能代替请求体证据。
- 初次打开 popup 后等首页初始网络请求结束；connection 无 recoverPending、syncState 无网络失败恢复标记，确认无自发 POST /api/sync 后才开始本次点击计数。浏览器当前历史只能通过 chrome.history.addUrl（ext.seedHistory）和真实离线页面导航构造，不能伪造 lastVisitTime/visitCount；旧页面只经真实 POST /api/sync 导入。

测试数据：A=https://github.com/org/repo/pull/456；B=https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API；真实后端正常运行，不增加测试延时接口，不 route 后端，不用预置 syncState.status="syncing" 冒充单飞锁。

步骤：

- S1：通过 ext.mockSites 离线登记 A/B；依次 ext.openTabs([A,B])，B 最后活动，ext.seedHistory([A,B]) 用 chrome.history.addUrl 写当前访问；等待 chrome.history.search 确认 http(s) URL 集合恰为 {A,B}。打开 popup 后当前页面按契约排除插件自身，回退到 B。
- S2：ext.openPopup() 后通过 getByTestId 获取 sync-button、sync-full-button 的元素句柄；在同一个页面 JavaScript task 内调用同步按钮的第一次原生 button.click()，立即记录两个按钮的 disabled，然后对同一按钮再调用一次原生 button.click()。不使用 dispatchEvent，也不顺序 await 两次 Playwright click（后者会等待恢复后启动第二批）。
- S3：等待这次真实同步和缓存刷新结束，读取 POST 计数、两个按钮的最终 disabled、GET /api/health；记录同一任务采集的中间状态。

预期：

- E1：第一次原生 click 返回后、第二次原生 click 之前，sync-button.disabled=true 且 sync-full-button.disabled=true。
- E2：从第一次点击至本批完成，被测真实 POST /api/sync 请求数=1，对应响应数=1且 HTTP status=200。
- E3：本批完成后 sync-button.disabled=false、sync-full-button.disabled=false，sync-status 的 data-status="success"。
- E4：GET /api/health.pageCount=2，不存在第二次点击产生的额外同步批次。

证据：

- evidence/TC-UI-SYNC-003/api/：真实 setup/health/readback，以及单独记录的 SW POST /api/sync 请求、响应或 requestfailed；请求次数只统计步骤内的被测区间。
- evidence/TC-UI-SYNC-003/：result.json 对应各 [En]；screenshots/ 保存关键 UI，flow.gif、server.log、extension.log 由夹具留存；evidence.note 保存本例 storage、时间及网络观察快照。explore.json 由后续 UI 探索阶段生成，本轮不伪造执行结果。

## TC-UI-SYNC-004 真实连接失败：展示原因和诊断入口并保留排序、推荐、整理数据

- 优先级：P1；类别：exception；设计技术：state-transition
- Feature：F-SYNC-01、F-SYNC-06
- AC：F-SYNC-01#AC1、F-SYNC-06#AC2
- Code：C-FE-SYNC-01、C-FE-SYNC-02、C-FE-SYNC-03、C-FE-SYNC-04

前置条件：

- 每条用例独立从 tests/fixtures/extension.mjs 导入 test/expect，加载 MV3 插件到独立 Chromium persistent context（channel=chromium）；api 夹具自动 POST /api/__test__/reset，ext.setApiBase 指向 TEST_PORT 的真实后端。脚本结束由夹具关闭 context；不依赖其他用例。
- 清理 chrome.history.deleteAll 和扩展 storage 中的 syncState、cache、connection；保留 apiBaseUrl，关闭无关标签页。外站只由 ext.mockSites/context.route 离线化，不 route、mock 或替换 localhost/127.0.0.1、后端 /api、浏览器 API、业务模块或 DOM。popup 以 chrome-extension://<extensionId>/popup/popup.html 的 tab 打开；元素只用 ui-contract 登记的 getByTestId。
- 点击前注册 BrowserContext request/response/requestfailed 的只读观察，按目标后端 origin、method=POST、path=/api/sync 筛选 SW 请求；不对 SW 请求调用 frame()。记录真实 postDataJSON、响应 status/body 和失败原因至 evidence.recordApi，等待异步取证任务完成后移除监听。setup 的 api.seed/loadSample 不计入 UI 同步请求数；server.log 仅用于访问计数，不能代替请求体证据。
- 初次打开 popup 后等首页初始网络请求结束；connection 无 recoverPending、syncState 无网络失败恢复标记，确认无自发 POST /api/sync 后才开始本次点击计数。浏览器当前历史只能通过 chrome.history.addUrl（ext.seedHistory）和真实离线页面导航构造，不能伪造 lastVisitTime/visitCount；旧页面只经真实 POST /api/sync 导入。

测试数据：resource.json 通过 api.loadSample() 的真实 POST 按 D-01 平移（最新历史=导入时刻−5分钟）导入10页。浏览器只打开 PR A，chrome.history.addUrl 写当前历史；旧页不写入浏览器历史。不可达地址为 http://127.0.0.1:9，须无服务监听。

步骤：

- S1：api.loadSample() 导入样例；外站离线登记后只打开 A，ext.seedHistory([A])；打开 popup 并等待首页排序、推荐网络请求完成。通过 tab-ranked、tab-cleanup 加载真实排序和整理后回到 tab-home；记录非空的 home-ranked-item 文本序列 R0、rec-item 文本序列 N0，以及整理页 cleanup-item 文本序列 C0，读取 cache 的 ranked/recommendations/cleanup.data 快照 K0。
- S2：保持 popup 打开，ext.useUnreachableBackend() 仅把真实 apiBaseUrl 写为无服务端口；重新开始被测请求观察，点击 sync-button 一次，等待失败状态。
- S3：读取 sync-status、sync-error-message、sync-diag-link 和 storage.syncState.lastError；按同样页签顺序读取首页排序、推荐和整理列表，比较 K0 对应缓存 data。用 api 夹具原真实 base 调 GET /api/health，保存 UI 和 requestfailed 证据。

预期：

- E1：sync-status 的 data-status="error" 且文本包含「同步失败」；sync-error-message 为非空的真实连接失败原因。
- E2：storage.syncState.lastError.code="BACKEND_UNREACHABLE" 且 message 非空；不存在为连接失败虚构的 HTTP 400/500 响应。
- E3：sync-diag-link 可见且文本包含「诊断」，sync-button 失败后恢复 enabled。
- E4：失败后首页 home-ranked-item 文本序列=R0、rec-item 文本序列=N0，整理页 cleanup-item 文本序列=C0，三组都仍非空。
- E5：失败前后 cache.ranked.data、cache.recommendations 各既有项 data、cache.cleanup.data 与 K0 深度相等；只比较业务数据，允许 connection/syncState 失败元数据改变。
- E6：原真实后端 GET /api/health.pageCount=10，失败点击没有写入或清空后端页面。

证据：

- evidence/TC-UI-SYNC-004/api/：真实 setup/health/readback，以及单独记录的 SW POST /api/sync 请求、响应或 requestfailed；请求次数只统计步骤内的被测区间。
- evidence/TC-UI-SYNC-004/：result.json 对应各 [En]；screenshots/ 保存关键 UI，flow.gif、server.log、extension.log 由夹具留存；evidence.note 保存本例 storage、时间及网络观察快照。explore.json 由后续 UI 探索阶段生成，本轮不伪造执行结果。

## TC-UI-SYNC-005 成功后关闭重开popup：恢复相同同步结果和上次时间且不重复上报

- 优先级：P1；类别：state；设计技术：state-transition
- Feature：F-SYNC-06
- AC：F-SYNC-06#AC3
- Code：C-FE-SYNC-01、C-FE-SYNC-02、C-FE-SYNC-04

前置条件：

- 每条用例独立从 tests/fixtures/extension.mjs 导入 test/expect，加载 MV3 插件到独立 Chromium persistent context（channel=chromium）；api 夹具自动 POST /api/__test__/reset，ext.setApiBase 指向 TEST_PORT 的真实后端。脚本结束由夹具关闭 context；不依赖其他用例。
- 清理 chrome.history.deleteAll 和扩展 storage 中的 syncState、cache、connection；保留 apiBaseUrl，关闭无关标签页。外站只由 ext.mockSites/context.route 离线化，不 route、mock 或替换 localhost/127.0.0.1、后端 /api、浏览器 API、业务模块或 DOM。popup 以 chrome-extension://<extensionId>/popup/popup.html 的 tab 打开；元素只用 ui-contract 登记的 getByTestId。
- 点击前注册 BrowserContext request/response/requestfailed 的只读观察，按目标后端 origin、method=POST、path=/api/sync 筛选 SW 请求；不对 SW 请求调用 frame()。记录真实 postDataJSON、响应 status/body 和失败原因至 evidence.recordApi，等待异步取证任务完成后移除监听。setup 的 api.seed/loadSample 不计入 UI 同步请求数；server.log 仅用于访问计数，不能代替请求体证据。
- 初次打开 popup 后等首页初始网络请求结束；connection 无 recoverPending、syncState 无网络失败恢复标记，确认无自发 POST /api/sync 后才开始本次点击计数。浏览器当前历史只能通过 chrome.history.addUrl（ext.seedHistory）和真实离线页面导航构造，不能伪造 lastVisitTime/visitCount；旧页面只经真实 POST /api/sync 导入。

测试数据：A=https://github.com/org/repo/pull/456；B=https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API；本例自行同步一次，记录 storage.syncState 的 lastSyncAt/lastSuccessAt/startedAt 与统计，不继承别例数据。

步骤：

- S1：通过 ext.mockSites 离线登记 A/B；依次 ext.openTabs([A,B])，B 最后活动，ext.seedHistory([A,B]) 用 chrome.history.addUrl 写当前访问；等待 chrome.history.search 确认 http(s) URL 集合恰为 {A,B}。打开 popup 后当前页面按契约排除插件自身，回退到 B。
- S2：打开 popup 点击 sync-button，等真实同步及缓存刷新完成；记录持久化状态 Q 和 sync-status-time 中的 HH:mm，记录截至此时 POST 总数=1。
- S3：关闭 popup tab，调用 ext.openPopup() 创建新 popup；不再次点击同步。等 GET_SYNC_STATE 读取结果并读取 sync-status、sync-status-time、上传/过滤计数及 storage 快照，ext.snap 截图。

预期：

- E1：新 popup 的 sync-status.data-status="success"，文本包含「同步成功」。
- E2：新 popup 的 sync-status-time 可见，其 HH:mm 等于首次记录且对应 Q 的上次同步时间；不要求会随时钟变化的相对时间文本逐字相同。
- E3：重开后 sync-uploaded-count="5"、sync-filtered-count="0"，storage.syncState 的 lastSyncAt/lastSuccessAt/startedAt/cursor/stats 均等于 Q。
- E4：从首次点击至重开读取结束，真实 POST /api/sync 总数仍为1，没有因 popup 重建重复上传。

证据：

- evidence/TC-UI-SYNC-005/api/：真实 setup/health/readback，以及单独记录的 SW POST /api/sync 请求、响应或 requestfailed；请求次数只统计步骤内的被测区间。
- evidence/TC-UI-SYNC-005/：result.json 对应各 [En]；screenshots/ 保存关键 UI，flow.gif、server.log、extension.log 由夹具留存；evidence.note 保存本例 storage、时间及网络观察快照。explore.json 由后续 UI 探索阶段生成，本轮不伪造执行结果。

## TC-UI-SYNC-006 点击后立即关闭popup：3秒后重开显示后台完成的成功状态

- 优先级：P1；类别：exception；设计技术：state-transition
- Feature：F-SYNC-06
- AC：F-SYNC-06#AC4
- Code：C-FE-SYNC-01、C-FE-SYNC-02、C-FE-SYNC-03、C-FE-SYNC-04

前置条件：

- 每条用例独立从 tests/fixtures/extension.mjs 导入 test/expect，加载 MV3 插件到独立 Chromium persistent context（channel=chromium）；api 夹具自动 POST /api/__test__/reset，ext.setApiBase 指向 TEST_PORT 的真实后端。脚本结束由夹具关闭 context；不依赖其他用例。
- 清理 chrome.history.deleteAll 和扩展 storage 中的 syncState、cache、connection；保留 apiBaseUrl，关闭无关标签页。外站只由 ext.mockSites/context.route 离线化，不 route、mock 或替换 localhost/127.0.0.1、后端 /api、浏览器 API、业务模块或 DOM。popup 以 chrome-extension://<extensionId>/popup/popup.html 的 tab 打开；元素只用 ui-contract 登记的 getByTestId。
- 点击前注册 BrowserContext request/response/requestfailed 的只读观察，按目标后端 origin、method=POST、path=/api/sync 筛选 SW 请求；不对 SW 请求调用 frame()。记录真实 postDataJSON、响应 status/body 和失败原因至 evidence.recordApi，等待异步取证任务完成后移除监听。setup 的 api.seed/loadSample 不计入 UI 同步请求数；server.log 仅用于访问计数，不能代替请求体证据。
- 初次打开 popup 后等首页初始网络请求结束；connection 无 recoverPending、syncState 无网络失败恢复标记，确认无自发 POST /api/sync 后才开始本次点击计数。浏览器当前历史只能通过 chrome.history.addUrl（ext.seedHistory）和真实离线页面导航构造，不能伪造 lastVisitTime/visitCount；旧页面只经真实 POST /api/sync 导入。

测试数据：A=https://github.com/org/repo/pull/456；B=https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API；真实本地后端正常、没有人为延迟。只关闭 popup，保留浏览器 context、SW 和两个普通页面。

步骤：

- S1：通过 ext.mockSites 离线登记 A/B；依次 ext.openTabs([A,B])，B 最后活动，ext.seedHistory([A,B]) 用 chrome.history.addUrl 写当前访问；等待 chrome.history.search 确认 http(s) URL 集合恰为 {A,B}。打开 popup 后当前页面按契约排除插件自身，回退到 B。
- S2：打开 popup 并等初始请求结束。在 sync-button 的 locator.evaluate 中调用一次原生 button.click()，返回后立即 page.close()，不等待 SYNC_NOW 响应、sync-status 成功或持久化成功状态。记下点击与关闭的单调时钟时间，确认没有先等待同步完成。
- S3：从关闭时刻起用单调计时在3秒后创建新 popup（计时调度误差记录在 evidence.note）；在重开时立即读取 SW 的持久化 syncState 和真实 GET /api/health，再读取 popup 的 GET_SYNC_STATE 渲染。不得用额外等待数十秒成功来替代3秒检查。

预期：

- E1：popup 被关闭后浏览器 context 和 SW 仍存在，两个普通页面 URL 集合仍为 {A,B}。
- E2：3秒重开时读取的 storage.syncState.status="success"，真实 GET /api/health.pageCount=2（>0）。
- E3：新 popup 的 sync-status.data-status="success" 且包含「同步成功」，sync-uploaded-count="5"、sync-filtered-count="0"。
- E4：被测 POST /api/sync 总数=1且 HTTP 200；没有通过重开后第二次点击补做同步。

证据：

- evidence/TC-UI-SYNC-006/api/：真实 setup/health/readback，以及单独记录的 SW POST /api/sync 请求、响应或 requestfailed；请求次数只统计步骤内的被测区间。
- evidence/TC-UI-SYNC-006/：result.json 对应各 [En]；screenshots/ 保存关键 UI，flow.gif、server.log、extension.log 由夹具留存；evidence.note 保存本例 storage、时间及网络观察快照。explore.json 由后续 UI 探索阶段生成，本轮不伪造执行结果。

## TC-UI-SYNC-007 冷态SW遗留31秒syncing：判为SYNC_INTERRUPTED并持久化失败

- 优先级：P1；类别：exception；设计技术：state-transition
- Feature：F-SYNC-06
- AC：F-SYNC-06#AC5
- Code：C-FE-SYNC-01、C-FE-SYNC-02、C-FE-SYNC-04

前置条件：

- 每条用例独立从 tests/fixtures/extension.mjs 导入 test/expect，加载 MV3 插件到独立 Chromium persistent context（channel=chromium）；api 夹具自动 POST /api/__test__/reset，ext.setApiBase 指向 TEST_PORT 的真实后端。脚本结束由夹具关闭 context；不依赖其他用例。
- 清理 chrome.history.deleteAll 和扩展 storage 中的 syncState、cache、connection；保留 apiBaseUrl，关闭无关标签页。外站只由 ext.mockSites/context.route 离线化，不 route、mock 或替换 localhost/127.0.0.1、后端 /api、浏览器 API、业务模块或 DOM。popup 以 chrome-extension://<extensionId>/popup/popup.html 的 tab 打开；元素只用 ui-contract 登记的 getByTestId。
- 点击前注册 BrowserContext request/response/requestfailed 的只读观察，按目标后端 origin、method=POST、path=/api/sync 筛选 SW 请求；不对 SW 请求调用 frame()。记录真实 postDataJSON、响应 status/body 和失败原因至 evidence.recordApi，等待异步取证任务完成后移除监听。setup 的 api.seed/loadSample 不计入 UI 同步请求数；server.log 仅用于访问计数，不能代替请求体证据。
- 初次打开 popup 后等首页初始网络请求结束；connection 无 recoverPending、syncState 无网络失败恢复标记，确认无自发 POST /api/sync 后才开始本次点击计数。浏览器当前历史只能通过 chrome.history.addUrl（ext.seedHistory）和真实离线页面导航构造，不能伪造 lastVisitTime/visitCount；旧页面只经真实 POST /api/sync 导入。
- 本例没有发送任何 SYNC_NOW，SW 内无真实进行中的同步；不能在仍有 inFlight Promise 的同步中预置过期状态。

测试数据：通过已登记的 chrome.storage.local.syncState 构造中断持久态：status="syncing"、startedAt=写入时Date.now()−31000、lastSyncAt=null、lastSuccessAt=null、lastError=null、cursor=null、cursorBase=null、fullReason=null、mode="full"、trigger="user"、stats 所有计数字段=0；connection.status="unknown"、recoverPending=false。不改 Date、不真实等待31秒。

步骤：

- S1：在本例独立 context 的冷态 SW 中写入 testData 的完整 syncState 与 connection；记录原始 startedAt 和读取时的时间，确认 elapsed>=31000。
- S2：以 tab 打开 popup，不点击同步；由正常 GET_SYNC_STATE 加载触发中断检测。读取 sync-status、sync-error-message、sync-diag-link、storage.syncState 和真实 POST 观察计数。
- S3：关闭后重新打开 popup，再读错误状态和 storage.syncState.lastError，保存两次失败状态截图。

预期：

- E1：第一次加载后 sync-status.data-status="error" 且包含「同步失败」，sync-error-message 包含「中断」。
- E2：storage.syncState.status="error"、lastError.code="SYNC_INTERRUPTED"，lastError.message 包含「中断」。
- E3：sync-diag-link 可见且包含「诊断」，sync-button 恢复 enabled；不能一直维持 syncing 禁用。
- E4：关闭重开后仍显示 error/中断，storage.syncState.lastError.code 仍为 "SYNC_INTERRUPTED"。
- E5：本例被测 POST /api/sync 请求数=0，GET /api/health.pageCount=0；中断恢复不得伪造同步成功或清空后重试上传。

证据：

- evidence/TC-UI-SYNC-007/api/：真实 setup/health/readback，以及单独记录的 SW POST /api/sync 请求、响应或 requestfailed；请求次数只统计步骤内的被测区间。
- evidence/TC-UI-SYNC-007/：result.json 对应各 [En]；screenshots/ 保存关键 UI，flow.gif、server.log、extension.log 由夹具留存；evidence.note 保存本例 storage、时间及网络观察快照。explore.json 由后续 UI 探索阶段生成，本轮不伪造执行结果。

## TC-UI-SYNC-008 无普通标签和历史：未同步空态经一次同步变为上传0条的成功态

- 优先级：P1；类别：boundary；设计技术：boundary
- Feature：F-SYNC-01、F-SYNC-06
- AC：F-SYNC-01#AC1、F-SYNC-06#AC1
- Code：C-FE-SYNC-01、C-FE-SYNC-03、C-FE-SYNC-05

前置条件：

- 每条用例独立从 tests/fixtures/extension.mjs 导入 test/expect，加载 MV3 插件到独立 Chromium persistent context（channel=chromium）；api 夹具自动 POST /api/__test__/reset，ext.setApiBase 指向 TEST_PORT 的真实后端。脚本结束由夹具关闭 context；不依赖其他用例。
- 清理 chrome.history.deleteAll 和扩展 storage 中的 syncState、cache、connection；保留 apiBaseUrl，关闭无关标签页。外站只由 ext.mockSites/context.route 离线化，不 route、mock 或替换 localhost/127.0.0.1、后端 /api、浏览器 API、业务模块或 DOM。popup 以 chrome-extension://<extensionId>/popup/popup.html 的 tab 打开；元素只用 ui-contract 登记的 getByTestId。
- 点击前注册 BrowserContext request/response/requestfailed 的只读观察，按目标后端 origin、method=POST、path=/api/sync 筛选 SW 请求；不对 SW 请求调用 frame()。记录真实 postDataJSON、响应 status/body 和失败原因至 evidence.recordApi，等待异步取证任务完成后移除监听。setup 的 api.seed/loadSample 不计入 UI 同步请求数；server.log 仅用于访问计数，不能代替请求体证据。
- 初次打开 popup 后等首页初始网络请求结束；connection 无 recoverPending、syncState 无网络失败恢复标记，确认无自发 POST /api/sync 后才开始本次点击计数。浏览器当前历史只能通过 chrome.history.addUrl（ext.seedHistory）和真实离线页面导航构造，不能伪造 lastVisitTime/visitCount；旧页面只经真实 POST /api/sync 导入。

测试数据：chrome.history.deleteAll 后只保留 chrome://version/ 和 popup 自身，没有任何 http(s) 标签页或历史；无可用当前页，activeTab 必须显式 null。

步骤：

- S1：打开 chrome://version/，关闭全部 http(s) 页；清空浏览器历史，确认 history.search 返回0条；打开 popup，读取 sync-status 初始空态。
- S2：在只读观察已启用后点击 sync-button，等真实 POST 完成；读取请求体、数字状态、真实 GET /api/health，保存前后两张截图。

预期：

- E1：首次加载 sync-status.data-status="idle" 且文本包含「尚未同步」。
- E2：真实 POST 的 activeTab=null、openTabs=[]、history=[]，三个字段均存在；mode="full"，cursor 字段省略。
- E3：真实 POST 返回 HTTP 200、received=0、created=0、updated=0、rejected=0、pageCount=0；GET /api/health.pageCount=0。
- E4：同步完成后 sync-status.data-status="success" 且包含「同步成功」，sync-uploaded-count="0"、sync-filtered-count="0"。

证据：

- evidence/TC-UI-SYNC-008/api/：真实 setup/health/readback，以及单独记录的 SW POST /api/sync 请求、响应或 requestfailed；请求次数只统计步骤内的被测区间。
- evidence/TC-UI-SYNC-008/：result.json 对应各 [En]；screenshots/ 保存关键 UI，flow.gif、server.log、extension.log 由夹具留存；evidence.note 保存本例 storage、时间及网络观察快照。explore.json 由后续 UI 探索阶段生成，本轮不伪造执行结果。

## TC-UI-SYNC-009 历史中一条敏感记录被过滤：成功状态展示上传5条、过滤1条

- 优先级：P0；类别：positive；设计技术：equivalence
- Feature：F-SYNC-01、F-SYNC-06
- AC：F-SYNC-01#AC1、F-SYNC-06#AC1
- Code：C-FE-SYNC-01、C-FE-SYNC-03、C-FE-SYNC-05

前置条件：

- 每条用例独立从 tests/fixtures/extension.mjs 导入 test/expect，加载 MV3 插件到独立 Chromium persistent context（channel=chromium）；api 夹具自动 POST /api/__test__/reset，ext.setApiBase 指向 TEST_PORT 的真实后端。脚本结束由夹具关闭 context；不依赖其他用例。
- 清理 chrome.history.deleteAll 和扩展 storage 中的 syncState、cache、connection；保留 apiBaseUrl，关闭无关标签页。外站只由 ext.mockSites/context.route 离线化，不 route、mock 或替换 localhost/127.0.0.1、后端 /api、浏览器 API、业务模块或 DOM。popup 以 chrome-extension://<extensionId>/popup/popup.html 的 tab 打开；元素只用 ui-contract 登记的 getByTestId。
- 点击前注册 BrowserContext request/response/requestfailed 的只读观察，按目标后端 origin、method=POST、path=/api/sync 筛选 SW 请求；不对 SW 请求调用 frame()。记录真实 postDataJSON、响应 status/body 和失败原因至 evidence.recordApi，等待异步取证任务完成后移除监听。setup 的 api.seed/loadSample 不计入 UI 同步请求数；server.log 仅用于访问计数，不能代替请求体证据。
- 初次打开 popup 后等首页初始网络请求结束；connection 无 recoverPending、syncState 无网络失败恢复标记，确认无自发 POST /api/sync 后才开始本次点击计数。浏览器当前历史只能通过 chrome.history.addUrl（ext.seedHistory）和真实离线页面导航构造，不能伪造 lastVisitTime/visitCount；旧页面只经真实 POST /api/sync 导入。

测试数据：A=https://github.com/org/repo/pull/456；B=https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API；S=https://example.com/private-token-marker 是合成的敏感词测试URL，不含真实凭证。只 addUrl S，不打开S标签，避免active/open/history多次观察混淆计数；默认敏感关键词含 token。采集前 active=1、openTabs=2、history=3，过滤S的1条历史后 uploaded=5、filtered=1。

步骤：

- S1：通过 ext.mockSites 离线登记 A/B；依次 ext.openTabs([A,B])，B 最后活动，ext.seedHistory([A,B]) 用 chrome.history.addUrl 写当前访问；等待 chrome.history.search 确认 http(s) URL 集合恰为 {A,B}。打开 popup 后当前页面按契约排除插件自身，回退到 B。
- S2：只调用 ext.seedHistory([S])，不导航到S；用真实 history.search 确认历史 URL 集合恰为 {A,B,S}，chrome.tabs.query 确认普通标签仍仅A/B。GET /api/config 确认 enablePrivacyFilter=true 且有效关键词包含 token。
- S3：打开 popup 等初始请求结束，启用被测区间只读观察后点击 sync-button；等待真实 POST 和成功状态，读取数字计数及 syncState.stats，并真实 GET /api/pages/ranked 核对。

预期：

- E1：实际 POST 的 activeTab.url=B、openTabs URL集合={A,B}、history URL集合={A,B}，所有三个字段均不含S；UI同步的POST数=1。
- E2：真实 POST 返回 HTTP 200、received=5、rejected=0、pageCount=2；GET /api/pages/ranked URL集合恰为 {A,B}，不含S。
- E3：sync-status.data-status="success" 且文本包含「同步成功」，sync-uploaded-count="5"、sync-filtered-count="1"。
- E4：storage.syncState.stats.uploaded=5、stats.filtered=1，与实际去重前上传条数和仅出现一次的敏感历史过滤条数分别相等。

证据：

- evidence/TC-UI-SYNC-009/api/：真实 setup/health/readback，以及单独记录的 SW POST /api/sync 请求、响应或 requestfailed；请求次数只统计步骤内的被测区间。
- evidence/TC-UI-SYNC-009/：result.json 对应各 [En]；screenshots/ 保存关键 UI，flow.gif、server.log、extension.log 由夹具留存；evidence.note 保存本例 storage、时间及网络观察快照。explore.json 由后续 UI 探索阶段生成，本轮不伪造执行结果。

## Feature → Case 覆盖表

| Feature | AC | acceptanceRefs关联用例 | 实际主证明 |
|---|---|---|---|
| F-SYNC-01 | F-SYNC-01#AC1 | TC-UI-SYNC-001、TC-UI-SYNC-004、TC-UI-SYNC-008、TC-UI-SYNC-009 | TC-UI-SYNC-001、TC-UI-SYNC-009 |
| F-SYNC-01 | F-SYNC-01#AC2 | TC-UI-SYNC-002 | TC-UI-SYNC-002 |
| F-SYNC-01 | F-SYNC-01#AC3 | TC-UI-SYNC-003 | TC-UI-SYNC-003 |
| F-SYNC-06 | F-SYNC-06#AC1 | TC-UI-SYNC-001、TC-UI-SYNC-002、TC-UI-SYNC-008、TC-UI-SYNC-009 | TC-UI-SYNC-001、TC-UI-SYNC-002、TC-UI-SYNC-008、TC-UI-SYNC-009 |
| F-SYNC-06 | F-SYNC-06#AC2 | TC-UI-SYNC-004 | TC-UI-SYNC-004 |
| F-SYNC-06 | F-SYNC-06#AC3 | TC-UI-SYNC-005 | TC-UI-SYNC-005 |
| F-SYNC-06 | F-SYNC-06#AC4 | TC-UI-SYNC-006 | TC-UI-SYNC-006 |
| F-SYNC-06 | F-SYNC-06#AC5 | TC-UI-SYNC-007 | TC-UI-SYNC-007 |

| Feature | 类别分布 | 缺口 | waiver |
|---|---|---|---|
| F-SYNC-01 | positive=2，negative=1，boundary=2，exception=1 | 0 | 无 |
| F-SYNC-06 | positive=2，negative=1，exception=3，state=1，boundary=1 | 0 | 无 |

## 类别分布统计

统计来源：以原始 Feature 注册表中的本模块 inScope FE Feature 和本 JSON 分片构造临时 root，调用 nav-test-case-design/scripts/check-cases.mjs 导出的 checkCases({root})，取 stats.byCategory，不手算、不改检查器。此隔离统计中的全局 E2E 数量提示不属于本 UI 任务；完整模块结果以两条指定 validator 为准。

| 类别 | 数量 |
|---|---:|
| positive | 2 |
| negative | 1 |
| boundary | 2 |
| exception | 3 |
| state | 1 |

用例共 9 条；AC 覆盖 8/8；类别缺口 0；waiver 0。

openQuestions：无。产品未实现与其他模块/类型缺口不通过修改契约、编造执行证据或豁免规避。
