# CACHE UI 测试用例分片

> 仅测试设计；本次不生成脚本、不执行产品、不声称产品 PASS。JSON 为本分片结构化来源。

## 范围与配方

本分片只覆盖 CACHE 的 inScope FE Feature；每条独立加载真实插件及真实后端，产品定位只用 ui-contract 登记的 testId。外站 route 离线，禁止 route 后端；history.addUrl 只造当前历史，旧页面通过真实后端样例导入。

所有步骤和预期分别用 Sn/En 编号，后续按一个 Case ID 一个脚本落到 tests/ui/，用 [En] 断言并按 Case ID 留痕。

## TC-UI-CACHE-001 同步成功：五类结果及顶层时间全部写入真实本地缓存

- 类型：UI；优先级：P1；类别：positive；技术：scenario
- Feature：F-CACHE-01
- AC：F-CACHE-01#AC1
- Code：C-FE-CORE-05、C-FE-CACHE-01

### 前置条件

- 每条独立使用全新的持久化 Chromium profile，通过 channel=chromium 加载真实 extension/；先 POST /api/__test__/reset 并清空 chrome.storage.local 与 chrome.history，设置 apiBaseUrl 为本例真实测试后端；不引用或依赖其他用例。
- popup 以 chrome-extension://<extId>/popup/popup.html 的 tab 打开；产品元素只用 getByTestId 定位。所有 http(s) 外站导航先 route 离线 fulfill；不 route、mock 或改写后端 /api、localhost、127.0.0.1 的请求/响应。
- BrowserContext request/response 事件被动观察真实 service worker 请求并按 origin、method、path 归集；不拦截请求。首次打开 popup 的后台请求与点击同步/恢复区间分别计数，等待响应和 storage 写入完成。
- 前置步骤只保留本例声明的普通标签页，关闭其他业务页；设置 connection.status=online、recoverPending=false 并清除旧 syncState，避免初始化自动恢复污染手动同步计数；每条结束关闭 popup、标签页与持久化 context。
- 本例独立通过api.loadSample()按D-01将样例最新时间平移至导入时刻-5分钟，再真实POST /api/sync导入旧页面；不能用history.addUrl造旧时间。普通当前页固定https://example.com/docs，经外站route离线打开后清历史，再history.addUrl只造本例新历史。

### 测试数据

样例只含旧数据，真实同步会刷新isOpen快照；与同轮真实响应深度比较，不猜测样例最新排序。T0/T1取浏览器Date.now同一时钟。

### 步骤

- S1：从点击前开始被动记录真实后端响应，点击sync-button并等待成功与全部刷新落盘；记录点击前T0和刷新后T1。
- S2：读取chrome.storage.local.cache，逐一与本轮真实GET ranked、POST recommendations、GET cleanup、GET rules、GET config的响应数据核对。

### 预期

- E1：cache同时具有ranked、recommendations、cleanup、rules、config和顶层cachedAt；ranked/cleanup/rules/config均为包含data和cachedAt的对象。
- E2：cache.recommendations["https://example.com/docs"]为包含data和cachedAt的对象；缓存键使用去hash普通当前URL，不是将recommendations误当单个{data,cachedAt}。
- E3：五类缓存data分别等于本轮对应真实接口的成功响应体；ranked.data.pages和cleanup.data.suggestions为数组，rules.data.rules=[]。
- E4：各缓存项和顶层cachedAt均为T0至T1范围内的正整数毫秒时间戳。
- E5：sync-status data-status="success"。

### 证据

- 执行时保存 evidence/<CaseID>/result.json、api/ 请求与真实响应、server.log、extension.log、关键步骤 screenshots/ 与 flow.gif；这是后续执行留痕要求，本次只交付用例设计。

## TC-UI-CACHE-002 已有缓存且后端更新：首屏先展示 A、真实网络完成后展示 B

- 类型：UI；优先级：P1；类别：positive；技术：state-transition
- Feature：F-CACHE-01
- AC：F-CACHE-01#AC2
- Code：C-FE-CORE-05、C-FE-CACHE-01、C-FE-CACHE-04

### 前置条件

- 每条独立使用全新的持久化 Chromium profile，通过 channel=chromium 加载真实 extension/；先 POST /api/__test__/reset 并清空 chrome.storage.local 与 chrome.history，设置 apiBaseUrl 为本例真实测试后端；不引用或依赖其他用例。
- popup 以 chrome-extension://<extId>/popup/popup.html 的 tab 打开；产品元素只用 getByTestId 定位。所有 http(s) 外站导航先 route 离线 fulfill；不 route、mock 或改写后端 /api、localhost、127.0.0.1 的请求/响应。
- BrowserContext request/response 事件被动观察真实 service worker 请求并按 origin、method、path 归集；不拦截请求。首次打开 popup 的后台请求与点击同步/恢复区间分别计数，等待响应和 storage 写入完成。
- 前置步骤只保留本例声明的普通标签页，关闭其他业务页；设置 connection.status=online、recoverPending=false 并清除旧 syncState，避免初始化自动恢复污染手动同步计数；每条结束关闭 popup、标签页与持久化 context。
- 本例独立通过api.loadSample()按D-01将样例最新时间平移至导入时刻-5分钟，再真实POST /api/sync导入旧页面；不能用history.addUrl造旧时间。普通当前页固定https://example.com/docs，经外站route离线打开后清历史，再history.addUrl只造本例新历史。
- 先在线打开popup并点击sync-button等成功，等待ranked、recommendations[普通当前URL]、cleanup、rules、config及顶层cachedAt全部写入，读取完整缓存A；仅准备有明确差异的数据，不依赖其他用例。
- 关闭popup但保持普通当前页与推荐key不变；后端通过真实API新增非打开高分页 https://example.org/fresh（title=Fresh B，visitCount=100），并对A中一条archive建议的URL执行真实POST /api/pages/archive，形成B。
- 用真实接口预读B，只比较业务展示投影以确认排序、推荐、整理均与A不同且A/B推荐均非空；预读响应中的generatedAt、createdAt不作为后续缓存的固定值。数据不满足时本例前置构造失败，不可把A=B计通过。确认cache仍为A、connection在线且recoverPending=false，避免自动恢复同步改写B。

### 测试数据

A为本例真实同步保存的非空缓存；预读B通过新增https://example.org/fresh（title=Fresh B、visitCount=100、lastVisitTime=本例当前时间）并归档A中的一条旧建议URL构造。首页排序签名取前5项ranked-item-url/title/score，推荐签名仅取前3项rec-item-title/score/reason（rec-item是button，不假定href），整理签名取home-cleanup-archive-count/merge-count/keep-count。预读阶段只比较业务投影；最终UI和cache均以本轮实际B′响应为准，推荐与整理的generatedAt/createdAt不能跨请求写死。

### 步骤

- S1：在popup.goto之前通过addInitScript安装MutationObserver，仅按契约testId记录完整业务数据签名、记录序号和performance.now；不修改应用或请求；首页监听home-ranked-list、rec-list、home-cleanup-summary及其已登记子元素。
- S2：打开popup首页，记录各区块第一个完整且非loading的数据快照A，同时保存本次popup后台刷新实际收到的成功响应B′；排除空容器/加载骨架，三个区块分别记录，不能只看最终状态。
- S3：等刷新完成后点击tab-ranked、tab-cleanup，分别检查最新B；读取更新后的cache并保存有序DOM快照序列。

### 预期

- E1：首页的排序、推荐、整理三个区块的第一个完整非loading业务数据签名分别等于A对应结果，之后各至少出现1次本轮实际刷新响应B′的签名，A记录序号均小于B′；不允许B′→A→B′冒充缓存首屏。
- E2：刷新后排序页ranked-item-url顺序及ranked-item-title/score等于本轮实际B′.ranked的展示投影（score保留两位小数），包含https://example.org/fresh和标题「Fresh B」。
- E3：刷新后整理页cleanup-item-url与cleanup-item的data-action集合等于本轮实际B′.cleanup的展示投影，被归档的旧建议URL不再出现。
- E4：刷新后的相关cache.data逐一深度等于本轮popup实际收到的对应B′响应体（包括其generatedAt/createdAt），cachedAt不早于A；不与预读B的时间字段比较。
- E5：观察区间的真实网络响应均来自测试后端，POST /api/sync次数=0。

### 证据

- 执行时保存 evidence/<CaseID>/result.json、api/ 请求与真实响应、server.log、extension.log、关键步骤 screenshots/ 与 flow.gif；这是后续执行留痕要求，本次只交付用例设计。

## TC-UI-CACHE-003 已有缓存后连接拒绝：三个红色时间横幅与离线数据均等于缓存

- 类型：UI；优先级：P1；类别：exception；技术：state-transition
- Feature：F-CACHE-01、F-CACHE-02
- AC：F-CACHE-01#AC2、F-CACHE-02#AC1
- Code：C-FE-CORE-03、C-FE-CACHE-01、C-FE-CACHE-02、C-FE-CACHE-04

### 前置条件

- 每条独立使用全新的持久化 Chromium profile，通过 channel=chromium 加载真实 extension/；先 POST /api/__test__/reset 并清空 chrome.storage.local 与 chrome.history，设置 apiBaseUrl 为本例真实测试后端；不引用或依赖其他用例。
- popup 以 chrome-extension://<extId>/popup/popup.html 的 tab 打开；产品元素只用 getByTestId 定位。所有 http(s) 外站导航先 route 离线 fulfill；不 route、mock 或改写后端 /api、localhost、127.0.0.1 的请求/响应。
- BrowserContext request/response 事件被动观察真实 service worker 请求并按 origin、method、path 归集；不拦截请求。首次打开 popup 的后台请求与点击同步/恢复区间分别计数，等待响应和 storage 写入完成。
- 前置步骤只保留本例声明的普通标签页，关闭其他业务页；设置 connection.status=online、recoverPending=false 并清除旧 syncState，避免初始化自动恢复污染手动同步计数；每条结束关闭 popup、标签页与持久化 context。
- 本例独立通过api.loadSample()按D-01将样例最新时间平移至导入时刻-5分钟，再真实POST /api/sync导入旧页面；不能用history.addUrl造旧时间。普通当前页固定https://example.com/docs，经外站route离线打开后清历史，再history.addUrl只造本例新历史。
- 先在线打开popup并点击sync-button等成功，等待ranked、recommendations[普通当前URL]、cleanup、rules、config及顶层cachedAt全部写入，读取完整缓存A；仅准备有明确差异的数据，不依赖其他用例。

### 测试数据

port9无服务；严格比较已缓存API结果的UI投影，不重新运行服务端算法。推荐key始终为https://example.com/docs；H不是硬编码当前时分。

### 步骤

- S1：关闭popup并保存完整缓存A，将apiBaseUrl改为http://127.0.0.1:9；重开popup等待真实连接失败。将A.cachedAt按浏览器本地时区格式化为HH:mm，记作H。
- S2：依次读取首页、点击tab-ranked、tab-cleanup；在各页分别读取offline-banner-home、offline-banner-ranked、offline-banner-cleanup、数据与computedStyle。
- S3：全部失败请求settle后重新读取cache与connection，核对失败未覆盖缓存。

### 预期

- E1：三个横幅在各自页可见，文本均恰为「以下为 H 同步时缓存的结果」，H由本例A.cachedAt格式化得到。
- E2：三个横幅computedStyle均有可见的红色文字或红色背景（alpha>0、红通道大于绿蓝通道），不以仅存在testId代替红色断言。
- E3：首页排序前5项、推荐前3项和整理summary分别等于A对应结果的展示投影；排序页完整URL顺序和整理页cleanup-item-url集合及cleanup-item的data-action也等于A。建议key仅在API/cache中核对，不假定DOM有data-key。
- E4：失败后cache与A深度相等（包括各cachedAt），没有用空网络结果清除已显示的缓存。
- E5：connection.status="offline"、recoverPending=true。

### 证据

- 执行时保存 evidence/<CaseID>/result.json、api/ 请求与真实响应、server.log、extension.log、关键步骤 screenshots/ 与 flow.gif；这是后续执行留痕要求，本次只交付用例设计。

## TC-UI-CACHE-004 无缓存且后端不可达：首页提示及诊断入口可用、上下文仍可读

- 类型：UI；优先级：P1；类别：exception；技术：error-guessing
- Feature：F-CACHE-02
- AC：F-CACHE-02#AC3
- Code：C-FE-CORE-03、C-FE-CACHE-01、C-FE-CACHE-02

### 前置条件

- 每条独立使用全新的持久化 Chromium profile，通过 channel=chromium 加载真实 extension/；先 POST /api/__test__/reset 并清空 chrome.storage.local 与 chrome.history，设置 apiBaseUrl 为本例真实测试后端；不引用或依赖其他用例。
- popup 以 chrome-extension://<extId>/popup/popup.html 的 tab 打开；产品元素只用 getByTestId 定位。所有 http(s) 外站导航先 route 离线 fulfill；不 route、mock 或改写后端 /api、localhost、127.0.0.1 的请求/响应。
- BrowserContext request/response 事件被动观察真实 service worker 请求并按 origin、method、path 归集；不拦截请求。首次打开 popup 的后台请求与点击同步/恢复区间分别计数，等待响应和 storage 写入完成。
- 前置步骤只保留本例声明的普通标签页，关闭其他业务页；设置 connection.status=online、recoverPending=false 并清除旧 syncState，避免初始化自动恢复污染手动同步计数；每条结束关闭 popup、标签页与持久化 context。
- 从空profile开始，apiBaseUrl=http://127.0.0.1:9且cache整个key不存在，不执行在线同步。

### 测试数据

history-one=https://example.com/history-one；history只用addUrl造当前访问，不指定旧时间或次数。每区块单独scope error-diag-link，避免重复testId的strict-mode歧义。

### 步骤

- S1：离线打开普通https://example.com/docs后清历史，再chrome.history.addUrl新增https://example.com/history-one；激活docs，打开popup首页并等真实请求失败。
- S2：读取rec-error、home-ranked-error、home-cleanup-error与其内的error-diag-link；点击其中一个入口核验tab-diag。
- S3：点击tab-home核验home-rule-parse-button禁用，再点击tab-rules核验rule-offline-hint，然后点击tab-context读取标签与历史；读取local cache。

### 预期

- E1：rec-error、home-ranked-error、home-cleanup-error均可见且包含「后端未连接」，每个区块内的error-diag-link文本含「诊断」。
- E2：点击区块内error-diag-link后tab-diag的aria-selected="true"。
- E3：首页home-rule-parse-button禁用；切到规则页签后rule-offline-hint可见且含「后端未连接，暂时无法解析」。
- E4：context-tab-url只含docs，context-history-url只含history-one；context-error不可见，说明浏览器上下文不依赖后端。
- E5：offline-banner-home不可见（没有cachedAt不得伪造缓存时间），cache不存在，失败未产生伪造的data或cachedAt。

### 证据

- 执行时保存 evidence/<CaseID>/result.json、api/ 请求与真实响应、server.log、extension.log、关键步骤 screenshots/ 与 flow.gif；这是后续执行留痕要求，本次只交付用例设计。

## TC-UI-CACHE-005 真实离线后恢复：自动同步精确一次、再次打开不重复同步

- 类型：UI；优先级：P1；类别：positive；技术：state-transition
- Feature：F-CACHE-02
- AC：F-CACHE-02#AC2
- Code：C-FE-CORE-03、C-FE-CACHE-01、C-FE-CACHE-02、C-FE-CACHE-03

### 前置条件

- 每条独立使用全新的持久化 Chromium profile，通过 channel=chromium 加载真实 extension/；先 POST /api/__test__/reset 并清空 chrome.storage.local 与 chrome.history，设置 apiBaseUrl 为本例真实测试后端；不引用或依赖其他用例。
- popup 以 chrome-extension://<extId>/popup/popup.html 的 tab 打开；产品元素只用 getByTestId 定位。所有 http(s) 外站导航先 route 离线 fulfill；不 route、mock 或改写后端 /api、localhost、127.0.0.1 的请求/响应。
- BrowserContext request/response 事件被动观察真实 service worker 请求并按 origin、method、path 归集；不拦截请求。首次打开 popup 的后台请求与点击同步/恢复区间分别计数，等待响应和 storage 写入完成。
- 前置步骤只保留本例声明的普通标签页，关闭其他业务页；设置 connection.status=online、recoverPending=false 并清除旧 syncState，避免初始化自动恢复污染手动同步计数；每条结束关闭 popup、标签页与持久化 context。
- 本例独立通过api.loadSample()按D-01将样例最新时间平移至导入时刻-5分钟，再真实POST /api/sync导入旧页面；不能用history.addUrl造旧时间。普通当前页固定https://example.com/docs，经外站route离线打开后清历史，再history.addUrl只造本例新历史。
- 先在线打开popup并点击sync-button等成功，等待ranked、recommendations[普通当前URL]、cleanup、rules、config及顶层cachedAt全部写入，读取完整缓存A；仅准备有明确差异的数据，不依赖其他用例。

### 测试数据

计数只含origin=真实后端且method=POST/path=/api/sync，剔除前置同步与GET重试。必须先真实经历失败置recoverPending，不能只手写该标记冒充恢复；不能仅靠HTTP200或lastSuccessAt推断次数。

### 步骤

- S1：关闭popup，改apiBaseUrl为端口9并重开，等真实请求失败、connection.recoverPending=true且离线横幅可见；关闭popup，保存旧lastSuccessAt与真实health.lastSyncAt。
- S2：在改回可用base之前开始独立计数真实POST /api/sync；恢复base并重开popup，不点击sync-button；等待自动同步成功、全部刷新和恢复相关消息结束。
- S3：检查storage、真实GET /api/health与三页横幅；关闭并再次打开popup，等RECOVER_IF_NEEDED及cache-first所有网络请求settle，继续同一计数器。

### 预期

- E1：第一次恢复窗口内真实POST /api/sync恰好1次。
- E2：syncState.status="success"、trigger="auto"，lastSuccessAt晚于离线前记录。
- E3：connection.recoverPending=false，connection.status="online"。
- E4：真实health.lastSyncAt等于该次同步响应syncedAt。
- E5：offline-banner-home、offline-banner-ranked、offline-banner-cleanup在对应页均不可见。
- E6：恢复后各区块展示投影等于本轮popup实际收到的对应成功响应。
- E7：第二次重开且所有恢复/刷新消息settle后，累计POST /api/sync仍为1次，lastSuccessAt与第一次恢复成功后的值相同。

### 证据

- 执行时保存 evidence/<CaseID>/result.json、api/ 请求与真实响应、server.log、extension.log、关键步骤 screenshots/ 与 flow.gif；这是后续执行留痕要求，本次只交付用例设计。

## TC-UI-CACHE-006 空集合与无缓存边界：已缓存的空结果离线显示空态及缓存时间

- 类型：UI；优先级：P2；类别：boundary；技术：boundary
- Feature：F-CACHE-01、F-CACHE-02
- AC：F-CACHE-01#AC1、F-CACHE-02#AC1
- Code：C-FE-CORE-05、C-FE-CACHE-01、C-FE-CACHE-02

### 前置条件

- 每条独立使用全新的持久化 Chromium profile，通过 channel=chromium 加载真实 extension/；先 POST /api/__test__/reset 并清空 chrome.storage.local 与 chrome.history，设置 apiBaseUrl 为本例真实测试后端；不引用或依赖其他用例。
- popup 以 chrome-extension://<extId>/popup/popup.html 的 tab 打开；产品元素只用 getByTestId 定位。所有 http(s) 外站导航先 route 离线 fulfill；不 route、mock 或改写后端 /api、localhost、127.0.0.1 的请求/响应。
- BrowserContext request/response 事件被动观察真实 service worker 请求并按 origin、method、path 归集；不拦截请求。首次打开 popup 的后台请求与点击同步/恢复区间分别计数，等待响应和 storage 写入完成。
- 前置步骤只保留本例声明的普通标签页，关闭其他业务页；设置 connection.status=online、recoverPending=false 并清除旧 syncState，避免初始化自动恢复污染手动同步计数；每条结束关闭 popup、标签页与持久化 context。
- 后端reset为pageCount=0/ruleCount=0；浏览器仅保留about:blank或chrome://newtab/与popup，没有http(s)普通业务标签，history为空；不导入样例。

### 测试数据

0条是合法数据边界；系统页不计filtered，不能用不存在的缓存替代有效空缓存。无旧页面输入，时间基准无边界漂移。

### 步骤

- S1：打开popup并点击sync-button，观察真实请求activeTab=null/openTabs=[]/history=[]及成功；等五类空结果写入cache，保存A。
- S2：关闭popup并改base到端口9，重开并分别查看首页、排序、整理；读取空态、横幅与真实缓存。

### 预期

- E1：在线同步响应status=200、received=0、pageCount=0。
- E2：cache.ranked.data.pages=[]、cache.cleanup.data.suggestions=[]、cache.rules.data.rules=[]。
- E3：cache.recommendations.__none__.data.recommendations=[]。
- E4：各cache项、顶层cachedAt均为正整数，空集合不等于缺失缓存。
- E5：离线时home-ranked-empty、rec-empty、home-cleanup-empty、ranked-empty、cleanup-empty在对应页可见，错误态home-ranked-error/rec-error/home-cleanup-error不可见。
- E6：offline-banner-home、offline-banner-ranked、offline-banner-cleanup在各自页可见且时间取A.cachedAt，数据仍为空、cache与A深度相等。

### 证据

- 执行时保存 evidence/<CaseID>/result.json、api/ 请求与真实响应、server.log、extension.log、关键步骤 screenshots/ 与 flow.gif；这是后续执行留痕要求，本次只交付用例设计。

## TC-UI-CACHE-007 离线筛选反例：不冒用默认缓存，清除筛选后恢复默认缓存

- 类型：UI；优先级：P2；类别：negative；技术：decision-table
- Feature：F-CACHE-01、F-CACHE-02
- AC：F-CACHE-01#AC1、F-CACHE-02#AC1
- Code：C-FE-CORE-03、C-FE-CACHE-01

### 前置条件

- 每条独立使用全新的持久化 Chromium profile，通过 channel=chromium 加载真实 extension/；先 POST /api/__test__/reset 并清空 chrome.storage.local 与 chrome.history，设置 apiBaseUrl 为本例真实测试后端；不引用或依赖其他用例。
- popup 以 chrome-extension://<extId>/popup/popup.html 的 tab 打开；产品元素只用 getByTestId 定位。所有 http(s) 外站导航先 route 离线 fulfill；不 route、mock 或改写后端 /api、localhost、127.0.0.1 的请求/响应。
- BrowserContext request/response 事件被动观察真实 service worker 请求并按 origin、method、path 归集；不拦截请求。首次打开 popup 的后台请求与点击同步/恢复区间分别计数，等待响应和 storage 写入完成。
- 前置步骤只保留本例声明的普通标签页，关闭其他业务页；设置 connection.status=online、recoverPending=false 并清除旧 syncState，避免初始化自动恢复污染手动同步计数；每条结束关闭 popup、标签页与持久化 context。
- 本例独立通过api.loadSample()按D-01将样例最新时间平移至导入时刻-5分钟，再真实POST /api/sync导入旧页面；不能用history.addUrl造旧时间。普通当前页固定https://example.com/docs，经外站route离线打开后清历史，再history.addUrl只造本例新历史。
- 先在线打开popup并点击sync-button等成功，等待ranked、recommendations[普通当前URL]、cleanup、rules、config及顶层cachedAt全部写入，读取完整缓存A；仅准备有明确差异的数据，不依赖其他用例。
- A.ranked.data.domains包含github.com等至少2个域；使用GET_RANKED默认limit=50、openOnly=false、domain为空生成A，筛选结果不得写入默认cache.ranked。

### 测试数据

离线筛选属于契约GET_RANKED明确NO_CACHE分支；通过产品筛选控件触发并被动观察消息，禁止route后端制造4xx。该反例防止cache误用，不替代本模块三页离线正例。

### 步骤

- S1：保存A.ranked，关闭popup并把base改到端口9后重开tab-ranked，确认默认离线列表读取A。
- S2：点击ranked-filter-open开启筛选，记录GET_RANKED消息结果；再关闭open筛选并在ranked-filter-domain选择github.com，分别观察错误提示和缓存。
- S3：清除全部筛选（openOnly=false、domain空），等待默认缓存视图返回，读取cache.ranked。

### 预期

- E1：openOnly=true和domain=github.com两个子场景的GET_RANKED结果均为ok=false、error.code="NO_CACHE"、error.message="筛选需要在线"；ranked-filter-offline-hint文本含「筛选需要在线」。
- E2：openOnly子场景的ranked-filter-open保持aria-pressed="true"且enabled；domain子场景的ranked-filter-domain保持value="github.com"且enabled，错误后仍可修改筛选。
- E3：两个失败子场景cache.ranked均与A.ranked深度相等。
- E4：清空筛选后ranked-filter-offline-hint不可见，ranked-item-url顺序等于A.ranked.data.pages顺序；cache.ranked的data/cachedAt未被筛选请求覆盖。

### 证据

- 执行时保存 evidence/<CaseID>/result.json、api/ 请求与真实响应、server.log、extension.log、关键步骤 screenshots/ 与 flow.gif；这是后续执行留痕要求，本次只交付用例设计。


## Feature → Case 覆盖

| Feature | AC | Case |
|---|---|---|
| F-CACHE-01 | AC1 | TC-UI-CACHE-001、TC-UI-CACHE-006、TC-UI-CACHE-007 |
| F-CACHE-01 | AC2 | TC-UI-CACHE-002、TC-UI-CACHE-003 |
| F-CACHE-02 | AC1 | TC-UI-CACHE-003、TC-UI-CACHE-006、TC-UI-CACHE-007 |
| F-CACHE-02 | AC2 | TC-UI-CACHE-005 |
| F-CACHE-02 | AC3 | TC-UI-CACHE-004 |

## C-FE → Case 覆盖

| Code | Case |
|---|---|
| C-FE-CORE-03 | TC-UI-CACHE-003、TC-UI-CACHE-004、TC-UI-CACHE-005、TC-UI-CACHE-007 |
| C-FE-CORE-05 | TC-UI-CACHE-001、TC-UI-CACHE-002、TC-UI-CACHE-006 |
| C-FE-CACHE-01 | TC-UI-CACHE-001、TC-UI-CACHE-002、TC-UI-CACHE-003、TC-UI-CACHE-004、TC-UI-CACHE-005、TC-UI-CACHE-006、TC-UI-CACHE-007 |
| C-FE-CACHE-02 | TC-UI-CACHE-003、TC-UI-CACHE-004、TC-UI-CACHE-005、TC-UI-CACHE-006 |
| C-FE-CACHE-03 | TC-UI-CACHE-005 |
| C-FE-CACHE-04 | TC-UI-CACHE-002、TC-UI-CACHE-003 |

## 类别分布统计

以下按本分片 UI Feature/Case 范围调用技能 checkCases 取得 stats 与 matrix；仅是设计统计，完整模块门禁另行运行，不是执行通过率。

| 类别 | 条数 |
|---|---:|
| positive | 3 |
| exception | 2 |
| boundary | 1 |
| negative | 1 |

用例 7 条；UI AC 覆盖 5/5；必需类别缺口 0；waiver 0 条。

优先级分布：{"P1":5,"P2":2}。
