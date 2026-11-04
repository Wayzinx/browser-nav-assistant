# CLEAN UI 测试用例分片

状态：DESIGNED / NOT RUN。本次只设计 type=UI 的 CLEAN 用例，不生成运行证据，也不声称产品测试通过。

范围：F-CLEAN-07 的3条AC、F-CLEAN-08 的4条AC；C-FE-CLEAN-01至05。BE-only Feature 的 API/E2E 用例由对应角色补齐。每条用例独立转换为 tests/ui/<CaseID>.spec.mjs。

依据：CLEAN上下文包、Feature注册表、api-contract、ui-contract、PRD D-01/D-20与§13.5、前端方案§5.6/§8/§12、FE-API-05。旧参考的14天+1分钟即归档示例与PRD D-20不符，本分片不采用该旧口径。

忽略过期在service worker使用真实Date.now()写storage的7天±1分钟；GET_CLEANUP无now钩子，不冻结popup时钟冒充SW，也不设计不稳定的恰好7天。

## 用例明细

### TC-UI-CLEAN-001 样例与两条规则：摘要2/1/1，三组和命中规则原文完整展示

- ID：TC-UI-CLEAN-001
- 类型：UI；模块：CLEAN
- 优先级：P0；类别：positive；技术：scenario
- 关联Feature：F-CLEAN-07
- acceptanceRefs：F-CLEAN-07#AC1、F-CLEAN-07#AC2
- 关联Code：C-FE-CLEAN-01、C-FE-CLEAN-03、C-FE-CLEAN-04
- 测试数据：resource.json按D-01平移；题目两规则由本例保存。PRD§13.5：archive=Google和issues/100，merge=issues/123两变体，keep=docs.internal.com/ai-agent-design。

前置条件：

- 本例独立启动 ENABLE_TEST_API=1 的真实测试后端（TEST_PORT）和 channel=chromium 的 MV3 插件 persistent context；取得 service worker 后 chrome.storage.local.clear()，设置 apiBaseUrl=http://127.0.0.1:<TEST_PORT>。每例自行 reset，不依赖其他用例。
- popup 作为 chrome-extension://<extId>/popup/popup.html tab 打开；仅 route 外部站点，禁止 route 后端、localhost 或127.0.0.1。旧页面通过真实POST /api/sync导入，不用history.addUrl伪造旧访问。
- 在UI点击前注册 context 请求/响应监听，记录service worker的真实后端操作。重复项仅用登记的getByTestId("cleanup-item")结合完整URL文本filter限定父项，再定位登记的子testId；不使用自造选择器。
- finally在context仍存活时先恢复apiBaseUrl、清理extension storage并真实POST /api/__test__/reset清理后端；用嵌套finally保证上述恢复或清理失败也会关闭popup和persistent context。本文为设计要求；不启动浏览器，不生成运行证据。

步骤：

- S1：真实POST /api/__test__/reset；按D-01整体平移resource.json的history.lastVisitTime，使最新一条=本例导入时刻T−5分钟，通过真实POST /api/sync导入activeTab/openTabs/history；确认200、pageCount=10。
- S2：真实POST /api/rules保存 [{rawText:"把 7 天没访问过的 GitHub issue 建议归档",type:"archive_candidate",domain:"github.com",urlPattern:"/issues/",inactiveDays:7,action:"suggest_archive",enabled:true},{rawText:"docs.internal.com 的页面永远不要归档",type:"never_archive",domain:"docs.internal.com",action:"keep",enabled:true}]；确认201，记录本次响应正式id，后续ruleId关联使用该响应而非写死id。
- S3：真实GET /api/pages/cleanup-suggestions与GET /api/rules记录建议key、ruleId和规则原文；打开popup首页。
- S4：读取home-cleanup-archive-count、home-cleanup-merge-count、home-cleanup-keep-count，实际点击home-cleanup-summary。
- S5：在cleanup-group-archive内用getByTestId("cleanup-item").filter({hasText:"https://github.com/org/repo/issues/100"})限定父项，读取该父项cleanup-item-title、cleanup-item-url、cleanup-item-reason、cleanup-item-rule-tag和cleanup-item-rule-text；分别读取merge与keep组。

预期：

- E1：home-cleanup-archive-count文本为「归档 2」。
- E2：home-cleanup-merge-count文本为「重复 1」。
- E3：home-cleanup-keep-count文本为「保留 1」。
- E4：点击首页摘要后panel-cleanup可见，tab-cleanup的aria-selected="true"。
- E5：cleanup-group-archive、cleanup-group-merge、cleanup-group-keep的cleanup-item数量分别为2、1、1。
- E6：issues/100父项cleanup-item-title文本为「Old bug report from last sprint」，cleanup-item-url文本为https://github.com/org/repo/issues/100。
- E7：issues/100父项cleanup-item-rule-tag文本为「规则」，cleanup-item-rule-text文本为「把 7 天没访问过的 GitHub issue 建议归档」。
- E8：issues/100父项cleanup-item-reason文本为「超过 7 天未访问（已 24 天），且不在当前打开的 tab 中；命中规则「把 7 天没访问过的 GitHub issue 建议归档」」。
- E9：merge父项cleanup-item-url按每URL一行包含且仅包含https://github.com/org/repo/issues/123与https://github.com/org/repo/issues/123?tab=comments。
- E10：keep父项cleanup-item-url文本为https://docs.internal.com/ai-agent-design，cleanup-item-rule-text文本为「docs.internal.com 的页面永远不要归档」。
- E11：tab-cleanup-count文本为「3」，pendingCount只计archive+merge，不计keep。

证据要求：

- 执行后在evidence/TC-UI-CLEAN-001/保存result.json、api/请求与响应（真实status/error/request id）、server.log、extension.log、screenshots/、flow.gif及explore.json。
- 每个[En]在脚本中至少对应一个断言；关键点击前后截图，保留故障前后storage读回及真实接口状态变化。设计状态DESIGNED / NOT RUN，本阶段不写执行证据。

### TC-UI-CLEAN-002 空库：首页和整理页展示同步引导，待处理数隐藏

- ID：TC-UI-CLEAN-002
- 类型：UI；模块：CLEAN
- 优先级：P2；类别：state；技术：equivalence
- 关联Feature：F-CLEAN-07
- acceptanceRefs：F-CLEAN-07#AC3
- 关联Code：C-FE-CLEAN-01、C-FE-CLEAN-03、C-FE-CLEAN-04
- 测试数据：本例只reset、不导入数据，扩展cache为空；后端suggestions=[]，summary三项均0。

前置条件：

- 本例独立启动 ENABLE_TEST_API=1 的真实测试后端（TEST_PORT）和 channel=chromium 的 MV3 插件 persistent context；取得 service worker 后 chrome.storage.local.clear()，设置 apiBaseUrl=http://127.0.0.1:<TEST_PORT>。每例自行 reset，不依赖其他用例。
- popup 作为 chrome-extension://<extId>/popup/popup.html tab 打开；仅 route 外部站点，禁止 route 后端、localhost 或127.0.0.1。旧页面通过真实POST /api/sync导入，不用history.addUrl伪造旧访问。
- 在UI点击前注册 context 请求/响应监听，记录service worker的真实后端操作。重复项仅用登记的getByTestId("cleanup-item")结合完整URL文本filter限定父项，再定位登记的子testId；不使用自造选择器。
- finally在context仍存活时先恢复apiBaseUrl、清理extension storage并真实POST /api/__test__/reset清理后端；用嵌套finally保证上述恢复或清理失败也会关闭popup和persistent context。本文为设计要求；不启动浏览器，不生成运行证据。

步骤：

- S1：真实POST /api/__test__/reset；GET /api/pages/cleanup-suggestions与GET /api/health读取空库。
- S2：打开popup首页读取home-cleanup-empty；点击tab-cleanup读取cleanup-empty、tab-cleanup-count。

预期：

- E1：真实cleanup响应200、suggestions=[]、summary={archive:0,merge:0,keep:0}。
- E2：真实health.pageCount=0。
- E3：home-cleanup-empty可见，文本包含「同步浏览器上下文」。
- E4：cleanup-empty可见，文本包含「同步浏览器上下文」。
- E5：panel-cleanup内cleanup-item数量=0。
- E6：tab-cleanup-count不可见；home-cleanup-error和cleanup-error不可见。

证据要求：

- 执行后在evidence/TC-UI-CLEAN-002/保存result.json、api/请求与响应（真实status/error/request id）、server.log、extension.log、screenshots/、flow.gif及explore.json。
- 每个[En]在脚本中至少对应一个断言；关键点击前后截图，保留故障前后storage读回及真实接口状态变化。设计状态DESIGNED / NOT RUN，本阶段不写执行证据。

### TC-UI-CLEAN-003 点击归档issues/100再撤销：真实接口移除并恢复同一URL

- ID：TC-UI-CLEAN-003
- 类型：UI；模块：CLEAN
- 优先级：P1；类别：positive；技术：state-transition
- 关联Feature：F-CLEAN-08
- acceptanceRefs：F-CLEAN-08#AC1、F-CLEAN-08#AC2
- 关联Code：C-FE-CLEAN-01、C-FE-CLEAN-02、C-FE-CLEAN-05
- 测试数据：D-01样例，无规则；目标https://github.com/org/repo/issues/100；ranked.total归档前10、归档后9、撤销后10。撤销必须是本例自己刚完成的归档。

前置条件：

- 本例独立启动 ENABLE_TEST_API=1 的真实测试后端（TEST_PORT）和 channel=chromium 的 MV3 插件 persistent context；取得 service worker 后 chrome.storage.local.clear()，设置 apiBaseUrl=http://127.0.0.1:<TEST_PORT>。每例自行 reset，不依赖其他用例。
- popup 作为 chrome-extension://<extId>/popup/popup.html tab 打开；仅 route 外部站点，禁止 route 后端、localhost 或127.0.0.1。旧页面通过真实POST /api/sync导入，不用history.addUrl伪造旧访问。
- 在UI点击前注册 context 请求/响应监听，记录service worker的真实后端操作。重复项仅用登记的getByTestId("cleanup-item")结合完整URL文本filter限定父项，再定位登记的子testId；不使用自造选择器。
- finally在context仍存活时先恢复apiBaseUrl、清理extension storage并真实POST /api/__test__/reset清理后端；用嵌套finally保证上述恢复或清理失败也会关闭popup和persistent context。本文为设计要求；不启动浏览器，不生成运行证据。

步骤：

- S1：真实POST /api/__test__/reset；按D-01整体平移resource.json的history.lastVisitTime，使最新一条=本例导入时刻T−5分钟，通过真实POST /api/sync导入activeTab/openTabs/history；确认200、pageCount=10。
- S2：真实GET /api/pages/ranked?limit=500确认目标存在；打开popup并点击tab-cleanup。
- S3：在cleanup-group-archive内用getByTestId("cleanup-item").filter({hasText:"https://github.com/org/repo/issues/100"})限定唯一父项，实际点击其cleanup-archive-button，等待对应真实POST /api/pages/archive完成。
- S4：真实GET /api/pages/ranked?limit=500、GET /api/pages/cleanup-suggestions与POST /api/recommendations/next {currentPage:null,openTabs:[],recentHistory:[]}回读；保存三份响应，不用扩展缓存代替后端结果。
- S5：实际点击cleanup-undo-button，等待真实POST /api/pages/unarchive完成；再GET /api/pages/ranked?limit=500和GET /api/pages/cleanup-suggestions。

预期：

- E1：UI点击产生的archive请求体urls=["https://github.com/org/repo/issues/100"]；操作不由测试直接代发。
- E2：archive响应200、body.ok=true、affected=1、notFound=0，archivedAt为正整数毫秒。
- E3：归档后cleanup-group-archive中URL=https://github.com/org/repo/issues/100的cleanup-item数量=0。
- E4：归档后真实ranked.pages不含https://github.com/org/repo/issues/100且total=9。
- E5：归档后真实cleanup.suggestions不含url=https://github.com/org/repo/issues/100。
- E6：归档后真实recommendations不含url=https://github.com/org/repo/issues/100。
- E7：归档成功后cleanup-undo-button可见且可点击。
- E8：撤销点击产生unarchive请求urls=["https://github.com/org/repo/issues/100"]，响应200、affected=1、notFound=0。
- E9：撤销后真实ranked.pages重新包含https://github.com/org/repo/issues/100且total=10。
- E10：撤销后真实cleanup.suggestions重新包含action=archive、url=https://github.com/org/repo/issues/100。

证据要求：

- 执行后在evidence/TC-UI-CLEAN-003/保存result.json、api/请求与响应（真实status/error/request id）、server.log、extension.log、screenshots/、flow.gif及explore.json。
- 每个[En]在脚本中至少对应一个断言；关键点击前后截图，保留故障前后storage读回及真实接口状态变化。设计状态DESIGNED / NOT RUN，本阶段不写执行证据。

### TC-UI-CLEAN-004 点击合并再撤销：保留无query页面，并恢复被并入页面

- ID：TC-UI-CLEAN-004
- 类型：UI；模块：CLEAN
- 优先级：P1；类别：positive；技术：state-transition
- 关联Feature：F-CLEAN-08
- acceptanceRefs：F-CLEAN-08#AC3
- 关联Code：C-FE-CLEAN-01、C-FE-CLEAN-02、C-FE-CLEAN-05
- 测试数据：D-01样例；本例cleanup响应merge.urls为https://github.com/org/repo/issues/123与https://github.com/org/repo/issues/123?tab=comments，keepUrl=https://github.com/org/repo/issues/123；合并撤销仅恢复query页面。

前置条件：

- 本例独立启动 ENABLE_TEST_API=1 的真实测试后端（TEST_PORT）和 channel=chromium 的 MV3 插件 persistent context；取得 service worker 后 chrome.storage.local.clear()，设置 apiBaseUrl=http://127.0.0.1:<TEST_PORT>。每例自行 reset，不依赖其他用例。
- popup 作为 chrome-extension://<extId>/popup/popup.html tab 打开；仅 route 外部站点，禁止 route 后端、localhost 或127.0.0.1。旧页面通过真实POST /api/sync导入，不用history.addUrl伪造旧访问。
- 在UI点击前注册 context 请求/响应监听，记录service worker的真实后端操作。重复项仅用登记的getByTestId("cleanup-item")结合完整URL文本filter限定父项，再定位登记的子testId；不使用自造选择器。
- finally在context仍存活时先恢复apiBaseUrl、清理extension storage并真实POST /api/__test__/reset清理后端；用嵌套finally保证上述恢复或清理失败也会关闭popup和persistent context。本文为设计要求；不启动浏览器，不生成运行证据。

步骤：

- S1：真实POST /api/__test__/reset；按D-01整体平移resource.json的history.lastVisitTime，使最新一条=本例导入时刻T−5分钟，通过真实POST /api/sync导入activeTab/openTabs/history；确认200、pageCount=10。
- S2：打开popup并点击tab-cleanup；从真实cleanup响应取得本例merge的urls和keepUrl。
- S3：在cleanup-group-merge内用getByTestId("cleanup-item").filter({hasText:"https://github.com/org/repo/issues/123?tab=comments"})限定父项，实际点击其cleanup-merge-button，等待真实POST /api/pages/merge。
- S4：真实GET /api/pages/ranked?limit=500、GET /api/pages/cleanup-suggestions与POST /api/recommendations/next {currentPage:null,openTabs:[],recentHistory:[]}回读；保存三份响应，不用扩展缓存代替后端结果。
- S5：读取chrome.storage.local.lastCleanupAction；实际点击cleanup-undo-button，等待真实POST /api/pages/unarchive，再GET /api/pages/ranked?limit=500。

预期：

- E1：UI点击产生的merge请求urls精确包含https://github.com/org/repo/issues/123与https://github.com/org/repo/issues/123?tab=comments，keepUrl=https://github.com/org/repo/issues/123。
- E2：merge响应200、body.ok=true、keepUrl=https://github.com/org/repo/issues/123、merged=1。
- E3：合并后真实ranked.pages包含https://github.com/org/repo/issues/123、不含https://github.com/org/repo/issues/123?tab=comments，total=9。
- E4：合并后真实cleanup.suggestions中没有同时包含https://github.com/org/repo/issues/123与https://github.com/org/repo/issues/123?tab=comments的merge组。
- E5：合并后真实recommendations不含https://github.com/org/repo/issues/123?tab=comments。
- E6：lastCleanupAction.kind="merge"、urls=["https://github.com/org/repo/issues/123?tab=comments"]，不含keepUrl。
- E7：撤销点击产生unarchive请求urls=["https://github.com/org/repo/issues/123?tab=comments"]，响应200、affected=1。
- E8：撤销后真实ranked.pages同时包含https://github.com/org/repo/issues/123与https://github.com/org/repo/issues/123?tab=comments，total=10。

证据要求：

- 执行后在evidence/TC-UI-CLEAN-004/保存result.json、api/请求与响应（真实status/error/request id）、server.log、extension.log、screenshots/、flow.gif及explore.json。
- 每个[En]在脚本中至少对应一个断言；关键点击前后截图，保留故障前后storage读回及真实接口状态变化。设计状态DESIGNED / NOT RUN，本阶段不写执行证据。

### TC-UI-CLEAN-005 点击忽略后重开popup：保存后端key与忽略时间，仅过滤本地展示

- ID：TC-UI-CLEAN-005
- 类型：UI；模块：CLEAN
- 优先级：P1；类别：positive；技术：state-transition
- 关联Feature：F-CLEAN-08
- acceptanceRefs：F-CLEAN-08#AC4
- 关联Code：C-FE-CLEAN-01、C-FE-CLEAN-02、C-FE-CLEAN-05
- 测试数据：D-01样例无规则；目标https://www.google.com/search?q=chrome+extension+manifest+v3。googleKey取本例真实cleanup的archive suggestion.key，禁止用URL自造key。

前置条件：

- 本例独立启动 ENABLE_TEST_API=1 的真实测试后端（TEST_PORT）和 channel=chromium 的 MV3 插件 persistent context；取得 service worker 后 chrome.storage.local.clear()，设置 apiBaseUrl=http://127.0.0.1:<TEST_PORT>。每例自行 reset，不依赖其他用例。
- popup 作为 chrome-extension://<extId>/popup/popup.html tab 打开；仅 route 外部站点，禁止 route 后端、localhost 或127.0.0.1。旧页面通过真实POST /api/sync导入，不用history.addUrl伪造旧访问。
- 在UI点击前注册 context 请求/响应监听，记录service worker的真实后端操作。重复项仅用登记的getByTestId("cleanup-item")结合完整URL文本filter限定父项，再定位登记的子testId；不使用自造选择器。
- finally在context仍存活时先恢复apiBaseUrl、清理extension storage并真实POST /api/__test__/reset清理后端；用嵌套finally保证上述恢复或清理失败也会关闭popup和persistent context。本文为设计要求；不启动浏览器，不生成运行证据。

步骤：

- S1：真实POST /api/__test__/reset；按D-01整体平移resource.json的history.lastVisitTime，使最新一条=本例导入时刻T−5分钟，通过真实POST /api/sync导入activeTab/openTabs/history；确认200、pageCount=10。
- S2：真实GET /api/pages/cleanup-suggestions记录Google建议key=googleKey；打开popup并点击tab-cleanup。
- S3：在cleanup-group-archive内用getByTestId("cleanup-item").filter({hasText:"https://www.google.com/search?q=chrome+extension+manifest+v3"})限定父项，记录SW时间tBefore，实际点击其cleanup-ignore-button；读storage并记录SW时间tAfter。
- S4：关闭popup tab，再打开同一扩展popup并点击tab-cleanup；等待真实网络刷新，再点击tab-home读取摘要。
- S5：真实GET /api/pages/ranked?limit=500、GET /api/pages/cleanup-suggestions与POST /api/recommendations/next {currentPage:null,openTabs:[],recentHistory:[]}回读；保存三份响应，不用扩展缓存代替后端结果。

预期：

- E1：ignoredSuggestions[googleKey]为毫秒数，满足tBefore≤ignoredAt≤tAfter，key与后端返回完全相同。
- E2：忽略后和重新打开后，cleanup-group-archive中URL=https://www.google.com/search?q=chrome+extension+manifest+v3的cleanup-item数量均为0。
- E3：重开后issues/100父项仍存在，merge组仍含https://github.com/org/repo/issues/123?tab=comments，只有指定建议被过滤。
- E4：重开后首页三计数分别为「归档 1」「重复 1」「保留 0」，tab-cleanup-count文本为「2」。
- E5：真实cleanup仍含Google建议，summary={archive:2,merge:1,keep:0}。
- E6：真实ranked.total=10，pages仍包含https://www.google.com/search?q=chrome+extension+manifest+v3。
- E7：忽略期间无POST /api/pages/archive、/unarchive或/merge请求。

证据要求：

- 执行后在evidence/TC-UI-CLEAN-005/保存result.json、api/请求与响应（真实status/error/request id）、server.log、extension.log、screenshots/、flow.gif及explore.json。
- 每个[En]在脚本中至少对应一个断言；关键点击前后截图，保留故障前后storage读回及真实接口状态变化。设计状态DESIGNED / NOT RUN，本阶段不写执行证据。

### TC-UI-CLEAN-006 忽略7天−1分钟边界：Google建议仍被过滤

- ID：TC-UI-CLEAN-006
- 类型：UI；模块：CLEAN
- 优先级：P2；类别：boundary；技术：boundary
- 关联Feature：F-CLEAN-08
- acceptanceRefs：F-CLEAN-08#AC4
- 关联Code：C-FE-CLEAN-01、C-FE-CLEAN-02、C-FE-CLEAN-05
- 测试数据：D-01样例；先真实UI忽略，再在SW storage设置ignoredAt=Date.now()−7*86400000+60000。GET_CLEANUP没有now钩子，不测不稳定的恰好7天，也不冻结popup时钟来冒充SW时钟。从storage时间构造到E2时钟差断言的执行预算为30秒；超出预算直接记录为夹具/执行失败（retries=0），不自动重新尝试，不扩大expected容差。

前置条件：

- 本例独立启动 ENABLE_TEST_API=1 的真实测试后端（TEST_PORT）和 channel=chromium 的 MV3 插件 persistent context；取得 service worker 后 chrome.storage.local.clear()，设置 apiBaseUrl=http://127.0.0.1:<TEST_PORT>。每例自行 reset，不依赖其他用例。
- popup 作为 chrome-extension://<extId>/popup/popup.html tab 打开；仅 route 外部站点，禁止 route 后端、localhost 或127.0.0.1。旧页面通过真实POST /api/sync导入，不用history.addUrl伪造旧访问。
- 在UI点击前注册 context 请求/响应监听，记录service worker的真实后端操作。重复项仅用登记的getByTestId("cleanup-item")结合完整URL文本filter限定父项，再定位登记的子testId；不使用自造选择器。
- finally在context仍存活时先恢复apiBaseUrl、清理extension storage并真实POST /api/__test__/reset清理后端；用嵌套finally保证上述恢复或清理失败也会关闭popup和persistent context。本文为设计要求；不启动浏览器，不生成运行证据。

步骤：

- S1：真实POST /api/__test__/reset；按D-01整体平移resource.json的history.lastVisitTime，使最新一条=本例导入时刻T−5分钟，通过真实POST /api/sync导入activeTab/openTabs/history；确认200、pageCount=10。
- S2：真实GET /api/pages/cleanup-suggestions取得googleKey，打开popup并点击tab-cleanup。
- S3：在cleanup-group-archive内用getByTestId("cleanup-item").filter({hasText:"https://www.google.com/search?q=chrome+extension+manifest+v3"})限定父项，实际点击其cleanup-ignore-button；读ignoredSuggestions[googleKey]并确认建议消失。
- S4：关闭popup；在SW用chrome.storage.local.get/set只改googleKey对应的ignoredAt=Date.now()−7*86400000+60000，记录值，保留其余storage，不替换Date实现。
- S5：立即重新以tab打开popup并点击tab-cleanup，等待真实网络刷新；读SW Date.now()核对时间差，再点击tab-home读摘要；真实GET /api/pages/cleanup-suggestions与GET /api/pages/ranked?limit=500。

预期：

- E1：真实UI点击忽略后ignoredSuggestions[googleKey]存在，Google建议从当时cleanup列表消失。
- E2：重开时0≤SW当前时间−改写ignoredAt < 7*86400000，与7天−1分钟目标偏差小于30000ms。
- E3：重开后cleanup-group-archive中完整URL=https://www.google.com/search?q=chrome+extension+manifest+v3的cleanup-item数量=0。
- E4：重开后home-cleanup-archive-count文本为「归档 1」，tab-cleanup-count文本为「2」。
- E5：真实cleanup仍有Google建议、summary.archive=2；ranked仍含https://www.google.com/search?q=chrome+extension+manifest+v3且total=10，时间改写不改变后端页面。

证据要求：

- 执行后在evidence/TC-UI-CLEAN-006/保存result.json、api/请求与响应（真实status/error/request id）、server.log、extension.log、screenshots/、flow.gif及explore.json。
- 每个[En]在脚本中至少对应一个断言；关键点击前后截图，保留故障前后storage读回及真实接口状态变化。设计状态DESIGNED / NOT RUN，本阶段不写执行证据。

### TC-UI-CLEAN-007 忽略7天+1分钟边界：Google建议过期重新出现

- ID：TC-UI-CLEAN-007
- 类型：UI；模块：CLEAN
- 优先级：P2；类别：boundary；技术：boundary
- 关联Feature：F-CLEAN-08
- acceptanceRefs：F-CLEAN-08#AC4
- 关联Code：C-FE-CLEAN-01、C-FE-CLEAN-02、C-FE-CLEAN-05
- 测试数据：D-01样例；先真实UI忽略，再在SW storage设置ignoredAt=Date.now()−7*86400000−60000。GET_CLEANUP没有now钩子，不测不稳定的恰好7天，也不冻结popup时钟来冒充SW时钟。从storage时间构造到E2时钟差断言的执行预算为30秒；超出预算直接记录为夹具/执行失败（retries=0），不自动重新尝试，不扩大expected容差。

前置条件：

- 本例独立启动 ENABLE_TEST_API=1 的真实测试后端（TEST_PORT）和 channel=chromium 的 MV3 插件 persistent context；取得 service worker 后 chrome.storage.local.clear()，设置 apiBaseUrl=http://127.0.0.1:<TEST_PORT>。每例自行 reset，不依赖其他用例。
- popup 作为 chrome-extension://<extId>/popup/popup.html tab 打开；仅 route 外部站点，禁止 route 后端、localhost 或127.0.0.1。旧页面通过真实POST /api/sync导入，不用history.addUrl伪造旧访问。
- 在UI点击前注册 context 请求/响应监听，记录service worker的真实后端操作。重复项仅用登记的getByTestId("cleanup-item")结合完整URL文本filter限定父项，再定位登记的子testId；不使用自造选择器。
- finally在context仍存活时先恢复apiBaseUrl、清理extension storage并真实POST /api/__test__/reset清理后端；用嵌套finally保证上述恢复或清理失败也会关闭popup和persistent context。本文为设计要求；不启动浏览器，不生成运行证据。

步骤：

- S1：真实POST /api/__test__/reset；按D-01整体平移resource.json的history.lastVisitTime，使最新一条=本例导入时刻T−5分钟，通过真实POST /api/sync导入activeTab/openTabs/history；确认200、pageCount=10。
- S2：真实GET /api/pages/cleanup-suggestions取得googleKey，打开popup并点击tab-cleanup。
- S3：在cleanup-group-archive内用getByTestId("cleanup-item").filter({hasText:"https://www.google.com/search?q=chrome+extension+manifest+v3"})限定父项，实际点击其cleanup-ignore-button；读ignoredSuggestions[googleKey]并确认建议消失。
- S4：关闭popup；在SW用chrome.storage.local.get/set只改googleKey对应的ignoredAt=Date.now()−7*86400000−60000，记录值，保留其余storage，不替换Date实现。
- S5：立即重新以tab打开popup并点击tab-cleanup，等待真实网络刷新；读SW Date.now()核对时间差，再点击tab-home读摘要；真实GET /api/pages/cleanup-suggestions与GET /api/pages/ranked?limit=500。

预期：

- E1：真实UI点击忽略后ignoredSuggestions[googleKey]存在，Google建议从当时cleanup列表消失。
- E2：重开时SW当前时间−改写ignoredAt > 7*86400000，与7天+1分钟目标偏差小于30000ms。
- E3：重开后cleanup-group-archive中完整URL=https://www.google.com/search?q=chrome+extension+manifest+v3的cleanup-item数量=1。
- E4：重开后home-cleanup-archive-count文本为「归档 2」，tab-cleanup-count文本为「3」。
- E5：真实cleanup仍有Google建议、summary.archive=2；ranked仍含https://www.google.com/search?q=chrome+extension+manifest+v3且total=10，时间改写不改变后端页面。

证据要求：

- 执行后在evidence/TC-UI-CLEAN-007/保存result.json、api/请求与响应（真实status/error/request id）、server.log、extension.log、screenshots/、flow.gif及explore.json。
- 每个[En]在脚本中至少对应一个断言；关键点击前后截图，保留故障前后storage读回及真实接口状态变化。设计状态DESIGNED / NOT RUN，本阶段不写执行证据。

### TC-UI-CLEAN-008 渲染后的归档建议在后端reset后失效：404提示刷新且无副作用

- ID：TC-UI-CLEAN-008
- 类型：UI；模块：CLEAN
- 优先级：P2；类别：negative；技术：error-guessing
- 关联Feature：F-CLEAN-08
- acceptanceRefs：F-CLEAN-08#AC1
- 关联Code：C-FE-CLEAN-01、C-FE-CLEAN-02、C-FE-CLEAN-05
- 测试数据：D-01样例；先实际渲染https://github.com/org/repo/issues/100归档卡片，再真实reset后端，保持popup/DOM打开且不主动刷新；点击实际存在过的旧卡片，不route后端404。

前置条件：

- 本例独立启动 ENABLE_TEST_API=1 的真实测试后端（TEST_PORT）和 channel=chromium 的 MV3 插件 persistent context；取得 service worker 后 chrome.storage.local.clear()，设置 apiBaseUrl=http://127.0.0.1:<TEST_PORT>。每例自行 reset，不依赖其他用例。
- popup 作为 chrome-extension://<extId>/popup/popup.html tab 打开；仅 route 外部站点，禁止 route 后端、localhost 或127.0.0.1。旧页面通过真实POST /api/sync导入，不用history.addUrl伪造旧访问。
- 在UI点击前注册 context 请求/响应监听，记录service worker的真实后端操作。重复项仅用登记的getByTestId("cleanup-item")结合完整URL文本filter限定父项，再定位登记的子testId；不使用自造选择器。
- finally在context仍存活时先恢复apiBaseUrl、清理extension storage并真实POST /api/__test__/reset清理后端；用嵌套finally保证上述恢复或清理失败也会关闭popup和persistent context。本文为设计要求；不启动浏览器，不生成运行证据。

步骤：

- S1：真实POST /api/__test__/reset；按D-01整体平移resource.json的history.lastVisitTime，使最新一条=本例导入时刻T−5分钟，通过真实POST /api/sync导入activeTab/openTabs/history；确认200、pageCount=10。
- S2：打开popup并点击tab-cleanup，确认目标cleanup-item已渲染，记录lastCleanupAction不存在。
- S3：保持popup打开，真实POST /api/__test__/reset；直接GET /api/health确认pageCount=0，不经扩展发送刷新消息。
- S4：用getByTestId("cleanup-item").filter({hasText:"https://github.com/org/repo/issues/100"})限定旧父项，实际点击其cleanup-archive-button，捕获真实archive响应。
- S5：等待自动刷新；真实GET /api/health、GET /api/pages/ranked?limit=500和GET /api/pages/cleanup-suggestions；读取lastCleanupAction。

预期：

- E1：UI点击产生的archive响应status=404、body.error.code="NOT_FOUND"、error.message="页面不存在"且非空。
- E2：cleanup-action-error可见，文本包含「建议已失效，已刷新列表」。
- E3：失败后真实GET /api/pages/cleanup-suggestions重新调用，cleanup-empty可见且文本包含「同步浏览器上下文」。
- E4：失败后health.pageCount=0、ranked.pages=[]、cleanup.suggestions=[]，失效URL未重新写入后端。
- E5：失败后lastCleanupAction不存在，cleanup-undo-button不可见，不创建可撤销的成功记录。

证据要求：

- 执行后在evidence/TC-UI-CLEAN-008/保存result.json、api/请求与响应（真实status/error/request id）、server.log、extension.log、screenshots/、flow.gif及explore.json。
- 每个[En]在脚本中至少对应一个断言；关键点击前后截图，保留故障前后storage读回及真实接口状态变化。设计状态DESIGNED / NOT RUN，本阶段不写执行证据。

### TC-UI-CLEAN-009 渲染后的合并建议在后端reset后失效：404后刷新并保留空库

- ID：TC-UI-CLEAN-009
- 类型：UI；模块：CLEAN
- 优先级：P2；类别：negative；技术：error-guessing
- 关联Feature：F-CLEAN-08
- acceptanceRefs：F-CLEAN-08#AC3
- 关联Code：C-FE-CLEAN-01、C-FE-CLEAN-02、C-FE-CLEAN-05
- 测试数据：D-01样例；先渲染含https://github.com/org/repo/issues/123?tab=comments的重复组再真实reset后端，旧组keepUrl不存在，依据merge契约返回404。

前置条件：

- 本例独立启动 ENABLE_TEST_API=1 的真实测试后端（TEST_PORT）和 channel=chromium 的 MV3 插件 persistent context；取得 service worker 后 chrome.storage.local.clear()，设置 apiBaseUrl=http://127.0.0.1:<TEST_PORT>。每例自行 reset，不依赖其他用例。
- popup 作为 chrome-extension://<extId>/popup/popup.html tab 打开；仅 route 外部站点，禁止 route 后端、localhost 或127.0.0.1。旧页面通过真实POST /api/sync导入，不用history.addUrl伪造旧访问。
- 在UI点击前注册 context 请求/响应监听，记录service worker的真实后端操作。重复项仅用登记的getByTestId("cleanup-item")结合完整URL文本filter限定父项，再定位登记的子testId；不使用自造选择器。
- finally在context仍存活时先恢复apiBaseUrl、清理extension storage并真实POST /api/__test__/reset清理后端；用嵌套finally保证上述恢复或清理失败也会关闭popup和persistent context。本文为设计要求；不启动浏览器，不生成运行证据。

步骤：

- S1：真实POST /api/__test__/reset；按D-01整体平移resource.json的history.lastVisitTime，使最新一条=本例导入时刻T−5分钟，通过真实POST /api/sync导入activeTab/openTabs/history；确认200、pageCount=10。
- S2：打开popup并点击tab-cleanup，确认重复组已渲染；保持popup打开，真实POST /api/__test__/reset，直接读取health.pageCount=0。
- S3：在cleanup-group-merge内用getByTestId("cleanup-item").filter({hasText:"https://github.com/org/repo/issues/123?tab=comments"})限定尚未刷新的父项，实际点击其cleanup-merge-button，捕获真实merge请求响应。
- S4：等待自动重拉cleanup；真实GET /api/health、GET /api/pages/ranked?limit=500和GET /api/pages/cleanup-suggestions；读取lastCleanupAction。

预期：

- E1：UI发出的merge请求keepUrl=https://github.com/org/repo/issues/123，urls包含该URL与https://github.com/org/repo/issues/123?tab=comments。
- E2：merge响应status=404、body.error.code="NOT_FOUND"、error.message="页面不存在"且非空。
- E3：cleanup-action-error文本包含「建议已失效，已刷新列表」。
- E4：失败后真实cleanup GET重新调用，cleanup-empty可见，cleanup-item数量=0。
- E5：失败后health.pageCount=0、ranked.pages=[]、cleanup.suggestions=[]，未新建keepUrl或query页面。
- E6：失败后lastCleanupAction不存在，cleanup-undo-button不可见。

证据要求：

- 执行后在evidence/TC-UI-CLEAN-009/保存result.json、api/请求与响应（真实status/error/request id）、server.log、extension.log、screenshots/、flow.gif及explore.json。
- 每个[En]在脚本中至少对应一个断言；关键点击前后截图，保留故障前后storage读回及真实接口状态变化。设计状态DESIGNED / NOT RUN，本阶段不写执行证据。

### TC-UI-CLEAN-010 无缓存且后端不可达：首页和整理页显示错误与诊断入口

- ID：TC-UI-CLEAN-010
- 类型：UI；模块：CLEAN
- 优先级：P1；类别：exception；技术：state-transition
- 关联Feature：F-CLEAN-07
- acceptanceRefs：F-CLEAN-07#AC1
- 关联Code：C-FE-CLEAN-01、C-FE-CLEAN-03、C-FE-CLEAN-04
- 测试数据：先真实样例与两规则建立2/1/1基线；故障清掉cache并将apiBaseUrl设为http://127.0.0.1:9。错误根据前端方案§5.6/§8及FE-API-05；网络错误无HTTP响应，不伪造HTTP状态码。

前置条件：

- 本例独立启动 ENABLE_TEST_API=1 的真实测试后端（TEST_PORT）和 channel=chromium 的 MV3 插件 persistent context；取得 service worker 后 chrome.storage.local.clear()，设置 apiBaseUrl=http://127.0.0.1:<TEST_PORT>。每例自行 reset，不依赖其他用例。
- popup 作为 chrome-extension://<extId>/popup/popup.html tab 打开；仅 route 外部站点，禁止 route 后端、localhost 或127.0.0.1。旧页面通过真实POST /api/sync导入，不用history.addUrl伪造旧访问。
- 在UI点击前注册 context 请求/响应监听，记录service worker的真实后端操作。重复项仅用登记的getByTestId("cleanup-item")结合完整URL文本filter限定父项，再定位登记的子testId；不使用自造选择器。
- finally在context仍存活时先恢复apiBaseUrl、清理extension storage并真实POST /api/__test__/reset清理后端；用嵌套finally保证上述恢复或清理失败也会关闭popup和persistent context。本文为设计要求；不启动浏览器，不生成运行证据。

步骤：

- S1：真实POST /api/__test__/reset；按D-01整体平移resource.json的history.lastVisitTime，使最新一条=本例导入时刻T−5分钟，通过真实POST /api/sync导入activeTab/openTabs/history；确认200、pageCount=10。
- S2：真实POST /api/rules保存 [{rawText:"把 7 天没访问过的 GitHub issue 建议归档",type:"archive_candidate",domain:"github.com",urlPattern:"/issues/",inactiveDays:7,action:"suggest_archive",enabled:true},{rawText:"docs.internal.com 的页面永远不要归档",type:"never_archive",domain:"docs.internal.com",action:"keep",enabled:true}]；确认201，记录本次响应正式id，后续ruleId关联使用该响应而非写死id。
- S3：打开popup首页读取摘要2/1/1；关闭popup，在SW移除cache并设置apiBaseUrl="http://127.0.0.1:9"，后端保持运行。
- S4：重新打开popup首页，等待网络错误；读home-cleanup-error及其error-diag-link；点击tab-cleanup，读cleanup-error及其error-diag-link。
- S5：经原始TEST_PORT直接GET /api/pages/cleanup-suggestions与GET /api/health比较数据；finally关闭popup后恢复地址并清理storage和后端。

预期：

- E1：故障前home-cleanup三计数分别为「归档 2」「重复 1」「保留 1」。
- E2：故障后home-cleanup-error可见，文本包含「无法连接后端 http://127.0.0.1:9」，其子error-diag-link文本为「诊断」。
- E3：故障后cleanup-error可见，文本包含「无法连接后端 http://127.0.0.1:9」，其子error-diag-link文本为「诊断」。
- E4：无缓存故障时home-cleanup-empty与cleanup-empty不可见，不把失败解释为空库。
- E5：storage.connection.status="offline"、lastErrorCode="BACKEND_UNREACHABLE"；网络故障没有后端HTTP状态码。
- E6：真实TEST_PORT回读health.pageCount=10、ruleCount=2，cleanup.summary={archive:2,merge:1,keep:1}。

证据要求：

- 执行后在evidence/TC-UI-CLEAN-010/保存result.json、api/请求与响应（真实status/error/request id）、server.log、extension.log、screenshots/、flow.gif及explore.json。
- 每个[En]在脚本中至少对应一个断言；关键点击前后截图，保留故障前后storage读回及真实接口状态变化。设计状态DESIGNED / NOT RUN，本阶段不写执行证据。

### TC-UI-CLEAN-011 有缓存且归档请求不可达：保留离线建议，恢复连接后实际归档成功

- ID：TC-UI-CLEAN-011
- 类型：UI；模块：CLEAN
- 优先级：P1；类别：exception；技术：state-transition
- 关联Feature：F-CLEAN-07、F-CLEAN-08
- acceptanceRefs：F-CLEAN-07#AC1、F-CLEAN-08#AC1
- 关联Code：C-FE-CLEAN-01、C-FE-CLEAN-02、C-FE-CLEAN-03、C-FE-CLEAN-04、C-FE-CLEAN-05
- 测试数据：D-01样例与两规则通过真实请求产生cache.cleanup；目标https://github.com/org/repo/issues/100。故障端口9；恢复阶段保持同一popup打开不重开，避免自动恢复同步覆盖样例。离线提示HH:mm从实际cache.cachedAt按浏览器本地时区计算。

前置条件：

- 本例独立启动 ENABLE_TEST_API=1 的真实测试后端（TEST_PORT）和 channel=chromium 的 MV3 插件 persistent context；取得 service worker 后 chrome.storage.local.clear()，设置 apiBaseUrl=http://127.0.0.1:<TEST_PORT>。每例自行 reset，不依赖其他用例。
- popup 作为 chrome-extension://<extId>/popup/popup.html tab 打开；仅 route 外部站点，禁止 route 后端、localhost 或127.0.0.1。旧页面通过真实POST /api/sync导入，不用history.addUrl伪造旧访问。
- 在UI点击前注册 context 请求/响应监听，记录service worker的真实后端操作。重复项仅用登记的getByTestId("cleanup-item")结合完整URL文本filter限定父项，再定位登记的子testId；不使用自造选择器。
- finally在context仍存活时先恢复apiBaseUrl、清理extension storage并真实POST /api/__test__/reset清理后端；用嵌套finally保证上述恢复或清理失败也会关闭popup和persistent context。本文为设计要求；不启动浏览器，不生成运行证据。

步骤：

- S1：真实POST /api/__test__/reset；按D-01整体平移resource.json的history.lastVisitTime，使最新一条=本例导入时刻T−5分钟，通过真实POST /api/sync导入activeTab/openTabs/history；确认200、pageCount=10。
- S2：真实POST /api/rules保存 [{rawText:"把 7 天没访问过的 GitHub issue 建议归档",type:"archive_candidate",domain:"github.com",urlPattern:"/issues/",inactiveDays:7,action:"suggest_archive",enabled:true},{rawText:"docs.internal.com 的页面永远不要归档",type:"never_archive",domain:"docs.internal.com",action:"keep",enabled:true}]；确认201，记录本次响应正式id，后续ruleId关联使用该响应而非写死id。
- S3：打开popup首页确认2/1/1，点击tab-cleanup并等待真实cleanup缓存写入；读取cache.cleanup.data、cachedAt及cache.cachedAt=cacheAt，记录lastCleanupAction不存在；关闭popup。
- S4：保留缓存，SW设置apiBaseUrl="http://127.0.0.1:9"；重新打开popup并点击tab-cleanup，等待网络失败转离线。
- S5：在缓存cleanup-group-archive内用getByTestId("cleanup-item").filter({hasText:"https://github.com/org/repo/issues/100"})限定父项，实际点击cleanup-archive-button；读错误和lastCleanupAction；通过真实TEST_PORT直接回读ranked和cleanup。
- S6：保持同一popup打开，仅在SW恢复apiBaseUrl为真实TEST_PORT；再次实际点击同一目标归档按钮，等待真实archive响应；真实GET /api/pages/ranked?limit=500、GET /api/pages/cleanup-suggestions与POST /api/recommendations/next {currentPage:null,openTabs:[],recentHistory:[]}回读；保存三份响应，不用扩展缓存代替后端结果。

预期：

- E1：故障前首页三计数分别为「归档 2」「重复 1」「保留 1」，cache.cleanup.data.summary={archive:2,merge:1,keep:1}。
- E2：离线后cleanup三组的cleanup-item数量仍为2、1、1；offline-banner-cleanup文本为「以下为 HH:mm 同步时缓存的结果」，HH:mm等于cacheAt在浏览器本地时区的小时分钟。
- E3：离线归档后cleanup-action-error文本包含「无法连接后端 http://127.0.0.1:9」。
- E4：离线归档失败后真实ranked仍含https://github.com/org/repo/issues/100、total=10；真实cleanup仍含该archive建议。
- E5：离线归档失败后lastCleanupAction不存在，cleanup-undo-button不可见。
- E6：恢复后再次UI点击产生archive响应200、affected=1、notFound=0。
- E7：恢复后真实ranked不含https://github.com/org/repo/issues/100且total=9，真实cleanup与recommendations均不含https://github.com/org/repo/issues/100。
- E8：恢复后cleanup-group-archive中https://github.com/org/repo/issues/100的cleanup-item数量=0，cleanup-undo-button可见。

证据要求：

- 执行后在evidence/TC-UI-CLEAN-011/保存result.json、api/请求与响应（真实status/error/request id）、server.log、extension.log、screenshots/、flow.gif及explore.json。
- 每个[En]在脚本中至少对应一个断言；关键点击前后截图，保留故障前后storage读回及真实接口状态变化。设计状态DESIGNED / NOT RUN，本阶段不写执行证据。

### TC-UI-CLEAN-012 点击全部归档：只提交归档组两个URL，重复和保留页面仍存在

- ID：TC-UI-CLEAN-012
- 类型：UI；模块：CLEAN
- 优先级：P1；类别：positive；技术：scenario
- 关联Feature：F-CLEAN-08
- acceptanceRefs：F-CLEAN-08#AC1
- 关联Code：C-FE-CLEAN-01、C-FE-CLEAN-02、C-FE-CLEAN-05
- 测试数据：D-01样例与两规则，archive集合恰为https://github.com/org/repo/issues/100与https://www.google.com/search?q=chrome+extension+manifest+v3；merge与keep不属于批量归档集合，ranked.total由10变8。

前置条件：

- 本例独立启动 ENABLE_TEST_API=1 的真实测试后端（TEST_PORT）和 channel=chromium 的 MV3 插件 persistent context；取得 service worker 后 chrome.storage.local.clear()，设置 apiBaseUrl=http://127.0.0.1:<TEST_PORT>。每例自行 reset，不依赖其他用例。
- popup 作为 chrome-extension://<extId>/popup/popup.html tab 打开；仅 route 外部站点，禁止 route 后端、localhost 或127.0.0.1。旧页面通过真实POST /api/sync导入，不用history.addUrl伪造旧访问。
- 在UI点击前注册 context 请求/响应监听，记录service worker的真实后端操作。重复项仅用登记的getByTestId("cleanup-item")结合完整URL文本filter限定父项，再定位登记的子testId；不使用自造选择器。
- finally在context仍存活时先恢复apiBaseUrl、清理extension storage并真实POST /api/__test__/reset清理后端；用嵌套finally保证上述恢复或清理失败也会关闭popup和persistent context。本文为设计要求；不启动浏览器，不生成运行证据。

步骤：

- S1：真实POST /api/__test__/reset；按D-01整体平移resource.json的history.lastVisitTime，使最新一条=本例导入时刻T−5分钟，通过真实POST /api/sync导入activeTab/openTabs/history；确认200、pageCount=10。
- S2：真实POST /api/rules保存 [{rawText:"把 7 天没访问过的 GitHub issue 建议归档",type:"archive_candidate",domain:"github.com",urlPattern:"/issues/",inactiveDays:7,action:"suggest_archive",enabled:true},{rawText:"docs.internal.com 的页面永远不要归档",type:"never_archive",domain:"docs.internal.com",action:"keep",enabled:true}]；确认201，记录本次响应正式id，后续ruleId关联使用该响应而非写死id。
- S3：打开popup并点击tab-cleanup确认归档组2项，实际点击cleanup-archive-all-button，等待真实POST /api/pages/archive。
- S4：真实GET /api/pages/ranked?limit=500、GET /api/pages/cleanup-suggestions与POST /api/recommendations/next {currentPage:null,openTabs:[],recentHistory:[]}回读；保存三份响应，不用扩展缓存代替后端结果。

预期：

- E1：全部归档点击发出urls集合恰为https://github.com/org/repo/issues/100与https://www.google.com/search?q=chrome+extension+manifest+v3，不含issues/123两个变体或https://docs.internal.com/ai-agent-design。
- E2：真实archive响应200、affected=2、notFound=0。
- E3：真实ranked.total=8，pages不含两条归档URL。
- E4：真实ranked.pages仍包含https://github.com/org/repo/issues/123、https://github.com/org/repo/issues/123?tab=comments与https://docs.internal.com/ai-agent-design。
- E5：真实cleanup.summary={archive:0,merge:1,keep:1}，suggestions不含两条归档URL。
- E6：真实recommendations不含两条归档URL；cleanup-group-archive内cleanup-item数量=0。

证据要求：

- 执行后在evidence/TC-UI-CLEAN-012/保存result.json、api/请求与响应（真实status/error/request id）、server.log、extension.log、screenshots/、flow.gif及explore.json。
- 每个[En]在脚本中至少对应一个断言；关键点击前后截图，保留故障前后storage读回及真实接口状态变化。设计状态DESIGNED / NOT RUN，本阶段不写执行证据。

## Feature → Case → AC/类别覆盖表

| Feature | AC | Case与类别 | waiver |
|---|---|---|---|
| F-CLEAN-07 | AC1 | TC-UI-CLEAN-001（positive）；TC-UI-CLEAN-010（exception）；TC-UI-CLEAN-011（exception） | 无 |
| F-CLEAN-07 | AC2 | TC-UI-CLEAN-001（positive） | 无 |
| F-CLEAN-07 | AC3 | TC-UI-CLEAN-002（state） | 无 |
| F-CLEAN-08 | AC1 | TC-UI-CLEAN-003（positive）；TC-UI-CLEAN-008（negative）；TC-UI-CLEAN-011（exception）；TC-UI-CLEAN-012（positive） | 无 |
| F-CLEAN-08 | AC2 | TC-UI-CLEAN-003（positive） | 无 |
| F-CLEAN-08 | AC3 | TC-UI-CLEAN-004（positive）；TC-UI-CLEAN-009（negative） | 无 |
| F-CLEAN-08 | AC4 | TC-UI-CLEAN-005（positive）；TC-UI-CLEAN-006（boundary）；TC-UI-CLEAN-007（boundary） | 无 |

## 类别分布统计

统计来源：运行 `node .agents/skills/nav-test-case-design/scripts/check-cases.mjs --json` 后读取 `stats`，本隔离快照只有 UI-CLEAN 分片（`stats.cases=12`、`byType.UI=12`）。以下类别、优先级和技术数量均来自该输出，不代表全项目完成率。

| 模块 | positive | negative | boundary | exception | security | performance | compatibility | state | 合计 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| CLEAN（仅UI分片） | 5 | 2 | 2 | 2 | 0 | 0 | 0 | 1 | 12 |

| 优先级 | 数量 |
|---|---:|
| P0 | 1 |
| P1 | 6 |
| P2 | 5 |

| 技术 | 数量 |
|---|---:|
| scenario | 2 |
| equivalence | 1 |
| state-transition | 5 |
| boundary | 2 |
| error-guessing | 2 |

技能检查 `matrix` 中 F-CLEAN-07 为4条关联用例（positive=1、state=1、exception=2），F-CLEAN-08 为9条关联用例（positive=4、boundary=2、negative=2、exception=1）；两者 `missing=[]`，`waived=[]`。两Feature合计7条AC均覆盖，5个C-FE代码点均有引用；一条用例可关联多个Feature，Feature关联数不等于独立用例总数。

自检口径：模块 validator 原始总错误48条、warning=0，均为此快照未提供的BE/API覆盖；本分片UI相关错误0。直接运行技能check-cases的原始总错误403条、warning=0，来自全项目其余分片/BE/E2E缺失；本分片字段、编号、AC、类别错误0。未修改validator或用waiver消除缺口；最终合并验收以项目目录重新运行的结果为准。本次没有运行12条产品测试。
