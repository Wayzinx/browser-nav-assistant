# REC 插件 UI 测试用例

> 分片：`docs/trace/cases/UI-REC.json`；只设计 `type=UI`、`module=REC`，不直接编辑合并总表。
> 本轮交付为用例设计及静态校验，未执行浏览器或产品验收；下列 evidence 是后续脚本应生成的证据，不是已有执行结果。

## 范围与测试配方

- 唯一 UI Feature：F-REC-08（FE、P0、display），直接验收 AC1 展示、AC2 点击新开、AC3 空库；对应 C-FE-REC-01、C-FE-REC-02、C-FE-REC-03。
- 每个 Case 独立对应后续 `tests/ui/<CaseID>.spec.mjs`，从 `tests/fixtures/extension.mjs` 导入 test/expect；独立 Chromium persistent context 加载 MV3 插件，真实后端开启 ENABLE_TEST_API 并由 api 自动 reset。测试脚本及 evidence 不属于本轮可写范围。
- 每例自行设置 apiBaseUrl、清理浏览历史与 cache/connection/syncState；外部 https 站点 route 离线化，真实 localhost/127.0.0.1 后端不 route。`chrome.history.addUrl` 只造当前浏览器记录；旧页面时间和次数经真实 `POST /api/sync` 导入。
- popup 以 `chrome-extension://<extensionId>/popup/popup.html` 标签页打开。D-25 要求排除插件自身页；样例四页或十页中，PR 必须最后创建并处于活动状态，避免 lastAccessed 相同时由 tab.id 决定出错。
- 已登记选择器仅用 `getByTestId`：rec-list、rec-item、rec-item-title、rec-item-score、rec-item-reason、rec-loading、rec-empty、rec-error、error-diag-link。诊断链接应限定在 rec-error 内；不发明额外 testId。
- 在打开 popup 或点击前注册观察/等待；真实 SW 网络按 request.serviceWorker()、method、origin、path 筛选，不调用 request.frame()。处理 response.json() 的 Promise 要收集并 await，不能把并发 health 响应误当作推荐请求完成。
- api 夹具只自动记录它自己发出的 HTTP；SW 发出的推荐请求需使用 context 只读事件显式调用 evidence.recordApi，带独立记录 id、method、URL、requestBody、status、responseBody，保留实际请求头中的关联标识。不得为取证修改/拦截请求，不能调用额外业务消息补齐首页缺失的请求。连接失败按 requestfailed 留痕，不伪造 HTTP 状态。
- 等待 network 请求结束后判断最终状态；cache-first 的短暂 NO_CACHE 不当成最终空态或错误。样例与合成候选在导入后60秒内取数，使用 D-01 时间平移；UI 消息没有 now 参数，不添加该参数。
- F-REC-08 是 display，必需类别为 positive、exception、state；另外显式补充 negative 和 boundary。负例使用有效输入下所有候选被排除，不涉及非法参数4xx。waivers=[]，无豁免。

## 用例明细

### TC-UI-REC-001 样例 PR 为当前页：首页依次展示三条推荐及两位小数分数和理由

- 优先级：P0 ｜ 类别：positive ｜ 技术：scenario
- 关联 Feature：F-REC-08
- 验收标准：F-REC-08#AC1
- 关联 Code：C-FE-REC-01、C-FE-REC-02

**前置条件**

- 独立脚本从 tests/fixtures/extension.mjs 导入 test/expect；由夹具加载 MV3 插件到独立 Chromium persistent context，api 自动 POST /api/__test__/reset。真实后端以 ENABLE_TEST_API=1 运行，ext.setApiBase 指向该测试后端。
- 关闭初始空白页及无关标签页，chrome.history.deleteAll 清理浏览历史；chrome.storage.local.remove(['cache','connection','syncState']) 清除缓存及恢复标记，只保留真实 apiBaseUrl。不得修改业务实现、手工渲染 DOM、注入推荐缓存或 mock 后端。
- 网络取证仅使用 context 级只读事件，按 request.serviceWorker() 非空、method 和目标 origin/path 筛选，不调用 SW 请求的 frame()。response.json() 与 evidence.recordApi 的处理任务统一收集并 await，确认取证落盘后再移除监听、结束本例。

**测试数据与推算**

resource.json 原样按 D-01 平移，由 api.loadSample() 经真实 POST /api/sync 导入，最新 history.lastVisitTime=T-300000。PRD §13.4 的推荐顺序/分数为 Actions · org/repo/0.87、useState – React/0.46、Quick Start – React/0.41；导入后 60 秒内完成网络取数，不向 UI 消息虚构 now 参数。浏览器只打开样例四页：issues/123、Fetch_API、docs.internal.com/ai-agent-design、pull/456（最后打开）。

**步骤**

- S1：注册 ext.mockSites，只 route 样例的外部 https 站点并使用 resource.json 的标题；后端 localhost/127.0.0.1 不进入 route。调用 api.loadSample()，GET /api/health 确认 pageCount=10。
- S2：调用 ext.seedHistory，以 chrome.history.addUrl 写入四个样例浏览器 URL 的当前访问记录；旧时间和 visitCount 仅来自 S1 的后端导入。ext.openTabs 依次打开 issues/123、Fetch_API、docs.internal.com/ai-agent-design、pull/456，保证 PR 最后创建且活动，等待 chrome.tabs 查询确认当前普通页面是 PR。
- S3：在 ext.openPopup() 前注册 context 的 request/response 只读观察，筛选 service worker 发向真实测试后端 POST /api/recommendations/next 的请求，保存 postDataJSON、HTTP status 和 response.json 到本 Case 的 api/；不拦截或修改响应。随后以 chrome-extension://<extensionId>/popup/popup.html 标签页打开 popup。
- S4：等待首页 GET_RECOMMENDATIONS 的 source=network 路径产生的 S3 真实响应及 rec-loading 隐藏；只用 getByTestId 定位 rec-list 下的 rec-item 及其 rec-item-title、rec-item-score、rec-item-reason。不得额外手工发消息来补齐首页漏发的请求。逐项读取后截图。

**预期**

- E1：S3 观察到的 POST 返回 HTTP 200，请求 currentPage.url="https://github.com/org/repo/pull/456"，不是 chrome-extension:// 地址。
- E2：S3 请求 openTabs 的 URL 集合恰为四个样例普通页面，不包含 popup 的 chrome-extension:// 地址。
- E3：S3 响应 recommendations.length=3，title 依次为「Actions · org/repo」「useState – React」「Quick Start – React」。
- E4：rec-list 下可见 rec-item 的数量=3，且 rec-item-title 文本序列与 E3 的三条标题逐项相等。
- E5：三个 rec-item-score 文本依次为「0.87」「0.46」「0.41」，且分别等于真实响应对应 score.toFixed(2)。
- E6：每个 rec-item-reason 的 trim 后长度>0，并与真实响应对应 reason 相等。
- E7：第一条 rec-item-reason 同时包含「PR」和「CI」。
- E8：网络结果展示后 rec-loading、rec-empty、rec-error 均不可见。

**证据**

- evidence/TC-UI-REC-001/result.json：未来脚本逐条 [E1]–[E8] 的断言结果；本次仅设计，不生成执行证据。
- api/：reset、D-01 导入、health 请求响应，以及 context 观察到的 SW 推荐真实请求响应（api 夹具不会自动收录 SW 网络，脚本需用 evidence.recordApi 显式保存）。
- screenshots/：ext.snap 的三条推荐完整截图；flow.gif、server.log、extension.log；explore.json 留给后续 UI 探索。

### TC-UI-REC-002 点击样例第一条推荐：只新增一个 Actions 标签页且保留原页面

- 优先级：P0 ｜ 类别：positive ｜ 技术：state-transition
- 关联 Feature：F-REC-08
- 验收标准：F-REC-08#AC2
- 关联 Code：C-FE-REC-01、C-FE-REC-02、C-FE-REC-03

**前置条件**

- 使用 tests/fixtures/extension.mjs 的独立 Chromium MV3 context 和真实测试后端；api 自动 reset，ext.setApiBase 设置真实地址；清空浏览历史、cache、connection、syncState，关闭无关标签页。
- 本脚本自行准备后端和浏览器数据，不依赖其它脚本；所有外部 https 站点 route 离线化，不 route 本机后端。
- 网络取证仅使用 context 级只读事件，按 request.serviceWorker() 非空、method 和目标 origin/path 筛选，不调用 SW 请求的 frame()。response.json() 与 evidence.recordApi 的处理任务统一收集并 await，确认取证落盘后再移除监听、结束本例。

**测试数据与推算**

api.loadSample() 按 D-01 导入 resource.json；浏览器打开 issues/123、Fetch_API、docs.internal.com/ai-agent-design、pull/456，PR 最后创建且活动。Actions 不预先打开；目标为 https://github.com/org/repo/actions，离线页面标题为 Actions · org/repo。

**步骤**

- S1：ext.mockSites 为样例外部站点登记标题，并为 https://github.com/org/repo/actions 登记离线页面；api.loadSample() 独立导入样例。ext.seedHistory 用 chrome.history.addUrl 造当前浏览器记录，再 ext.openTabs 按测试数据顺序打开四页并确认 PR 活动。
- S2：打开 popup 前注册真实推荐 HTTP request/response 观察并保存到 api/；ext.openPopup() 以 tab 方式打开 popup，等待网络推荐到达且首个 rec-item-title=「Actions · org/repo」。
- S3：记录 chrome.tabs.query 得到的标签页集合 B，以及 PR 和 popup 的 tabId/URL；点击前创建 context.waitForEvent('page') Promise 并注册 chrome.tabs.onCreated/onActivated 观察，随后仅点击 rec-list 下第一个 rec-item 一次。
- S4：取得 S3 等待的新 page，等待其 URL 为 https://github.com/org/repo/actions 且 domcontentloaded；重新查询标签页集合 A，对比 A 与 B，并读取原 PR 和 popup 的 URL。对新页和保留的 popup 使用 ext.snap 留痕。

**预期**

- E1：点击前首条推荐标题为「Actions · org/repo」，其真实推荐响应 url="https://github.com/org/repo/actions"。
- E2：A 相对于 B 恰好新增 1 个 tabId，且该新 id 与点击前所有 tabId 均不同。
- E3：新增标签页 url="https://github.com/org/repo/actions"。
- E4：新增标签页 active=true，且不是原 PR 或 popup 的 tabId。
- E5：原 PR tabId 仍存在，url 仍为 https://github.com/org/repo/pull/456。
- E6：原 popup tabId 仍存在，url 仍为 chrome-extension://<extensionId>/popup/popup.html。

**证据**

- evidence/TC-UI-REC-002/result.json：未来 [E1]–[E6] 断言；api/：本例独立导入及显式收录的 SW 推荐请求响应。
- 截图：点击前的 popup、新 Actions 标签页、仍存在的 popup；tab 事件及 A/B tabId/URL/active 快照通过 evidence.note 保存；flow.gif、server.log、extension.log、后续 explore.json。

### TC-UI-REC-003 后端空库且浏览器有当前页：推荐显示同步引导而不自行上传历史

- 优先级：P1 ｜ 类别：state ｜ 技术：state-transition
- 关联 Feature：F-REC-08
- 验收标准：F-REC-08#AC3
- 关联 Code：C-FE-REC-01、C-FE-REC-02

**前置条件**

- tests/fixtures/extension.mjs 加载独立 Chromium MV3 context；api 自动 reset；真实后端可达，ext.setApiBase 指向真实测试后端；本例不调用 loadSample/seed/sync。
- 关闭无关标签页、chrome.history.deleteAll；remove cache、connection、syncState，确认没有 connection.recoverPending=true 或上次同步网络错误。保持 recovery 的自然 not-needed 条件，不 mock recovery、不关闭业务监听。
- 网络取证仅使用 context 级只读事件，按 request.serviceWorker() 非空、method 和目标 origin/path 筛选，不调用 SW 请求的 frame()。response.json() 与 evidence.recordApi 的处理任务统一收集并 await，确认取证落盘后再移除监听、结束本例。

**测试数据与推算**

后端 pageCount=0、ruleCount=0；浏览器通过外站 route 打开 https://github.com/org/repo/pull/456，并通过 chrome.history.addUrl 添加该 URL 当前访问记录。浏览器有上下文但后端无页面，和「全部候选已打开」场景分开。

**步骤**

- S1：GET /api/health 记录 pageCount=0；ext.mockSites 为 PR 外站登记离线标题，ext.seedHistory 用 chrome.history.addUrl 写入 PR 当前历史，ext.openTabs 只打开 PR。不得点击 sync-button 或发送 SYNC_NOW。
- S2：在打开 popup 前注册 context 的真实后端 request/response 观察，分别记录推荐请求及是否出现 POST /api/sync；然后 ext.openPopup() 以 tab 打开首页。
- S3：等待首页 network 推荐请求完成和 rec-loading 隐藏，读取 rec-empty 文案、rec-list 下 rec-item 数量及 rec-error 可见性。
- S4：GET /api/health 再读 pageCount，ext.snap 保存空推荐首页；结束时移除只读网络观察监听。

**预期**

- E1：首页真实推荐请求 HTTP status=200，响应 recommendations=[]。
- E2：rec-empty 可见，文本包含「同步浏览器上下文」。
- E3：rec-list 下 rec-item 数量=0。
- E4：网络请求完成后 rec-loading、rec-error 均不可见。
- E5：S4 的 health.pageCount=0，与 S1 相等。
- E6：S2 至 S4 观察到的 POST /api/sync 请求数=0。

**证据**

- evidence/TC-UI-REC-003/result.json：未来 [E1]–[E6]；api/：reset、两次 health 和显式保存的 SW 推荐请求响应。
- evidence.note：无恢复标记的 storage 快照、POST /api/sync 观察计数；screenshots/：空态引导；flow.gif、server.log、extension.log、后续 explore.json。

### TC-UI-REC-004 真实推荐返回五条：首页严格截取前三条且不展示第四第五条

- 优先级：P1 ｜ 类别：boundary ｜ 技术：boundary
- 关联 Feature：F-REC-08
- 验收标准：F-REC-08#AC1
- 关联 Code：C-FE-REC-01、C-FE-REC-02

**前置条件**

- tests/fixtures/extension.mjs 独立加载 Chromium MV3 插件并由 api 自动 reset；ext.setApiBase 指向可达的真实后端。清空浏览历史、cache、connection、syncState，关闭无关标签页。
- 只 route https://news.example.org/** 外站；所有候选只通过真实 POST /api/sync 导入，不打开候选标签页、不把合成返回或缓存注入 UI。
- 网络取证仅使用 context 级只读事件，按 request.serviceWorker() 非空、method 和目标 origin/path 筛选，不调用 SW 请求的 frame()。response.json() 与 evidence.recordApi 的处理任务统一收集并 await，确认取证落盘后再移除监听、结束本例。

**测试数据与推算**

T=本例导入时刻；POST /api/sync 的 activeTab=null、openTabs=[]，history 为 https://news.example.org/a1..a5，title 依次「候选1」..「候选5」，visitCount=[10,8,6,4,2]，lastVisitTime 均 T-300000。浏览器只打开同域 https://news.example.org/c（不导入）。按 PRD §6.2/§6.4：recency≈1、frequency=ln(1+visitCount)/ln(11)、open=0、domainBoost=1，页面 score 两位小数为 [0.80,0.77,0.74,0.70,0.64]；same_domain rel=0.6，final=0.6*0.6+0.4*score，得到 [0.68,0.67,0.66,0.64,0.62]。导入后60秒内取数，不使用未登记的 UI now 参数。

**步骤**

- S1：通过 api.post('/api/sync', payload) 导入测试数据的五条 history；GET /api/health 确认 pageCount=5。为 https://news.example.org/c 注册外站离线标题并只用 chrome.history.addUrl 造该当前 URL 历史；ext.openTabs 只打开 c。
- S2：在 ext.openPopup() 前注册 context 真实推荐 HTTP 请求与响应观察并显式保存到 api/；以 tab 打开 popup，等待首页 GET_RECOMMENDATIONS 的 network 路径返回。
- S3：读取实际响应的五条 recommendations；只用 getByTestId 读取 rec-list 内的 rec-item-title、rec-item-score、rec-item-reason，与实际响应的 slice(0,3) 逐项对照，不额外调用业务消息来驱动渲染。
- S4：检查 rec-list 全部条目文本中没有「候选4」「候选5」，并截图保留三条推荐。

**预期**

- E1：S2 的真实 POST 返回 HTTP 200，currentPage.url="https://news.example.org/c"，openTabs 的 URL 集合只有 c。
- E2：真实响应 recommendations.length=5，url 依次为 https://news.example.org/a1、https://news.example.org/a2、https://news.example.org/a3、https://news.example.org/a4、https://news.example.org/a5。
- E3：真实响应五条 score 依次为 0.68、0.67、0.66、0.64、0.62。
- E4：rec-list 下 rec-item 总数=3。
- E5：rec-item-title 文本序列恰为「候选1」「候选2」「候选3」，并与真实响应 slice(0,3) 的 title 一致。
- E6：rec-item-score 文本序列恰为「0.68」「0.67」「0.66」，并与真实响应前三条 score.toFixed(2) 一致。
- E7：三条 rec-item-reason 分别等于真实响应前三条 reason，trim 后长度都>0。
- E8：rec-list 内标题为「候选4」或「候选5」的 rec-item-title 数量=0。
- E9：结果稳定后 rec-loading、rec-empty、rec-error 均不可见。

**证据**

- evidence/TC-UI-REC-004/result.json：未来 [E1]–[E9]；api/：五候选真实导入、health、显式收录的 SW 推荐5条响应。
- evidence.note：T、评分推演及真实5条到UI3条的逐项对照；screenshots/、flow.gif、server.log、extension.log、后续 explore.json。

### TC-UI-REC-005 样例全部候选均已打开：首页不展示任何已排除页面并显示空态

- 优先级：P1 ｜ 类别：negative ｜ 技术：decision-table
- 关联 Feature：F-REC-08
- 验收标准：F-REC-08#AC1
- 关联 Code：C-FE-REC-01、C-FE-REC-02

**前置条件**

- tests/fixtures/extension.mjs 独立 Chromium MV3 context，api 自动 reset 后 ext.setApiBase 连接真实后端；清空浏览历史、cache、connection、syncState，关闭无关标签页。
- 本例是有效输入下全部候选被排除的展示反例，不是非法请求的4xx；不挂载 F-REC-05 等后端 Feature，不替代后端算法用例。外部站点全部 route 离线化，本机后端不 route。
- 网络取证仅使用 context 级只读事件，按 request.serviceWorker() 非空、method 和目标 origin/path 筛选，不调用 SW 请求的 frame()。response.json() 与 evidence.recordApi 的处理任务统一收集并 await，确认取证落盘后再移除监听、结束本例。

**测试数据与推算**

本例独立 api.loadSample() 导入 D-01 样例，pageCount=10；浏览器打开 resource.json.history 的全部10个原始 URL，包括 issues/123?tab=comments、Actions、两条 React 页面及两条旧页面；先打开非PR的9页，pull/456最后创建且活动。与空库不同，真实后端始终有10个页面。

**步骤**

- S1：对 resource.json 中全部外站 URL 注册带原标题的 ext.mockSites；api.loadSample() 独立导入样例，GET /api/health 记录 pageCount=10。
- S2：ext.seedHistory 通过 chrome.history.addUrl 造10个当前浏览器 URL；ext.openTabs 打开非PR的9个样例 URL，最后打开 PR，查询 chrome.tabs 确认恰有10个样例 http(s) URL且PR活动；旧页面的后端时间和次数保留S1导入值。
- S3：打开popup前注册 context 对真实推荐 POST 的只读 request/response 观察并显式保存；ext.openPopup() 以 tab 打开首页，等待 network 请求结束及 rec-loading 隐藏。
- S4：检查推荐空态和列表数量，GET /api/health 复核后端非空；ext.snap 保存页面，记录所有打开 URL 与实际推荐空响应的对照。

**预期**

- E1：真实推荐请求 currentPage.url="https://github.com/org/repo/pull/456"，openTabs 的 URL 集合与本例打开的10个样例原始URL相等。
- E2：真实推荐 HTTP status=200，响应 recommendations=[]。
- E3：rec-list 下 rec-item 数量=0，不能以已打开的 Actions 或 React 页面凑足3条。
- E4：rec-empty 可见，文本包含「同步浏览器上下文」。
- E5：网络完成后 rec-loading、rec-error 均不可见。
- E6：S4 的 health.pageCount=10，与 S1 相等；本例没有因清空后端才得到空推荐。

**证据**

- evidence/TC-UI-REC-005/result.json：未来 [E1]–[E6]；api/：独立样例导入、前后health及SW真实推荐请求响应。
- evidence.note：10个打开URL、currentPage、推荐=[]及非空pageCount对照；screenshots/、flow.gif、server.log、extension.log、后续 explore.json。

### TC-UI-REC-006 无推荐缓存且后端不可达：首页显示推荐错误及诊断入口而非空态

- 优先级：P1 ｜ 类别：exception ｜ 技术：error-guessing
- 关联 Feature：F-REC-08
- 验收标准：F-REC-08#AC1
- 关联 Code：C-FE-REC-01、C-FE-REC-02

**前置条件**

- tests/fixtures/extension.mjs 为本例独立启动加载MV3插件的Chromium context；api 客户端仍连接可达的真实测试后端并自动 reset，仅插件 apiBaseUrl 稍后设为不可达地址。
- 关闭无关页、清空浏览历史，remove cache、connection、syncState；在打开任何popup之前确认 cache 不存在，避免先成功取数产生缓存。所有外站仅通过 route 离线化，禁止 route /api、localhost 或 127.0.0.1。
- 网络取证仅使用 context 级只读事件，按 request.serviceWorker() 非空、method 和目标 origin/path 筛选，不调用 SW 请求的 frame()。response.json() 与 evidence.recordApi 的处理任务统一收集并 await，确认取证落盘后再移除监听、结束本例。

**测试数据与推算**

仅打开外站 PR：https://github.com/org/repo/pull/456；用 ext.useUnreachableBackend() 将插件 apiBaseUrl 指向 http://127.0.0.1:9（无服务），API夹具自身仍指向真实测试后端。本例不注入假返回、假缓存或替换fetch；不要求系统提供未登记的重试testId。

**步骤**

- S1：使用真实api夹具 GET /api/health 记录 pageCount=0；ext.mockSites 登记PR外站离线标题，ext.seedHistory 使用 chrome.history.addUrl 造当前历史，ext.openTabs 只打开PR。
- S2：调用 ext.useUnreachableBackend()，ext.getStorage(['apiBaseUrl','cache']) 读回 apiBaseUrl=http://127.0.0.1:9 且 cache 缺失。打开popup前注册 context 的只读 request/requestfailed 观察以记录实际连接失败，不拦截请求。
- S3：ext.openPopup() 以tab方式打开首页，等待首页 network 取推荐失败后 rec-error 可见、rec-loading 隐藏；保留真实 requestfailed/extension.log 诊断。cache-first 阶段的临时状态不作为最终结果。
- S4：只用已登记的 getByTestId 检查 rec-error 内的 error-diag-link、rec-empty 及 rec-list 下 rec-item；ext.snap 保存错误首页。最后关闭本例context，不能把端口9状态带入其它用例。

**预期**

- E1：打开popup前 storage.apiBaseUrl="http://127.0.0.1:9"，storage.cache 不存在。
- E2：network 获取结束后 rec-error 可见，且其文本 trim 后长度>0。
- E3：rec-error 内的 error-diag-link 可见，文本包含「诊断」。
- E4：network 获取结束后 rec-empty 不可见，不能把连接失败展示为「无推荐」。
- E5：rec-list 下 rec-item 数量=0。
- E6：network 获取结束后 rec-loading 不可见，不能无限加载。
- E7：观察到至少1次来自 service worker、method=POST、URL=http://127.0.0.1:9/api/recommendations/next 的 requestfailed，failure().errorText 非空；不能只有静态错误DOM而未发推荐请求。
- E8：S2 至 S4 中 URL=http://127.0.0.1:9/api/recommendations/next 的 HTTP 2xx 响应数=0。

**证据**

- evidence/TC-UI-REC-006/result.json：未来 [E1]–[E8]；api/：准备阶段真实health；evidence.note：无缓存及apiBaseUrl读回、requestfailed实际错误，不能伪造HTTP响应码。
- screenshots/：rec-error及其诊断入口；flow.gif、extension.log、server.log（只记录准备阶段真实后端请求，端口9失败无服务端日志）、后续 explore.json。

## Feature → Case 覆盖表

| Feature | AC | 直接证明验收条件的用例 | 扩展场景 |
| --- | --- | --- | --- |
| F-REC-08 | AC1：样例首页展示1–3条、Actions首条、分数及非空理由 | TC-UI-REC-001 | TC-UI-REC-004（5→3）、TC-UI-REC-005（全打开）、TC-UI-REC-006（无缓存断网） |
| F-REC-08 | AC2：点击首条新开Actions | TC-UI-REC-002 | 无 |
| F-REC-08 | AC3：后端空库显示同步引导 | TC-UI-REC-003 | 无 |

AC1 的扩展用例引用该验收条款作为测试来源；标准样例的直接证明仍是 TC-UI-REC-001。异常/反例不代替正常样例验收，也不声明后端推荐算法 Feature 已测试通过。

## AC × 类别矩阵

| AC | positive | negative | boundary | exception | state |
| --- | --- | --- | --- | --- | --- |
| F-REC-08#AC1 | TC-UI-REC-001 | TC-UI-REC-005（扩展） | TC-UI-REC-004（扩展） | TC-UI-REC-006（扩展） | — |
| F-REC-08#AC2 | TC-UI-REC-002 | — | — | — | — |
| F-REC-08#AC3 | — | — | — | — | TC-UI-REC-003 |

本模块 layers 含 FE 的 inScope Feature 共1个，其3条AC均有直接用例；类别要求按 Feature 判断，不要求每条 AC 重复覆盖全部类别。

## Code → Case 覆盖表

| Code | 覆盖用例 |
| --- | --- |
| C-FE-REC-01 | TC-UI-REC-001、TC-UI-REC-002、TC-UI-REC-003、TC-UI-REC-004、TC-UI-REC-005、TC-UI-REC-006 |
| C-FE-REC-02 | TC-UI-REC-001、TC-UI-REC-002、TC-UI-REC-003、TC-UI-REC-004、TC-UI-REC-005、TC-UI-REC-006 |
| C-FE-REC-03 | TC-UI-REC-002 |

前端代码点覆盖3/3；所有用例只关联F-REC-08与REC前端代码点，没有新增其它模块的用例。

## 类别分布统计

统计来源：原版 `checkCases({root})`（等价 `check-cases.mjs --root=<隔离目录> --json`）返回的 stats 及 F-REC-08 matrix。统计目录保留完整源 features.json，cases-ui 为本分片，cases-api 为空，仅用于提取本分片分布；没有删改 Feature 或伪造 E2E 来消除全局缺口。

| 类别 | 数量 |
| --- | ---: |
| positive | 2 |
| negative | 1 |
| boundary | 1 |
| exception | 1 |
| state | 1 |
| security | 0 |
| performance | 0 |
| compatibility | 0 |
| 合计 | 6 |

| 优先级 | 数量 |
| --- | ---: |
| P0 | 2 |
| P1 | 4 |
| P2 | 0 |
| P3 | 0 |

F-REC-08 的 matrix.missing=[]，waivers=0；Feature必需类别无缺口。完整源Feature还有其它模块和后端AC，统计隔离目录的全局缺口不能当作本分片未覆盖，也不能据此声称全项目通过。

## 静态自检与接手说明

原版 validator 会写合并总表、追溯矩阵和 .workflow/reports，故只能在项目副本运行，避免越过本次三个文件的写入限制。自检命令：

```bash
node .workflow/validators/validate.mjs cases --module=REC --brief
```

完成定义自检：在 `/tmp/nav-ui-rec-acceptance-zap65flr` 的实际复制副本运行原版 validator。UI-REC 相关错误 **0**、警告 **0**；F-REC-08 类别缺口为 `[]`，AC 覆盖 **3/3**，REC 前端代码点覆盖 **3/3**，JSON 与 Markdown 的6个Case ID一致。

模块整体 `pass=false`、退出码1，剩余6条均为仅BE层的 F-REC-02～F-REC-07 缺少 exception 类用例。它们由其它类型分片负责，本次不修改、不补豁免，不能宣称REC模块整体或全项目通过。

首次直接运行时，子检查器因大量全局输出加 `process.exit()` 导致 stdout 管道中的 JSON 被截断（解析错误），并非本分片用例错误。复核时只将 Node 的 stdout/stderr 设为同步输出，未改检查规则、validator、Feature或契约：

```bash
NODE_OPTIONS='--import=/var/folders/v1/n6z6msv922g3jqc1ylnmb2qm0000gn/T/nav-ui-rec-jdhjpkfy/blocking-stdio.mjs' node .workflow/validators/validate.mjs cases --module=REC --brief
```

临时预加载文件仅包含 `process.stdout._handle?.setBlocking?.(true);` 与 `process.stderr._handle?.setBlocking?.(true);`。解析恢复后确认上述6条BE问题、UI问题为0。原版 validator/check-cases 文件与源项目内容一致。

校验报告仅在隔离目录：`/tmp/nav-ui-rec-acceptance-zap65flr/.workflow/reports/validate-cases-REC.json`；完整技能检查输出在 `/var/folders/v1/n6z6msv922g3jqc1ylnmb2qm0000gn/T/nav-ui-rec-jdhjpkfy/acceptance-check-cases.json`。本分片分布统计原始输出在 `/var/folders/v1/n6z6msv922g3jqc1ylnmb2qm0000gn/T/nav-ui-rec-jdhjpkfy/ui-only-check-cases.json`；只读核对后补强了断网用例的真实 requestfailed 断言，类别、数量、优先级分布保持一致。

当前 REC handler 仍有 NOT_IMPLEMENTED 桩，后端尚未交付；本轮不生成 scripts 或执行证据，不把设计校验等同于产品运行通过。后续阶段按每个Case生成独立脚本、实际加载插件、执行断言，并把截图/真实网络/前后端日志补到对应 evidence 目录。

openQuestions：无需要修改契约才能执行的未决项；加载中的时序不单独虚构延迟接口，不路由后端制造慢响应；离线有缓存及恢复闭环由相应模块负责。
