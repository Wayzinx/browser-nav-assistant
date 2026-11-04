# REC API 测试用例设计

> 范围：仅 REC 的 type=API 分片；31 条用例，覆盖 F-REC-01～07 的15条AC；本阶段仅完成设计与静态校验，未执行真实后端HTTP业务。

## 执行约定与判定依据

- 每条用例独立 reset → 真实 POST /api/sync 构造数据 → 调用被测接口；空库用例同步空集合。禁止后端 mock，不访问浏览器。
- 样例 resource.json 只读，整体平移到最新历史=导入前T−5分钟，后续 ?now 使用该次 sync 响应 syncedAt；精确9/10天评分边界使用导入前采样的T。
- 以 PRD §6、§13、D-01/D-07/D-17/D-22 与 api-contract 为准；参考引擎只作数值复算，不能充当HTTP实测结果。数组输入上限500、recentHistory实际使用排序后的前20条。
- acceptanceRefs 将补充边界/负向场景关联到相关AC；下文“直接验收见证”明确列出逐条满足原始Given/When/Then的用例，补充场景不替代这些直接见证。
- 每条 Case 在下一阶段对应独立 tests/api/<CaseID>.spec.mjs；执行留痕放 evidence/<CaseID>/，当前不创建执行证据或测试脚本。

## AC × 类别设计矩阵

| Feature | 正例 | 负向分支/非法输入 | 边界 | 依赖异常 |
|---|---|---|---|---|
| F-REC-01 | 样例完整响应 | 缺字段/类型/JSON/媒体类型/now | 空库、Top5、历史20、数组500/501、正文1MiB | 纯内存接口，明确waiver |
| F-REC-02 | PR→Actions、Issue→PR | 不同仓库不得same_repo | 六候选截断五条 | 纯内存同仓库策略，waiver |
| F-REC-03 | React、MDN文档 | 文档站无同站点候选 | 非内置站点/guide路径 | 纯内存策略，waiver |
| F-REC-04 | a/b同域降序 | 域名不匹配 | 单候选下限 | 纯内存策略，waiver |
| F-REC-05 | 样例排除、最高分去重 | 全已打开、已归档 | 最终0.30保留/0.29排除 | 纯内存策略，waiver |
| F-REC-06 | null、未知域名兜底 | 全候选排除时不凑数 | Top5截断 | 纯内存策略，waiver |
| F-REC-07 | 3个不同React、无目标站搜索 | 2/3、断链、禁用 | dupKey不足3、仅取最新20 | 无外部推荐服务，waiver |

## 用例明细

### TC-API-REC-001 PR 样例返回精确三条推荐并排除当前、打开、重复和待归档页面

- 类型：API ｜ 优先级：P0 ｜ 类别：positive ｜ 技术：equivalence
- Feature：F-REC-01、F-REC-02、F-REC-05
- AC：F-REC-01#AC1、F-REC-02#AC1、F-REC-05#AC1、F-REC-05#AC2
- Code：C-BE-REC-01、C-BE-REC-02、C-BE-REC-06、C-BE-REC-07、C-BE-CORE-09

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用独立 TEST_PORT（API 仲裁建议 4103），不配置 SNAPSHOT_FILE；所有操作为真实 HTTP，不 mock 后端、不导入服务端源码。
- 每条用例独立执行自己的 reset 和数据导入；HTTP 请求附 x-request-id=<本用例ID>-<步骤号>，记录原始请求、响应及 server.log。

测试数据：resource.json 按 D-01 整体平移，最新历史=T−5分钟；sync 响应 N=syncedAt 为读接口 ?now，导入后立即查询。样例 received=14、created=10、updated=4、pageCount=10；PRD §13.4 推荐恰好 Actions/.87、useState/.46、Quick Start/.41。

步骤：

- S1：POST /api/__test__/reset，请求体为 {}，Content-Type: application/json。
- S2：读取只读 resource.json，令 T=Date.now()、delta=T−300000−1710100000000；复制为 samplePayload，将 history 的每个 lastVisitTime 加 delta，activeTab/openTabs 保持样例值；POST /api/sync 发送 samplePayload，记录响应 syncedAt 为 N。
- S3：POST /api/recommendations/next?now=N，Content-Type: application/json，body={currentPage:samplePayload.activeTab,openTabs:samplePayload.openTabs,recentHistory:samplePayload.history}。
- S4：GET /api/health，核对页面数与规则数。

预期：

- E1：S1 返回 200 且 body.ok=true；S2 返回 200，received=14、created=10、updated=4、rejected=0、pageCount=10。
- E2：S3 返回 200，recommendations.length=3，cached=false，generatedAt=N。
- E3：S3 recommendations 的 [url,title,strategy,score] 按序严格等于 [["https://github.com/org/repo/actions","Actions · org/repo","same_repo",0.87],["https://react.dev/reference/react/useState","useState – React","global_top",0.46],["https://react.dev/learn","Quick Start – React","global_top",0.41]]。
- E4：S3 每条 id 为匹配 /^rec_/ 的非空字符串，type="next_visit"，reason 为非空字符串，contextUrl="https://github.com/org/repo/pull/456"，createdAt=N；score 是 number 且 round(score×100)=score×100（容差1e−9），各项 score 非递增且≥0.3。
- E5：S3 第1条 reason 同时包含「PR」和「CI」；其后两条 reason 均为「近期综合评分较高的页面，可作为备选」。
- E6：S3 URL 集合不含 pull/456、issues/123、Fetch_API、docs.internal.com/ai-agent-design、issues/123?tab=comments、issues/100、Google 搜索页这7条样例 URL。
- E7：S4 返回 200，pageCount=10、ruleCount=0，推荐查询没有写入页面或规则。

证据：

- evidence/TC-API-REC-001/api/：全部 HTTP 请求体、响应、状态码及 x-request-id；计算 T/N、动态 ruleId 以步骤日志留存。
- evidence/TC-API-REC-001/server.log 和 result.json；本设计阶段不生成或宣称执行结果。

### TC-API-REC-002 Issue 当前页且请求没有打开页时首推同仓库 PR

- 类型：API ｜ 优先级：P0 ｜ 类别：positive ｜ 技术：equivalence
- Feature：F-REC-02
- AC：F-REC-02#AC2
- Code：C-BE-REC-02、C-BE-REC-07

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用独立 TEST_PORT（API 仲裁建议 4103），不配置 SNAPSHOT_FILE；所有操作为真实 HTTP，不 mock 后端、不导入服务端源码。
- 每条用例独立执行自己的 reset 和数据导入；HTTP 请求附 x-request-id=<本用例ID>-<步骤号>，记录原始请求、响应及 server.log。

测试数据：resource.json 按 D-01 整体平移，最新历史=T−5分钟；sync 响应 N=syncedAt 为读接口 ?now，导入后立即查询。样例 received=14、created=10、updated=4、pageCount=10；PRD §13.4 推荐恰好 Actions/.87、useState/.46、Quick Start/.41。

步骤：

- S1：POST /api/__test__/reset，请求体为 {}，Content-Type: application/json。
- S2：读取只读 resource.json，令 T=Date.now()、delta=T−300000−1710100000000；复制为 samplePayload，将 history 的每个 lastVisitTime 加 delta，activeTab/openTabs 保持样例值；POST /api/sync 发送 samplePayload，记录响应 syncedAt 为 N。
- S3：POST /api/recommendations/next?now=N，Content-Type: application/json，body={currentPage:{url:"https://github.com/org/repo/issues/123"},openTabs:[],recentHistory:[]}。

预期：

- E1：S2 返回 200 且 pageCount=10；S3 返回 200。
- E2：S3 recommendations[0].url="https://github.com/org/repo/pull/456"、strategy="same_repo"、score=0.92，reason 同时包含「Issue」和「PR」。
- E3：S3 不包含当前 issues/123 及其 ?tab=comments 变体。

证据：

- evidence/TC-API-REC-002/api/：全部 HTTP 请求体、响应、状态码及 x-request-id；计算 T/N、动态 ruleId 以步骤日志留存。
- evidence/TC-API-REC-002/server.log 和 result.json；本设计阶段不生成或宣称执行结果。

### TC-API-REC-003 React 文档页首推同站点高频 useState 页面

- 类型：API ｜ 优先级：P0 ｜ 类别：positive ｜ 技术：equivalence
- Feature：F-REC-03
- AC：F-REC-03#AC1
- Code：C-BE-REC-03

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用独立 TEST_PORT（API 仲裁建议 4103），不配置 SNAPSHOT_FILE；所有操作为真实 HTTP，不 mock 后端、不导入服务端源码。
- 每条用例独立执行自己的 reset 和数据导入；HTTP 请求附 x-request-id=<本用例ID>-<步骤号>，记录原始请求、响应及 server.log。

测试数据：resource.json 按 D-01 整体平移，最新历史=T−5分钟；sync 响应 N=syncedAt 为读接口 ?now，导入后立即查询。样例 received=14、created=10、updated=4、pageCount=10；PRD §13.4 推荐恰好 Actions/.87、useState/.46、Quick Start/.41。

步骤：

- S1：POST /api/__test__/reset，请求体为 {}，Content-Type: application/json。
- S2：读取只读 resource.json，令 T=Date.now()、delta=T−300000−1710100000000；复制为 samplePayload，将 history 的每个 lastVisitTime 加 delta，activeTab/openTabs 保持样例值；POST /api/sync 发送 samplePayload，记录响应 syncedAt 为 N。
- S3：POST /api/recommendations/next?now=N，Content-Type: application/json，body={currentPage:{url:"https://react.dev/learn"},openTabs:[],recentHistory:[]}。

预期：

- E1：S3 返回 200，recommendations[0].url="https://react.dev/reference/react/useState"、strategy="same_doc_site"、score=0.76。
- E2：S3 第1条 reason 包含「react.dev」和「6 次」；URL 集合不含当前 https://react.dev/learn。

证据：

- evidence/TC-API-REC-003/api/：全部 HTTP 请求体、响应、状态码及 x-request-id；计算 T/N、动态 ruleId 以步骤日志留存。
- evidence/TC-API-REC-003/server.log 和 result.json；本设计阶段不生成或宣称执行结果。

### TC-API-REC-004 MDN 文档页首推同站点 Fetch API 页面

- 类型：API ｜ 优先级：P0 ｜ 类别：positive ｜ 技术：equivalence
- Feature：F-REC-03
- AC：F-REC-03#AC2
- Code：C-BE-REC-03

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用独立 TEST_PORT（API 仲裁建议 4103），不配置 SNAPSHOT_FILE；所有操作为真实 HTTP，不 mock 后端、不导入服务端源码。
- 每条用例独立执行自己的 reset 和数据导入；HTTP 请求附 x-request-id=<本用例ID>-<步骤号>，记录原始请求、响应及 server.log。

测试数据：resource.json 按 D-01 整体平移，最新历史=T−5分钟；sync 响应 N=syncedAt 为读接口 ?now，导入后立即查询。样例 received=14、created=10、updated=4、pageCount=10；PRD §13.4 推荐恰好 Actions/.87、useState/.46、Quick Start/.41。

步骤：

- S1：POST /api/__test__/reset，请求体为 {}，Content-Type: application/json。
- S2：读取只读 resource.json，令 T=Date.now()、delta=T−300000−1710100000000；复制为 samplePayload，将 history 的每个 lastVisitTime 加 delta，activeTab/openTabs 保持样例值；POST /api/sync 发送 samplePayload，记录响应 syncedAt 为 N。
- S3：POST /api/recommendations/next?now=N，Content-Type: application/json，body={currentPage:{url:"https://developer.mozilla.org/en-US/docs/Web/JavaScript"},openTabs:[],recentHistory:[]}。

预期：

- E1：S3 返回 200，recommendations[0].url="https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API"、strategy="same_doc_site"、score=0.81。
- E2：S3 第1条 reason 包含「developer.mozilla.org」，contextUrl 等于请求的 JavaScript URL。

证据：

- evidence/TC-API-REC-004/api/：全部 HTTP 请求体、响应、状态码及 x-request-id；计算 T/N、动态 ruleId 以步骤日志留存。
- evidence/TC-API-REC-004/server.log 和 result.json；本设计阶段不生成或宣称执行结果。

### TC-API-REC-005 普通站点同域候选按评分排序且理由标明同域名

- 类型：API ｜ 优先级：P0 ｜ 类别：positive ｜ 技术：equivalence
- Feature：F-REC-04
- AC：F-REC-04#AC1
- Code：C-BE-REC-03

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用独立 TEST_PORT（API 仲裁建议 4103），不配置 SNAPSHOT_FILE；所有操作为真实 HTTP，不 mock 后端、不导入服务端源码。
- 每条用例独立执行自己的 reset 和数据导入；HTTP 请求附 x-request-id=<本用例ID>-<步骤号>，记录原始请求、响应及 server.log。

测试数据：仅 news 域名两条历史、均1天前，5/1次；quality=0.76/0.58，final=round2(0.36+0.4×quality)=0.66/0.59。T 在导入前采样，读接口 ?now=T 固定时间。

步骤：

- S1：POST /api/__test__/reset，请求体为 {}，Content-Type: application/json。
- S2：令 T=Date.now()；POST /api/sync，body={activeTab:null,openTabs:[],history:[{url:"https://news.example.org/a",title:"News A",lastVisitTime:T−86400000,visitCount:5},{url:"https://news.example.org/b",title:"News B",lastVisitTime:T−86400000,visitCount:1}]}。
- S3：POST /api/recommendations/next?now=T，body={currentPage:{url:"https://news.example.org/c"},openTabs:[],recentHistory:[]}。

预期：

- E1：S2 返回 200，created=2、pageCount=2。
- E2：S3 返回 200，recommendations 的 [url,strategy,score] 严格依次为 ["https://news.example.org/a","same_domain",0.66]、["https://news.example.org/b","same_domain",0.59]。
- E3：S3 两条 reason 均包含「同域名」；contextUrl 均为 https://news.example.org/c。

证据：

- evidence/TC-API-REC-005/api/：全部 HTTP 请求体、响应、状态码及 x-request-id；计算 T/N、动态 ruleId 以步骤日志留存。
- evidence/TC-API-REC-005/server.log 和 result.json；本设计阶段不生成或宣称执行结果。

### TC-API-REC-006 系统页 null 当前上下文返回全局高分兜底

- 类型：API ｜ 优先级：P0 ｜ 类别：positive ｜ 技术：equivalence
- Feature：F-REC-06
- AC：F-REC-06#AC1
- Code：C-BE-REC-04

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用独立 TEST_PORT（API 仲裁建议 4103），不配置 SNAPSHOT_FILE；所有操作为真实 HTTP，不 mock 后端、不导入服务端源码。
- 每条用例独立执行自己的 reset 和数据导入；HTTP 请求附 x-request-id=<本用例ID>-<步骤号>，记录原始请求、响应及 server.log。

测试数据：resource.json 按 D-01 整体平移，最新历史=T−5分钟；sync 响应 N=syncedAt 为读接口 ?now，导入后立即查询。样例 received=14、created=10、updated=4、pageCount=10；PRD §13.4 推荐恰好 Actions/.87、useState/.46、Quick Start/.41。

步骤：

- S1：POST /api/__test__/reset，请求体为 {}，Content-Type: application/json。
- S2：读取只读 resource.json，令 T=Date.now()、delta=T−300000−1710100000000；复制为 samplePayload，将 history 的每个 lastVisitTime 加 delta，activeTab/openTabs 保持样例值；POST /api/sync 发送 samplePayload，记录响应 syncedAt 为 N。
- S3：POST /api/recommendations/next?now=N，Content-Type: application/json，body={currentPage:null,openTabs:samplePayload.openTabs,recentHistory:[]}。

预期：

- E1：S3 返回 200，recommendations.length=4，URL 按序为 pull/456、react.dev/reference/react/useState、github.com/org/repo/actions、react.dev/learn 对应的完整样例 URL，score 依次为0.56、0.46、0.45、0.41。
- E2：S3 每条 strategy="global_top"，reason="近期综合评分较高的页面，可作为备选"，contextUrl=null。
- E3：S3 不包含样例3条 openTabs 及其 dupKey 相同 URL。

证据：

- evidence/TC-API-REC-006/api/：全部 HTTP 请求体、响应、状态码及 x-request-id；计算 T/N、动态 ruleId 以步骤日志留存。
- evidence/TC-API-REC-006/server.log 和 result.json；本设计阶段不生成或宣称执行结果。

### TC-API-REC-007 未知当前域名仍返回至少一条全局兜底

- 类型：API ｜ 优先级：P0 ｜ 类别：positive ｜ 技术：equivalence
- Feature：F-REC-06
- AC：F-REC-06#AC2
- Code：C-BE-REC-04

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用独立 TEST_PORT（API 仲裁建议 4103），不配置 SNAPSHOT_FILE；所有操作为真实 HTTP，不 mock 后端、不导入服务端源码。
- 每条用例独立执行自己的 reset 和数据导入；HTTP 请求附 x-request-id=<本用例ID>-<步骤号>，记录原始请求、响应及 server.log。

测试数据：resource.json 按 D-01 整体平移，最新历史=T−5分钟；sync 响应 N=syncedAt 为读接口 ?now，导入后立即查询。样例 received=14、created=10、updated=4、pageCount=10；PRD §13.4 推荐恰好 Actions/.87、useState/.46、Quick Start/.41。

步骤：

- S1：POST /api/__test__/reset，请求体为 {}，Content-Type: application/json。
- S2：读取只读 resource.json，令 T=Date.now()、delta=T−300000−1710100000000；复制为 samplePayload，将 history 的每个 lastVisitTime 加 delta，activeTab/openTabs 保持样例值；POST /api/sync 发送 samplePayload，记录响应 syncedAt 为 N。
- S3：POST /api/recommendations/next?now=N，Content-Type: application/json，body={currentPage:{url:"https://unknown.example.net/x"},openTabs:samplePayload.openTabs,recentHistory:[]}。

预期：

- E1：S3 返回 200，recommendations.length=4；第1条 url="https://github.com/org/repo/pull/456"、score=0.56。
- E2：S3 每条 strategy="global_top"、reason="近期综合评分较高的页面，可作为备选"、contextUrl="https://unknown.example.net/x"。

证据：

- evidence/TC-API-REC-007/api/：全部 HTTP 请求体、响应、状态码及 x-request-id；计算 T/N、动态 ruleId 以步骤日志留存。
- evidence/TC-API-REC-007/server.log 和 result.json；本设计阶段不生成或宣称执行结果。

### TC-API-REC-008 保存规则后乱序输入的最近三个不同 React 页面触发 MDN 推荐

- 类型：API ｜ 优先级：P1 ｜ 类别：positive ｜ 技术：scenario
- Feature：F-REC-07
- AC：F-REC-07#AC1
- Code：C-BE-REC-05

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用独立 TEST_PORT（API 仲裁建议 4103），不配置 SNAPSHOT_FILE；所有操作为真实 HTTP，不 mock 后端、不导入服务端源码。
- 每条用例独立执行自己的 reset 和数据导入；HTTP 请求附 x-request-id=<本用例ID>-<步骤号>，记录原始请求、响应及 server.log。

测试数据：resource.json 按 D-01 整体平移，最新历史=T−5分钟；sync 响应 N=syncedAt 为读接口 ?now，导入后立即查询。样例 received=14、created=10、updated=4、pageCount=10；PRD §13.4 推荐恰好 Actions/.87、useState/.46、Quick Start/.41。；规则trigger={domain:react.dev,minCount:3,label:React}、target={domain:developer.mozilla.org,label:MDN}。recentHistory 输入乱序但时间倒序后有3个不同dupKey；这些上下文历史不需新增入库。

步骤：

- S1：POST /api/__test__/reset，请求体为 {}，Content-Type: application/json。
- S2：读取只读 resource.json，令 T=Date.now()、delta=T−300000−1710100000000；复制为 samplePayload，将 history 的每个 lastVisitTime 加 delta，activeTab/openTabs 保持样例值；POST /api/sync 发送 samplePayload，记录响应 syncedAt 为 N。
- S3：POST /api/rules，请求体 {"rules":[{"rawText":"如果我连续看了 3 个 React 文档，推荐相关 MDN 页面","type":"recommend_related","trigger":{"domain":"react.dev","minCount":3,"label":"React"},"target":{"domain":"developer.mozilla.org","label":"MDN"},"action":"recommend","enabled":true,"confidence":"high"}]}；保存返回 rules[0].id 为 ruleId，不预设 id。
- S4：POST /api/recommendations/next?now=N，Content-Type: application/json，body={currentPage:{url:"https://react.dev/learn"},openTabs:[],recentHistory:[{url:"https://react.dev/reference/react/useEffect",lastVisitTime:N−3000},{url:"https://react.dev/learn",lastVisitTime:N−1000},{url:"https://react.dev/reference/react/useState",lastVisitTime:N−2000}]}。

预期：

- E1：S3 返回 201，ruleCount=1，rules[0].id 为非空字符串，enabled=true。
- E2：S4 返回 200，第1条 url="https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API"、strategy="rule"、score=0.90。
- E3：S4 第1条 reason 包含「连续浏览 3 个 React 页面」；请求 openTabs=[]，未排除 MDN 目标页。

证据：

- evidence/TC-API-REC-008/api/：全部 HTTP 请求体、响应、状态码及 x-request-id；计算 T/N、动态 ruleId 以步骤日志留存。
- evidence/TC-API-REC-008/server.log 和 result.json；本设计阶段不生成或宣称执行结果。

### TC-API-REC-009 空库固定 PR 当前页时返回空数组而非错误

- 类型：API ｜ 优先级：P1 ｜ 类别：boundary ｜ 技术：boundary
- Feature：F-REC-01
- AC：F-REC-01#AC3
- Code：C-BE-REC-01、C-BE-REC-07

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用独立 TEST_PORT（API 仲裁建议 4103），不配置 SNAPSHOT_FILE；所有操作为真实 HTTP，不 mock 后端、不导入服务端源码。
- 每条用例独立执行自己的 reset 和数据导入；HTTP 请求附 x-request-id=<本用例ID>-<步骤号>，记录原始请求、响应及 server.log。

测试数据：空集合边界；reset后仍经真实 sync 导入空数据；没有规则，不存在搜索兜底。

步骤：

- S1：POST /api/__test__/reset，请求体为 {}，Content-Type: application/json。
- S2：POST /api/sync，body={activeTab:null,openTabs:[],history:[]}，记录 syncedAt 为 N。
- S3：POST /api/recommendations/next?now=N，Content-Type: application/json，body={currentPage:{url:"https://github.com/org/repo/pull/456"},openTabs:[],recentHistory:[]}。
- S4：GET /api/health，核对页面数与规则数。

预期：

- E1：S2 返回 200，received=0、created=0、pageCount=0。
- E2：S3 返回 200，recommendations=[]、cached=false、generatedAt=N。
- E3：S4 返回 200，pageCount=0、ruleCount=0。

证据：

- evidence/TC-API-REC-009/api/：全部 HTTP 请求体、响应、状态码及 x-request-id；计算 T/N、动态 ruleId 以步骤日志留存。
- evidence/TC-API-REC-009/server.log 和 result.json；本设计阶段不生成或宣称执行结果。

### TC-API-REC-010 同一语义 id 的 tab 变体只保留高分 URL

- 类型：API ｜ 优先级：P0 ｜ 类别：positive ｜ 技术：decision-table
- Feature：F-REC-05
- AC：F-REC-05#AC3
- Code：C-BE-REC-06、C-BE-CORE-09

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用独立 TEST_PORT（API 仲裁建议 4103），不配置 SNAPSHOT_FILE；所有操作为真实 HTTP，不 mock 后端、不导入服务端源码。
- 每条用例独立执行自己的 reset 和数据导入；HTTP 请求附 x-request-id=<本用例ID>-<步骤号>，记录原始请求、响应及 server.log。

测试数据：两条均1天前且未打开；visitCount=5/2，quality=0.76/0.65；id=1被dupKey保留，tab被忽略；推荐保留final最高页，与整理keepUrl最短规则不同。

步骤：

- S1：POST /api/__test__/reset，请求体为 {}，Content-Type: application/json。
- S2：令 T=Date.now()；POST /api/sync，body={activeTab:null,openTabs:[],history:[{url:"https://example.com/p?id=1&tab=x",title:"Higher",lastVisitTime:T−86400000,visitCount:5},{url:"https://example.com/p?id=1&tab=y",title:"Lower",lastVisitTime:T−86400000,visitCount:2}]}。
- S3：POST /api/recommendations/next?now=T，body={currentPage:{url:"https://example.com/q"},openTabs:[],recentHistory:[]}。

预期：

- E1：S2 返回 200，created=2、pageCount=2，业务query未被存储归一化合并。
- E2：S3 返回 200，recommendations.length=1，唯一 url="https://example.com/p?id=1&tab=x"、strategy="same_domain"、score=0.66。
- E3：S3 不包含 https://example.com/p?id=1&tab=y。

证据：

- evidence/TC-API-REC-010/api/：全部 HTTP 请求体、响应、状态码及 x-request-id；计算 T/N、动态 ruleId 以步骤日志留存。
- evidence/TC-API-REC-010/server.log 和 result.json；本设计阶段不生成或宣称执行结果。

### TC-API-REC-011 所有页面均已打开时推荐为空且不为兜底突破排除规则

- 类型：API ｜ 优先级：P1 ｜ 类别：negative ｜ 技术：decision-table
- Feature：F-REC-05、F-REC-06
- AC：F-REC-05#AC1、F-REC-06#AC1
- Code：C-BE-REC-06、C-BE-REC-04、C-BE-CORE-09

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用独立 TEST_PORT（API 仲裁建议 4103），不配置 SNAPSHOT_FILE；所有操作为真实 HTTP，不 mock 后端、不导入服务端源码。
- 每条用例独立执行自己的 reset 和数据导入；HTTP 请求附 x-request-id=<本用例ID>-<步骤号>，记录原始请求、响应及 server.log。

测试数据：resource.json 按 D-01 整体平移，最新历史=T−5分钟；sync 响应 N=syncedAt 为读接口 ?now，导入后立即查询。样例 received=14、created=10、updated=4、pageCount=10；PRD §13.4 推荐恰好 Actions/.87、useState/.46、Quick Start/.41。；这是排除规则的有效输入负向分支，扩展F-REC-06兜底AC，不作为其样例正例的唯一证明。

步骤：

- S1：POST /api/__test__/reset，请求体为 {}，Content-Type: application/json。
- S2：读取只读 resource.json，令 T=Date.now()、delta=T−300000−1710100000000；复制为 samplePayload，将 history 的每个 lastVisitTime 加 delta，activeTab/openTabs 保持样例值；POST /api/sync 发送 samplePayload，记录响应 syncedAt 为 N。
- S3：POST /api/recommendations/next?now=N，Content-Type: application/json，body={currentPage:null,openTabs:samplePayload.history.map(h=>({url:h.url})),recentHistory:[]}。
- S4：GET /api/health，核对页面数与规则数。

预期：

- E1：S3 返回 200，recommendations=[]；全部10个样例页面都在请求 openTabs，不能为凑至少1条而推荐已打开页面。
- E2：S4 返回 200，pageCount=10、ruleCount=0，查询没有副作用。

证据：

- evidence/TC-API-REC-011/api/：全部 HTTP 请求体、响应、状态码及 x-request-id；计算 T/N、动态 ruleId 以步骤日志留存。
- evidence/TC-API-REC-011/server.log 和 result.json；本设计阶段不生成或宣称执行结果。

### TC-API-REC-012 已归档的 Actions 即使关联度最高也不再被推荐

- 类型：API ｜ 优先级：P1 ｜ 类别：negative ｜ 技术：state-transition
- Feature：F-REC-05
- AC：F-REC-05#AC2
- Code：C-BE-REC-06

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用独立 TEST_PORT（API 仲裁建议 4103），不配置 SNAPSHOT_FILE；所有操作为真实 HTTP，不 mock 后端、不导入服务端源码。
- 每条用例独立执行自己的 reset 和数据导入；HTTP 请求附 x-request-id=<本用例ID>-<步骤号>，记录原始请求、响应及 server.log。

测试数据：resource.json 按 D-01 整体平移，最新历史=T−5分钟；sync 响应 N=syncedAt 为读接口 ?now，导入后立即查询。样例 received=14、created=10、updated=4、pageCount=10；PRD §13.4 推荐恰好 Actions/.87、useState/.46、Quick Start/.41。；归档接口仅作REC过滤前置构造，query.now=N 不撤销归档状态。

步骤：

- S1：POST /api/__test__/reset，请求体为 {}，Content-Type: application/json。
- S2：读取只读 resource.json，令 T=Date.now()、delta=T−300000−1710100000000；复制为 samplePayload，将 history 的每个 lastVisitTime 加 delta，activeTab/openTabs 保持样例值；POST /api/sync 发送 samplePayload，记录响应 syncedAt 为 N。
- S3：POST /api/pages/archive，body={urls:["https://github.com/org/repo/actions"]}。
- S4：POST /api/recommendations/next?now=N，Content-Type: application/json，body={currentPage:samplePayload.activeTab,openTabs:samplePayload.openTabs,recentHistory:samplePayload.history}。
- S5：GET /api/health，核对页面数与规则数。

预期：

- E1：S3 返回 200，body.ok=true、affected=1、notFound=0。
- E2：S4 返回 200，recommendations.length=2，URL 集合严格为 https://react.dev/reference/react/useState 与 https://react.dev/learn；不包含已归档Actions、issues/100或Google搜索页。
- E3：S5 返回 200，pageCount=10、ruleCount=0；归档不删除存储记录，推荐查询不更改计数。

证据：

- evidence/TC-API-REC-012/api/：全部 HTTP 请求体、响应、状态码及 x-request-id；计算 T/N、动态 ruleId 以步骤日志留存。
- evidence/TC-API-REC-012/server.log 和 result.json；本设计阶段不生成或宣称执行结果。

### TC-API-REC-013 先舍入再过滤时最终 0.30 保留而 0.29 被排除

- 类型：API ｜ 优先级：P1 ｜ 类别：boundary ｜ 技术：boundary
- Feature：F-REC-05
- AC：F-REC-05#AC2
- Code：C-BE-REC-06

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用独立 TEST_PORT（API 仲裁建议 4103），不配置 SNAPSHOT_FILE；所有操作为真实 HTTP，不 mock 后端、不导入服务端源码。
- 每条用例独立执行自己的 reset 和数据导入；HTTP 请求附 x-request-id=<本用例ID>-<步骤号>，记录原始请求、响应及 server.log。

测试数据：同域亲和度1；maxVisitCount=1023，target frequency=ln2/ln1024=0.1，open=0。9/10天quality=round2(0.4×2^(−age/7)+0.03+0.1)=0.29/0.28；final=round2(0.18+0.4×quality)=0.30/0.29。均小于14天，不会被归档先行过滤。后端§6.4明确先round2再<0.3。

步骤：

- S1：POST /api/__test__/reset，请求体为 {}，Content-Type: application/json。
- S2：令 T=Date.now()；POST /api/sync，body={activeTab:null,openTabs:[],history:[{url:"https://boundary.example.org/anchor",title:"Anchor",lastVisitTime:T−300000,visitCount:1023},{url:"https://boundary.example.org/keep",title:"Keep",lastVisitTime:T−9*86400000,visitCount:1},{url:"https://boundary.example.org/drop",title:"Drop",lastVisitTime:T−10*86400000,visitCount:1}]}。
- S3：GET /api/pages/ranked?now=T，记录 keep/drop 的页面 score。
- S4：POST /api/recommendations/next?now=T，body={currentPage:{url:"https://unknown.example.net/x"},openTabs:[{url:"https://boundary.example.org/anchor"}],recentHistory:[]}。

预期：

- E1：S2 返回 200，created=3、pageCount=3。
- E2：S3 返回 200，keep页面score=0.29、drop页面score=0.28。
- E3：S4 返回 200，recommendations.length=1，唯一 url="https://boundary.example.org/keep"、strategy="global_top"、score=0.30。
- E4：S4 不含drop与anchor；最终分数0.30没有被误用≤0.3过滤。

证据：

- evidence/TC-API-REC-013/api/：全部 HTTP 请求体、响应、状态码及 x-request-id；计算 T/N、动态 ruleId 以步骤日志留存。
- evidence/TC-API-REC-013/server.log 和 result.json；本设计阶段不生成或宣称执行结果。

### TC-API-REC-014 不同仓库当前页不能把 GitHub 样例错标为同仓库

- 类型：API ｜ 优先级：P1 ｜ 类别：negative ｜ 技术：error-guessing
- Feature：F-REC-02
- AC：F-REC-02#AC1
- Code：C-BE-REC-02、C-BE-REC-07

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用独立 TEST_PORT（API 仲裁建议 4103），不配置 SNAPSHOT_FILE；所有操作为真实 HTTP，不 mock 后端、不导入服务端源码。
- 每条用例独立执行自己的 reset 和数据导入；HTTP 请求附 x-request-id=<本用例ID>-<步骤号>，记录原始请求、响应及 server.log。

测试数据：resource.json 按 D-01 整体平移，最新历史=T−5分钟；sync 响应 N=syncedAt 为读接口 ?now，导入后立即查询。样例 received=14、created=10、updated=4、pageCount=10；PRD §13.4 推荐恰好 Actions/.87、useState/.46、Quick Start/.41。；另一个仓库仍同 github.com 域名，允许 same_domain，不应错误断言全为global_top。

步骤：

- S1：POST /api/__test__/reset，请求体为 {}，Content-Type: application/json。
- S2：读取只读 resource.json，令 T=Date.now()、delta=T−300000−1710100000000；复制为 samplePayload，将 history 的每个 lastVisitTime 加 delta，activeTab/openTabs 保持样例值；POST /api/sync 发送 samplePayload，记录响应 syncedAt 为 N。
- S3：POST /api/recommendations/next?now=N，Content-Type: application/json，body={currentPage:{url:"https://github.com/another/project/pull/1"},openTabs:samplePayload.openTabs,recentHistory:[]}。
- S4：GET /api/health，核对页面数与规则数。

预期：

- E1：S3 返回 200，不存在 strategy="same_repo" 的推荐。
- E2：S3 Actions条目strategy="same_domain"；reason含「同域名」且不含「同一仓库 another/project」。
- E3：S4 返回 200，pageCount=10、ruleCount=0。

证据：

- evidence/TC-API-REC-014/api/：全部 HTTP 请求体、响应、状态码及 x-request-id；计算 T/N、动态 ruleId 以步骤日志留存。
- evidence/TC-API-REC-014/server.log 和 result.json；本设计阶段不生成或宣称执行结果。

### TC-API-REC-015 六个合格候选按最终分数和访问时间排序后截断为五条

- 类型：API ｜ 优先级：P1 ｜ 类别：boundary ｜ 技术：boundary
- Feature：F-REC-01、F-REC-02、F-REC-06
- AC：F-REC-01#AC1、F-REC-02#AC1、F-REC-06#AC1
- Code：C-BE-REC-01、C-BE-REC-02、C-BE-REC-04、C-BE-REC-07

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用独立 TEST_PORT（API 仲裁建议 4103），不配置 SNAPSHOT_FILE；所有操作为真实 HTTP，不 mock 后端、不导入服务端源码。
- 每条用例独立执行自己的 reset 和数据导入；HTTP 请求附 x-request-id=<本用例ID>-<步骤号>，记录原始请求、响应及 server.log。

测试数据：仅6条同仓库、同域历史，访问次数均1且时间相差1秒；quality均0.80，PR→Actions rel1最终.92，null兜底rel.3最终.50。补充Top5上限与同分排序，不替代样例AC的直接证明。

步骤：

- S1：POST /api/__test__/reset，请求体为 {}，Content-Type: application/json。
- S2：令 T=Date.now()；POST /api/sync，body={activeTab:null,openTabs:[],history:Array.from({length:6},(_,i)=>({url:"https://github.com/limit/repo/actions/runs/"+i,title:"Run "+i,lastVisitTime:T−300000−i*1000,visitCount:1}))}。
- S3：POST /api/recommendations/next?now=T，body={currentPage:{url:"https://github.com/limit/repo/pull/999"},openTabs:[],recentHistory:[]}。
- S4：POST /api/recommendations/next?now=T，body={currentPage:null,openTabs:[],recentHistory:[]}。

预期：

- E1：S2 返回 200，created=6、pageCount=6。
- E2：S3 返回 200，recommendations.length=5，按序 URL 为 actions/runs/0、/1、/2、/3、/4 对应完整URL；均strategy="same_repo"、score=0.92。
- E3：S4 返回 200，recommendations.length=5，URL顺序与S3相同，均strategy="global_top"、score=0.50。
- E4：S3和S4都不含第6条 actions/runs/5；同final及quality时按lastVisitedAt倒序取Top5。

证据：

- evidence/TC-API-REC-015/api/：全部 HTTP 请求体、响应、状态码及 x-request-id；计算 T/N、动态 ruleId 以步骤日志留存。
- evidence/TC-API-REC-015/server.log 和 result.json；本设计阶段不生成或宣称执行结果。

### TC-API-REC-016 文档当前页没有同站点数据时不生成 same_doc_site 结果

- 类型：API ｜ 优先级：P1 ｜ 类别：negative ｜ 技术：decision-table
- Feature：F-REC-03
- AC：F-REC-03#AC1
- Code：C-BE-REC-03

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用独立 TEST_PORT（API 仲裁建议 4103），不配置 SNAPSHOT_FILE；所有操作为真实 HTTP，不 mock 后端、不导入服务端源码。
- 每条用例独立执行自己的 reset 和数据导入；HTTP 请求附 x-request-id=<本用例ID>-<步骤号>，记录原始请求、响应及 server.log。

测试数据：仅构造news的1天前5/1次历史；当前React文档合法但没有同域候选，验证不匹配分支而非错误请求。

步骤：

- S1：POST /api/__test__/reset，请求体为 {}，Content-Type: application/json。
- S2：令 T=Date.now()；POST /api/sync，body={activeTab:null,openTabs:[],history:[{url:"https://news.example.org/a",title:"News A",lastVisitTime:T−86400000,visitCount:5},{url:"https://news.example.org/b",title:"News B",lastVisitTime:T−86400000,visitCount:1}]}。
- S3：POST /api/recommendations/next?now=T，body={currentPage:{url:"https://react.dev/learn"},openTabs:[],recentHistory:[]}。
- S4：GET /api/health，核对页面数与规则数。

预期：

- E1：S3 返回 200，recommendations.length=2，均strategy="global_top"，不存在same_doc_site。
- E2：S3 按序为 https://news.example.org/a(score=0.48)、https://news.example.org/b(score=0.41)。
- E3：S4 返回 200，pageCount=2、ruleCount=0。

证据：

- evidence/TC-API-REC-016/api/：全部 HTTP 请求体、响应、状态码及 x-request-id；计算 T/N、动态 ruleId 以步骤日志留存。
- evidence/TC-API-REC-016/server.log 和 result.json；本设计阶段不生成或宣称执行结果。

### TC-API-REC-017 非内置文档域名的 guide 路径仍触发文档策略

- 类型：API ｜ 优先级：P1 ｜ 类别：boundary ｜ 技术：boundary
- Feature：F-REC-03
- AC：F-REC-03#AC1
- Code：C-BE-REC-03

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用独立 TEST_PORT（API 仲裁建议 4103），不配置 SNAPSHOT_FILE；所有操作为真实 HTTP，不 mock 后端、不导入服务端源码。
- 每条用例独立执行自己的 reset 和数据导入；HTTP 请求附 x-request-id=<本用例ID>-<步骤号>，记录原始请求、响应及 server.log。

测试数据：D-17 文档站集合之外，路径 /guide/start 位于判定分支边界；仅news两条1天前5/1次历史，quality=.76/.58，文档rel=.8。

步骤：

- S1：POST /api/__test__/reset，请求体为 {}，Content-Type: application/json。
- S2：令 T=Date.now()；POST /api/sync，body={activeTab:null,openTabs:[],history:[{url:"https://news.example.org/a",title:"News A",lastVisitTime:T−86400000,visitCount:5},{url:"https://news.example.org/b",title:"News B",lastVisitTime:T−86400000,visitCount:1}]}。
- S3：POST /api/recommendations/next?now=T，body={currentPage:{url:"https://news.example.org/guide/start"},openTabs:[],recentHistory:[]}。

预期：

- E1：S3 返回 200，recommendations.length=2。
- E2：S3 按序a/b两条均strategy="same_doc_site"，score依次0.78、0.71，reason均含「news.example.org」。

证据：

- evidence/TC-API-REC-017/api/：全部 HTTP 请求体、响应、状态码及 x-request-id；计算 T/N、动态 ruleId 以步骤日志留存。
- evidence/TC-API-REC-017/server.log 和 result.json；本设计阶段不生成或宣称执行结果。

### TC-API-REC-018 当前普通站点与全部历史域名不同则不触发 same_domain

- 类型：API ｜ 优先级：P1 ｜ 类别：negative ｜ 技术：decision-table
- Feature：F-REC-04
- AC：F-REC-04#AC1
- Code：C-BE-REC-03

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用独立 TEST_PORT（API 仲裁建议 4103），不配置 SNAPSHOT_FILE；所有操作为真实 HTTP，不 mock 后端、不导入服务端源码。
- 每条用例独立执行自己的 reset 和数据导入；HTTP 请求附 x-request-id=<本用例ID>-<步骤号>，记录原始请求、响应及 server.log。

测试数据：仅news同域5/1次、1天前历史，当前other.example.net既非文档页也非GitHub；验证同域匹配失败的有效输入反向分支。

步骤：

- S1：POST /api/__test__/reset，请求体为 {}，Content-Type: application/json。
- S2：令 T=Date.now()；POST /api/sync，body={activeTab:null,openTabs:[],history:[{url:"https://news.example.org/a",title:"News A",lastVisitTime:T−86400000,visitCount:5},{url:"https://news.example.org/b",title:"News B",lastVisitTime:T−86400000,visitCount:1}]}。
- S3：POST /api/recommendations/next?now=T，body={currentPage:{url:"https://other.example.net/c"},openTabs:[],recentHistory:[]}。
- S4：GET /api/health，核对页面数与规则数。

预期：

- E1：S3 返回 200，recommendations.length=2，均strategy="global_top"且不存在same_domain。
- E2：S3 URL按序a/b，score依次0.48、0.41；reason均为「近期综合评分较高的页面，可作为备选」。
- E3：S4 返回 200，pageCount=2、ruleCount=0。

证据：

- evidence/TC-API-REC-018/api/：全部 HTTP 请求体、响应、状态码及 x-request-id；计算 T/N、动态 ruleId 以步骤日志留存。
- evidence/TC-API-REC-018/server.log 和 result.json；本设计阶段不生成或宣称执行结果。

### TC-API-REC-019 只有一个同域候选时返回一条并保持可解释评分

- 类型：API ｜ 优先级：P1 ｜ 类别：boundary ｜ 技术：boundary
- Feature：F-REC-04
- AC：F-REC-04#AC1
- Code：C-BE-REC-03

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用独立 TEST_PORT（API 仲裁建议 4103），不配置 SNAPSHOT_FILE；所有操作为真实 HTTP，不 mock 后端、不导入服务端源码。
- 每条用例独立执行自己的 reset 和数据导入；HTTP 请求附 x-request-id=<本用例ID>-<步骤号>，记录原始请求、响应及 server.log。

测试数据：单候选下限；frequency=domainBoost=1，recency=2^(−1/7)，quality=.76，final=.66。

步骤：

- S1：POST /api/__test__/reset，请求体为 {}，Content-Type: application/json。
- S2：令 T=Date.now()；POST /api/sync，body={activeTab:null,openTabs:[],history:[{url:"https://news.example.org/a",title:"Only",lastVisitTime:T−86400000,visitCount:1}]}。
- S3：POST /api/recommendations/next?now=T，body={currentPage:{url:"https://news.example.org/c"},openTabs:[],recentHistory:[]}。

预期：

- E1：S2 返回 200，created=1、pageCount=1。
- E2：S3 返回 200，recommendations.length=1，唯一url=https://news.example.org/a、strategy="same_domain"、score=0.66，reason含「同域名」。

证据：

- evidence/TC-API-REC-019/api/：全部 HTTP 请求体、响应、状态码及 x-request-id；计算 T/N、动态 ruleId 以步骤日志留存。
- evidence/TC-API-REC-019/server.log 和 result.json；本设计阶段不生成或宣称执行结果。

### TC-API-REC-020 最近三条只有两条 React 时规则不触发

- 类型：API ｜ 优先级：P2 ｜ 类别：negative ｜ 技术：decision-table
- Feature：F-REC-07
- AC：F-REC-07#AC2
- Code：C-BE-REC-05

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用独立 TEST_PORT（API 仲裁建议 4103），不配置 SNAPSHOT_FILE；所有操作为真实 HTTP，不 mock 后端、不导入服务端源码。
- 每条用例独立执行自己的 reset 和数据导入；HTTP 请求附 x-request-id=<本用例ID>-<步骤号>，记录原始请求、响应及 server.log。

测试数据：resource.json 按 D-01 整体平移，最新历史=T−5分钟；sync 响应 N=syncedAt 为读接口 ?now，导入后立即查询。样例 received=14、created=10、updated=4、pageCount=10；PRD §13.4 推荐恰好 Actions/.87、useState/.46、Quick Start/.41。；3条均有lastVisitTime；最近2条React，第3条news形成不满足minCount的连续前缀。

步骤：

- S1：POST /api/__test__/reset，请求体为 {}，Content-Type: application/json。
- S2：读取只读 resource.json，令 T=Date.now()、delta=T−300000−1710100000000；复制为 samplePayload，将 history 的每个 lastVisitTime 加 delta，activeTab/openTabs 保持样例值；POST /api/sync 发送 samplePayload，记录响应 syncedAt 为 N。
- S3：POST /api/rules，请求体 {"rules":[{"rawText":"如果我连续看了 3 个 React 文档，推荐相关 MDN 页面","type":"recommend_related","trigger":{"domain":"react.dev","minCount":3,"label":"React"},"target":{"domain":"developer.mozilla.org","label":"MDN"},"action":"recommend","enabled":true,"confidence":"high"}]}；保存返回 rules[0].id 为 ruleId，不预设 id。
- S4：POST /api/recommendations/next?now=N，Content-Type: application/json，body={currentPage:{url:"https://react.dev/learn"},openTabs:[],recentHistory:[{url:"https://react.dev/learn",lastVisitTime:N−1000},{url:"https://react.dev/reference/react/useState",lastVisitTime:N−2000},{url:"https://news.example.org/a",lastVisitTime:N−3000}]}。
- S5：GET /api/health，核对页面数与规则数。

预期：

- E1：S3 返回 201，ruleCount=1、rules[0].enabled=true。
- E2：S4 返回 200，recommendations 中 strategy="rule" 的条数=0；第1条为useState、strategy="same_doc_site"、score=0.76。
- E3：S5 返回 200，pageCount=10、ruleCount=1，规则不触发不会删除保存规则。

证据：

- evidence/TC-API-REC-020/api/：全部 HTTP 请求体、响应、状态码及 x-request-id；计算 T/N、动态 ruleId 以步骤日志留存。
- evidence/TC-API-REC-020/server.log 和 result.json；本设计阶段不生成或宣称执行结果。

### TC-API-REC-021 三个 React 记录只有两个不同 dupKey 时不满足三页阈值

- 类型：API ｜ 优先级：P2 ｜ 类别：boundary ｜ 技术：boundary
- Feature：F-REC-07
- AC：F-REC-07#AC2
- Code：C-BE-REC-05

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用独立 TEST_PORT（API 仲裁建议 4103），不配置 SNAPSHOT_FILE；所有操作为真实 HTTP，不 mock 后端、不导入服务端源码。
- 每条用例独立执行自己的 reset 和数据导入；HTTP 请求附 x-request-id=<本用例ID>-<步骤号>，记录原始请求、响应及 server.log。

测试数据：resource.json 按 D-01 整体平移，最新历史=T−5分钟；sync 响应 N=syncedAt 为读接口 ?now，导入后立即查询。样例 received=14、created=10、updated=4、pageCount=10；PRD §13.4 推荐恰好 Actions/.87、useState/.46、Quick Start/.41。；minCount=3、raw历史长度3，但tab/hash不参与dupKey，仅2个不同React页面。补充AC2的不同页面计数边界。

步骤：

- S1：POST /api/__test__/reset，请求体为 {}，Content-Type: application/json。
- S2：读取只读 resource.json，令 T=Date.now()、delta=T−300000−1710100000000；复制为 samplePayload，将 history 的每个 lastVisitTime 加 delta，activeTab/openTabs 保持样例值；POST /api/sync 发送 samplePayload，记录响应 syncedAt 为 N。
- S3：POST /api/rules，请求体 {"rules":[{"rawText":"如果我连续看了 3 个 React 文档，推荐相关 MDN 页面","type":"recommend_related","trigger":{"domain":"react.dev","minCount":3,"label":"React"},"target":{"domain":"developer.mozilla.org","label":"MDN"},"action":"recommend","enabled":true,"confidence":"high"}]}；保存返回 rules[0].id 为 ruleId，不预设 id。
- S4：POST /api/recommendations/next?now=N，Content-Type: application/json，body={currentPage:{url:"https://react.dev/learn"},openTabs:[],recentHistory:[{url:"https://react.dev/learn",lastVisitTime:N−1000},{url:"https://react.dev/learn?tab=overview#section",lastVisitTime:N−2000},{url:"https://react.dev/reference/react/useState",lastVisitTime:N−3000}]}。

预期：

- E1：S4 返回 200，recommendations 中 strategy="rule" 的条数=0。
- E2：S4 第1条为useState、strategy="same_doc_site"、score=0.76；learn及其tab/hash变体按dupKey只贡献1个不同页面。

证据：

- evidence/TC-API-REC-021/api/：全部 HTTP 请求体、响应、状态码及 x-request-id；计算 T/N、动态 ruleId 以步骤日志留存。
- evidence/TC-API-REC-021/server.log 和 result.json；本设计阶段不生成或宣称执行结果。

### TC-API-REC-022 非 React 记录中断连续访问且更旧 React 不能补足次数

- 类型：API ｜ 优先级：P2 ｜ 类别：negative ｜ 技术：error-guessing
- Feature：F-REC-07
- AC：F-REC-07#AC2
- Code：C-BE-REC-05

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用独立 TEST_PORT（API 仲裁建议 4103），不配置 SNAPSHOT_FILE；所有操作为真实 HTTP，不 mock 后端、不导入服务端源码。
- 每条用例独立执行自己的 reset 和数据导入；HTTP 请求附 x-request-id=<本用例ID>-<步骤号>，记录原始请求、响应及 server.log。

测试数据：resource.json 按 D-01 整体平移，最新历史=T−5分钟；sync 响应 N=syncedAt 为读接口 ?now，导入后立即查询。样例 received=14、created=10、updated=4、pageCount=10；PRD §13.4 推荐恰好 Actions/.87、useState/.46、Quick Start/.41。；总共有3个不同React页面，但从最新开始连续前缀只有2个，覆盖全表计数代替连续计数的错误。

步骤：

- S1：POST /api/__test__/reset，请求体为 {}，Content-Type: application/json。
- S2：读取只读 resource.json，令 T=Date.now()、delta=T−300000−1710100000000；复制为 samplePayload，将 history 的每个 lastVisitTime 加 delta，activeTab/openTabs 保持样例值；POST /api/sync 发送 samplePayload，记录响应 syncedAt 为 N。
- S3：POST /api/rules，请求体 {"rules":[{"rawText":"如果我连续看了 3 个 React 文档，推荐相关 MDN 页面","type":"recommend_related","trigger":{"domain":"react.dev","minCount":3,"label":"React"},"target":{"domain":"developer.mozilla.org","label":"MDN"},"action":"recommend","enabled":true,"confidence":"high"}]}；保存返回 rules[0].id 为 ruleId，不预设 id。
- S4：POST /api/recommendations/next?now=N，Content-Type: application/json，body={currentPage:{url:"https://react.dev/learn"},openTabs:[],recentHistory:[{url:"https://react.dev/learn",lastVisitTime:N−1000},{url:"https://react.dev/reference/react/useState",lastVisitTime:N−2000},{url:"https://news.example.org/a",lastVisitTime:N−3000},{url:"https://react.dev/reference/react/useEffect",lastVisitTime:N−4000}]}。
- S5：GET /api/health，核对页面数与规则数。

预期：

- E1：S4 返回 200，recommendations 中strategy="rule"的条数=0，不能跨第3条news继续累计。
- E2：S5 返回 200，pageCount=10、ruleCount=1，查询不改变已保存规则。

证据：

- evidence/TC-API-REC-022/api/：全部 HTTP 请求体、响应、状态码及 x-request-id；计算 T/N、动态 ruleId 以步骤日志留存。
- evidence/TC-API-REC-022/server.log 和 result.json；本设计阶段不生成或宣称执行结果。

### TC-API-REC-023 规则停用后即使最近三页满足触发也不输出规则推荐

- 类型：API ｜ 优先级：P2 ｜ 类别：negative ｜ 技术：state-transition
- Feature：F-REC-07
- AC：F-REC-07#AC2
- Code：C-BE-REC-05

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用独立 TEST_PORT（API 仲裁建议 4103），不配置 SNAPSHOT_FILE；所有操作为真实 HTTP，不 mock 后端、不导入服务端源码。
- 每条用例独立执行自己的 reset 和数据导入；HTTP 请求附 x-request-id=<本用例ID>-<步骤号>，记录原始请求、响应及 server.log。

测试数据：resource.json 按 D-01 整体平移，最新历史=T−5分钟；sync 响应 N=syncedAt 为读接口 ?now，导入后立即查询。样例 received=14、created=10、updated=4、pageCount=10；PRD §13.4 推荐恰好 Actions/.87、useState/.46、Quick Start/.41。；保存和PATCH只作为REC触发前置，不额外生成RULE模块用例；用HTTP返回的ruleId传递状态。

步骤：

- S1：POST /api/__test__/reset，请求体为 {}，Content-Type: application/json。
- S2：读取只读 resource.json，令 T=Date.now()、delta=T−300000−1710100000000；复制为 samplePayload，将 history 的每个 lastVisitTime 加 delta，activeTab/openTabs 保持样例值；POST /api/sync 发送 samplePayload，记录响应 syncedAt 为 N。
- S3：POST /api/rules，请求体 {"rules":[{"rawText":"如果我连续看了 3 个 React 文档，推荐相关 MDN 页面","type":"recommend_related","trigger":{"domain":"react.dev","minCount":3,"label":"React"},"target":{"domain":"developer.mozilla.org","label":"MDN"},"action":"recommend","enabled":true,"confidence":"high"}]}；保存返回 rules[0].id 为 ruleId，不预设 id。
- S4：PATCH /api/rules/<ruleId>，使用S3返回id，body={enabled:false}。
- S5：POST /api/recommendations/next?now=N，Content-Type: application/json，body={currentPage:{url:"https://react.dev/learn"},openTabs:[],recentHistory:[{url:"https://react.dev/reference/react/useEffect",lastVisitTime:N−3000},{url:"https://react.dev/learn",lastVisitTime:N−1000},{url:"https://react.dev/reference/react/useState",lastVisitTime:N−2000}]}。
- S6：GET /api/health，核对页面数与规则数。

预期：

- E1：S3 返回201且ruleId为非空字符串；S4 返回200、enabled=false且id=ruleId。
- E2：S5 返回200，recommendations中strategy="rule"的条数=0；第1条为useState、same_doc_site、score=0.76。
- E3：S6 返回200，pageCount=10、ruleCount=1、enabledRuleCount=0；推荐查询不重新启用规则。

证据：

- evidence/TC-API-REC-023/api/：全部 HTTP 请求体、响应、状态码及 x-request-id；计算 T/N、动态 ruleId 以步骤日志留存。
- evidence/TC-API-REC-023/server.log 和 result.json；本设计阶段不生成或宣称执行结果。

### TC-API-REC-024 只使用时间倒序的前二十条历史且第21条不能补齐触发次数

- 类型：API ｜ 优先级：P2 ｜ 类别：boundary ｜ 技术：boundary
- Feature：F-REC-01、F-REC-07
- AC：F-REC-01#AC1、F-REC-07#AC2
- Code：C-BE-REC-01、C-BE-REC-05

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用独立 TEST_PORT（API 仲裁建议 4103），不配置 SNAPSHOT_FILE；所有操作为真实 HTTP，不 mock 后端、不导入服务端源码。
- 每条用例独立执行自己的 reset 和数据导入；HTTP 请求附 x-request-id=<本用例ID>-<步骤号>，记录原始请求、响应及 server.log。

测试数据：resource.json 按 D-01 整体平移，最新历史=T−5分钟；sync 响应 N=syncedAt 为读接口 ?now，导入后立即查询。样例 received=14、created=10、updated=4、pageCount=10；PRD §13.4 推荐恰好 Actions/.87、useState/.46、Quick Start/.41。；接口可接受500条但排序后仅取20条；21条输入故意逆序。参考原型未截断，预期以api-contract和C-BE-REC-01为准。

步骤：

- S1：POST /api/__test__/reset，请求体为 {}，Content-Type: application/json。
- S2：读取只读 resource.json，令 T=Date.now()、delta=T−300000−1710100000000；复制为 samplePayload，将 history 的每个 lastVisitTime 加 delta，activeTab/openTabs 保持样例值；POST /api/sync 发送 samplePayload，记录响应 syncedAt 为 N。
- S3：POST /api/rules，请求体 {"rules":[{"rawText":"如果我连续看了 3 个 React 文档，推荐相关 MDN 页面","type":"recommend_related","trigger":{"domain":"react.dev","minCount":3,"label":"React"},"target":{"domain":"developer.mozilla.org","label":"MDN"},"action":"recommend","enabled":true,"confidence":"high"}]}；保存返回 rules[0].id 为 ruleId，不预设 id。
- S4：POST /api/recommendations/next?now=N，Content-Type: application/json，构造H=Array.from({length:20},(_,i)=>({url:i%2?"https://react.dev/learn":"https://react.dev/reference/react/useState",lastVisitTime:N−1000−i*1000}))，再追加{url:"https://react.dev/reference/react/useEffect",lastVisitTime:N−21000}；body={currentPage:{url:"https://react.dev/learn"},openTabs:[],recentHistory:H.reverse()}。

预期：

- E1：S4 返回200，recommendations中strategy="rule"的条数=0，时间最新20条仅2个不同React dupKey。
- E2：S4 第1条为useState、same_doc_site、score=0.76；输入数组第1条虽是第21旧的useEffect，也不会在排序截断前被计入。

证据：

- evidence/TC-API-REC-024/api/：全部 HTTP 请求体、响应、状态码及 x-request-id；计算 T/N、动态 ruleId 以步骤日志留存。
- evidence/TC-API-REC-024/server.log 和 result.json；本设计阶段不生成或宣称执行结果。

### TC-API-REC-025 触发规则但库中没有 MDN 页面时给出站内搜索兜底

- 类型：API ｜ 优先级：P1 ｜ 类别：positive ｜ 技术：decision-table
- Feature：F-REC-07
- AC：F-REC-07#AC1
- Code：C-BE-REC-05

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用独立 TEST_PORT（API 仲裁建议 4103），不配置 SNAPSHOT_FILE；所有操作为真实 HTTP，不 mock 后端、不导入服务端源码。
- 每条用例独立执行自己的 reset 和数据导入；HTTP 请求附 x-request-id=<本用例ID>-<步骤号>，记录原始请求、响应及 server.log。

测试数据：仅1条React历史，目标域名MDN库中确实不存在；recentHistory三条不同React仍可作规则上下文。具体搜索路径和理由文案未冻结，只断言目标站点、非空title/reason与契约固定score=.8，不将此扩展场景替代样例Fetch_API正例。

步骤：

- S1：POST /api/__test__/reset，请求体为 {}，Content-Type: application/json。
- S2：令 T=Date.now()；POST /api/sync，body={activeTab:null,openTabs:[],history:[{url:"https://react.dev/learn",title:"React Learn",lastVisitTime:T−86400000,visitCount:1}]}，记录syncedAt为N。
- S3：POST /api/rules，请求体 {"rules":[{"rawText":"如果我连续看了 3 个 React 文档，推荐相关 MDN 页面","type":"recommend_related","trigger":{"domain":"react.dev","minCount":3,"label":"React"},"target":{"domain":"developer.mozilla.org","label":"MDN"},"action":"recommend","enabled":true,"confidence":"high"}]}；保存返回 rules[0].id 为 ruleId，不预设 id。
- S4：POST /api/recommendations/next?now=N，Content-Type: application/json，body={currentPage:{url:"https://unknown.example.net/x",title:"React forms"},openTabs:[],recentHistory:[{url:"https://react.dev/reference/react/useEffect",lastVisitTime:N−3000},{url:"https://react.dev/learn",lastVisitTime:N−1000},{url:"https://react.dev/reference/react/useState",lastVisitTime:N−2000}]}。

预期：

- E1：S2 返回200、created=1、pageCount=1；S3返回201并返回非空ruleId。
- E2：S4 返回200，恰有1条strategy="rule"，其score=0.8，id="rec_rule_"+ruleId。
- E3：S4 规则推荐的url能被new URL解析、protocol="https:"、hostname="developer.mozilla.org"；title和reason均为非空字符串。

证据：

- evidence/TC-API-REC-025/api/：全部 HTTP 请求体、响应、状态码及 x-request-id；计算 T/N、动态 ruleId 以步骤日志留存。
- evidence/TC-API-REC-025/server.log 和 result.json；本设计阶段不生成或宣称执行结果。

### TC-API-REC-026 缺少 currentPage 或字段类型非法返回400且不改写数据

- 类型：API ｜ 优先级：P1 ｜ 类别：negative ｜ 技术：equivalence
- Feature：F-REC-01
- AC：F-REC-01#AC2
- Code：C-BE-REC-01、C-BE-CORE-08

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用独立 TEST_PORT（API 仲裁建议 4103），不配置 SNAPSHOT_FILE；所有操作为真实 HTTP，不 mock 后端、不导入服务端源码。
- 每条用例独立执行自己的 reset 和数据导入；HTTP 请求附 x-request-id=<本用例ID>-<步骤号>，记录原始请求、响应及 server.log。

测试数据：resource.json 按 D-01 整体平移，最新历史=T−5分钟；sync 响应 N=syncedAt 为读接口 ?now，导入后立即查询。样例 received=14、created=10、updated=4、pageCount=10；PRD §13.4 推荐恰好 Actions/.87、useState/.46、Quick Start/.41。；同一结构校验等价类含4个独立HTTP变体。非法参数属于negative，不冒充外部依赖异常。

步骤：

- S1：POST /api/__test__/reset，请求体为 {}，Content-Type: application/json。
- S2：读取只读 resource.json，令 T=Date.now()、delta=T−300000−1710100000000；复制为 samplePayload，将 history 的每个 lastVisitTime 加 delta，activeTab/openTabs 保持样例值；POST /api/sync 发送 samplePayload，记录响应 syncedAt 为 N。
- S3：逐一POST /api/recommendations/next?now=N，Content-Type:application/json，body分别为：A={openTabs:[],recentHistory:[]}；B={currentPage:null,openTabs:{}}；C={currentPage:"https://react.dev/learn",openTabs:[]}；D={currentPage:null,recentHistory:{}}；每个响应独立记录。
- S4：GET /api/health，核对页面数与规则数。

预期：

- E1：S3的A/B/C/D均返回400，body.error.code="VALIDATION_FAILED"，error.message为非空字符串。
- E2：S3的error.details.fields分别包含currentPage、openTabs、currentPage、recentHistory，字段列表为数组。
- E3：S4返回200，pageCount=10、ruleCount=0、lastSyncAt=N，无非法请求写入副作用。

证据：

- evidence/TC-API-REC-026/api/：全部 HTTP 请求体、响应、状态码及 x-request-id；计算 T/N、动态 ruleId 以步骤日志留存。
- evidence/TC-API-REC-026/server.log 和 result.json；本设计阶段不生成或宣称执行结果。

### TC-API-REC-027 非法 JSON 请求返回 INVALID_JSON 且保留已有页面

- 类型：API ｜ 优先级：P1 ｜ 类别：negative ｜ 技术：error-guessing
- Feature：F-REC-01
- AC：F-REC-01#AC2
- Code：C-BE-REC-01

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用独立 TEST_PORT（API 仲裁建议 4103），不配置 SNAPSHOT_FILE；所有操作为真实 HTTP，不 mock 后端、不导入服务端源码。
- 每条用例独立执行自己的 reset 和数据导入；HTTP 请求附 x-request-id=<本用例ID>-<步骤号>，记录原始请求、响应及 server.log。

测试数据：resource.json 按 D-01 整体平移，最新历史=T−5分钟；sync 响应 N=syncedAt 为读接口 ?now，导入后立即查询。样例 received=14、created=10、updated=4、pageCount=10；PRD §13.4 推荐恰好 Actions/.87、useState/.46、Quick Start/.41。；传输层JSON语法错误的扩展契约反例，与AC2字段校验共用统一错误格式但不宣称其完全等价。

步骤：

- S1：POST /api/__test__/reset，请求体为 {}，Content-Type: application/json。
- S2：读取只读 resource.json，令 T=Date.now()、delta=T−300000−1710100000000；复制为 samplePayload，将 history 的每个 lastVisitTime 加 delta，activeTab/openTabs 保持样例值；POST /api/sync 发送 samplePayload，记录响应 syncedAt 为 N。
- S3：POST /api/recommendations/next?now=N，Content-Type:application/json，以原始字节发送字符串 {bad，禁止客户端自动JSON序列化。
- S4：GET /api/health，核对页面数与规则数。

预期：

- E1：S3返回400，body.error.code="INVALID_JSON"，error.message为非空字符串。
- E2：S4返回200，pageCount=10、ruleCount=0、lastSyncAt=N。

证据：

- evidence/TC-API-REC-027/api/：全部 HTTP 请求体、响应、状态码及 x-request-id；计算 T/N、动态 ruleId 以步骤日志留存。
- evidence/TC-API-REC-027/server.log 和 result.json；本设计阶段不生成或宣称执行结果。

### TC-API-REC-028 有请求体但媒体类型为 text/plain 返回415且不写入

- 类型：API ｜ 优先级：P1 ｜ 类别：negative ｜ 技术：equivalence
- Feature：F-REC-01
- AC：F-REC-01#AC2
- Code：C-BE-REC-01

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用独立 TEST_PORT（API 仲裁建议 4103），不配置 SNAPSHOT_FILE；所有操作为真实 HTTP，不 mock 后端、不导入服务端源码。
- 每条用例独立执行自己的 reset 和数据导入；HTTP 请求附 x-request-id=<本用例ID>-<步骤号>，记录原始请求、响应及 server.log。

测试数据：resource.json 按 D-01 整体平移，最新历史=T−5分钟；sync 响应 N=syncedAt 为读接口 ?now，导入后立即查询。样例 received=14、created=10、updated=4、pageCount=10；PRD §13.4 推荐恰好 Actions/.87、useState/.46、Quick Start/.41。；媒体类型错误是negative；不模拟网络故障。

步骤：

- S1：POST /api/__test__/reset，请求体为 {}，Content-Type: application/json。
- S2：读取只读 resource.json，令 T=Date.now()、delta=T−300000−1710100000000；复制为 samplePayload，将 history 的每个 lastVisitTime 加 delta，activeTab/openTabs 保持样例值；POST /api/sync 发送 samplePayload，记录响应 syncedAt 为 N。
- S3：POST /api/recommendations/next?now=N，Content-Type:text/plain，原始请求体为 {"currentPage":null,"openTabs":[],"recentHistory":[]}。
- S4：GET /api/health，核对页面数与规则数。

预期：

- E1：S3返回415，body.error.code="UNSUPPORTED_MEDIA_TYPE"，error.message为非空字符串。
- E2：S4返回200，pageCount=10、ruleCount=0、lastSyncAt=N。

证据：

- evidence/TC-API-REC-028/api/：全部 HTTP 请求体、响应、状态码及 x-request-id；计算 T/N、动态 ruleId 以步骤日志留存。
- evidence/TC-API-REC-028/server.log 和 result.json；本设计阶段不生成或宣称执行结果。

### TC-API-REC-029 now 为零、负数、小数或非数字时均返回400

- 类型：API ｜ 优先级：P1 ｜ 类别：negative ｜ 技术：equivalence
- Feature：F-REC-01
- AC：F-REC-01#AC2
- Code：C-BE-REC-01、C-BE-CORE-08

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用独立 TEST_PORT（API 仲裁建议 4103），不配置 SNAPSHOT_FILE；所有操作为真实 HTTP，不 mock 后端、不导入服务端源码。
- 每条用例独立执行自己的 reset 和数据导入；HTTP 请求附 x-request-id=<本用例ID>-<步骤号>，记录原始请求、响应及 server.log。

测试数据：resource.json 按 D-01 整体平移，最新历史=T−5分钟；sync 响应 N=syncedAt 为读接口 ?now，导入后立即查询。样例 received=14、created=10、updated=4、pageCount=10；PRD §13.4 推荐恰好 Actions/.87、useState/.46、Quick Start/.41。；api-contract要求now为正整数毫秒；每个无效等价类独立请求。

步骤：

- S1：POST /api/__test__/reset，请求体为 {}，Content-Type: application/json。
- S2：读取只读 resource.json，令 T=Date.now()、delta=T−300000−1710100000000；复制为 samplePayload，将 history 的每个 lastVisitTime 加 delta，activeTab/openTabs 保持样例值；POST /api/sync 发送 samplePayload，记录响应 syncedAt 为 N。
- S3：依次POST /api/recommendations/next?now=0、?now=-1、?now=1.5、?now=abc，body均为{currentPage:null,openTabs:[],recentHistory:[]}；分别记录响应。
- S4：GET /api/health，核对页面数与规则数。

预期：

- E1：S3的4次响应均为400、error.code="VALIDATION_FAILED"、error.message非空，error.details.fields包含"now"。
- E2：S4返回200，pageCount=10、ruleCount=0、lastSyncAt=N。

证据：

- evidence/TC-API-REC-029/api/：全部 HTTP 请求体、响应、状态码及 x-request-id；计算 T/N、动态 ruleId 以步骤日志留存。
- evidence/TC-API-REC-029/server.log 和 result.json；本设计阶段不生成或宣称执行结果。

### TC-API-REC-030 openTabs 和 recentHistory 各自在500条被接受而501条被拒绝

- 类型：API ｜ 优先级：P1 ｜ 类别：boundary ｜ 技术：boundary
- Feature：F-REC-01
- AC：F-REC-01#AC1、F-REC-01#AC2
- Code：C-BE-REC-01、C-BE-CORE-08

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用独立 TEST_PORT（API 仲裁建议 4103），不配置 SNAPSHOT_FILE；所有操作为真实 HTTP，不 mock 后端、不导入服务端源码。
- 每条用例独立执行自己的 reset 和数据导入；HTTP 请求附 x-request-id=<本用例ID>-<步骤号>，记录原始请求、响应及 server.log。

测试数据：resource.json 按 D-01 整体平移，最新历史=T−5分钟；sync 响应 N=syncedAt 为读接口 ?now，导入后立即查询。样例 received=14、created=10、updated=4、pageCount=10；PRD §13.4 推荐恰好 Actions/.87、useState/.46、Quick Start/.41。；每次JSON正文远小于1MiB；openTabs与recentHistory分别测500/501，避免正文上限或另一个字段先拦截而掩盖数组边界。history每条都有必填lastVisitTime。

步骤：

- S1：POST /api/__test__/reset，请求体为 {}，Content-Type: application/json。
- S2：读取只读 resource.json，令 T=Date.now()、delta=T−300000−1710100000000；复制为 samplePayload，将 history 的每个 lastVisitTime 加 delta，activeTab/openTabs 保持样例值；POST /api/sync 发送 samplePayload，记录响应 syncedAt 为 N。
- S3：令B={currentPage:samplePayload.activeTab,openTabs:samplePayload.openTabs,recentHistory:[]}；POST ?now=N，请求A把B.openTabs替换成样例3条openTabs加497条{url:"https://pad.example.org/tab/"+i}，保持recentHistory=[]；请求B把openTabs保持样例3条，recentHistory替换为500条{url:"https://pad.example.org/history/"+i,lastVisitTime:N−300000−i*1000}。完整路径均为/api/recommendations/next。
- S4：分别对请求A再追加1条tab，对请求B再追加1条带lastVisitTime的history，各POST一次（两个数组单独越界，不同时越界）。
- S5：GET /api/health，核对页面数与规则数。

预期：

- E1：S3两次均返回200，recommendations均精确为Actions/.87、useState/.46、Quick Start/.41的三条样例URL；500条合法上下文不会新建页面。
- E2：S4两次均返回413、body.error.code="PAYLOAD_TOO_LARGE"、error.message非空。
- E3：S5返回200，pageCount=10、ruleCount=0、lastSyncAt=N。

证据：

- evidence/TC-API-REC-030/api/：全部 HTTP 请求体、响应、状态码及 x-request-id；计算 T/N、动态 ruleId 以步骤日志留存。
- evidence/TC-API-REC-030/server.log 和 result.json；本设计阶段不生成或宣称执行结果。

### TC-API-REC-031 JSON 正文恰好1MiB被接受而多1字节返回413

- 类型：API ｜ 优先级：P1 ｜ 类别：boundary ｜ 技术：boundary
- Feature：F-REC-01
- AC：F-REC-01#AC1、F-REC-01#AC2
- Code：C-BE-REC-01、C-BE-CORE-08

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用独立 TEST_PORT（API 仲裁建议 4103），不配置 SNAPSHOT_FILE；所有操作为真实 HTTP，不 mock 后端、不导入服务端源码。
- 每条用例独立执行自己的 reset 和数据导入；HTTP 请求附 x-request-id=<本用例ID>-<步骤号>，记录原始请求、响应及 server.log。

测试数据：resource.json 按 D-01 整体平移，最新历史=T−5分钟；sync 响应 N=syncedAt 为读接口 ?now，导入后立即查询。样例 received=14、created=10、updated=4、pageCount=10；PRD §13.4 推荐恰好 Actions/.87、useState/.46、Quick Start/.41。；使用UTF-8字节数而非字符数；padding是顶层未知字段（C-BE-CORE-08规定忽略未知字段），不依赖超长title/URL或超长数组触发413。仅扩展请求正文边界。

步骤：

- S1：POST /api/__test__/reset，请求体为 {}，Content-Type: application/json。
- S2：读取只读 resource.json，令 T=Date.now()、delta=T−300000−1710100000000；复制为 samplePayload，将 history 的每个 lastVisitTime 加 delta，activeTab/openTabs 保持样例值；POST /api/sync 发送 samplePayload，记录响应 syncedAt 为 N。
- S3：构造base=JSON.stringify({currentPage:null,openTabs:samplePayload.openTabs,recentHistory:[],padding:""})；用ASCII字符x填充padding，令Buffer.byteLength(raw,"utf8")恰为1048576。POST /api/recommendations/next?now=N，以application/json原始字节发送raw，使用HTTP客户端支持的足够大正文限制。
- S4：在相同JSON的padding里再加1个x，确认Buffer.byteLength=1048577后，以相同Content-Type再次POST同路径。
- S5：GET /api/health，核对页面数与规则数。

预期：

- E1：S3返回200，recommendations.length=4，全部strategy="global_top"且score≥0.3；未识别的padding被白名单读取规则忽略。
- E2：S4返回413，error.code="PAYLOAD_TOO_LARGE"，error.message非空。
- E3：S5返回200，pageCount=10、ruleCount=0、lastSyncAt=N。

证据：

- evidence/TC-API-REC-031/api/：全部 HTTP 请求体、响应、状态码及 x-request-id；计算 T/N、动态 ruleId 以步骤日志留存。
- evidence/TC-API-REC-031/server.log 和 result.json；本设计阶段不生成或宣称执行结果。

## Feature → Case 覆盖表

| Feature | AC | 直接验收见证 | 补充关联用例 |
|---|---|---|---|
| F-REC-01 | AC1 | TC-API-REC-001 | TC-API-REC-015、TC-API-REC-024、TC-API-REC-030、TC-API-REC-031 |
| F-REC-01 | AC2 | TC-API-REC-026 | TC-API-REC-027、TC-API-REC-028、TC-API-REC-029、TC-API-REC-030、TC-API-REC-031 |
| F-REC-01 | AC3 | TC-API-REC-009 | — |
| F-REC-02 | AC1 | TC-API-REC-001 | TC-API-REC-014、TC-API-REC-015 |
| F-REC-02 | AC2 | TC-API-REC-002 | — |
| F-REC-03 | AC1 | TC-API-REC-003 | TC-API-REC-016、TC-API-REC-017 |
| F-REC-03 | AC2 | TC-API-REC-004 | — |
| F-REC-04 | AC1 | TC-API-REC-005 | TC-API-REC-018、TC-API-REC-019 |
| F-REC-05 | AC1 | TC-API-REC-001 | TC-API-REC-011 |
| F-REC-05 | AC2 | TC-API-REC-001 | TC-API-REC-012、TC-API-REC-013 |
| F-REC-05 | AC3 | TC-API-REC-010 | — |
| F-REC-06 | AC1 | TC-API-REC-006 | TC-API-REC-011、TC-API-REC-015 |
| F-REC-06 | AC2 | TC-API-REC-007 | — |
| F-REC-07 | AC1 | TC-API-REC-008 | TC-API-REC-025 |
| F-REC-07 | AC2 | TC-API-REC-020 | TC-API-REC-021、TC-API-REC-022、TC-API-REC-023、TC-API-REC-024 |

## 类别豁免

检查器从 AC 的 openTabs/history 等字段名推导异常类别要求；本分片逐项说明真实依赖，不将参数错误或业务不匹配伪装成异常。

- F-REC-01 / exception：本分片只测后端REC HTTP接口：推荐读取同进程内存仓库、索引快照和缓存，没有需调用的外部推荐服务。启动时SNAPSHOT_FILE不配置，契约也没有可用HTTP运行时故障注入接口。客户端连接不存在端口只能证明客户端网络错误，不能断言REC后端降级；停服务会让被测接口不存在。非法JSON/类型/长度均已作为negative或boundary覆盖，不冒充exception。外部依赖故障应由有实际依赖的PERSIST/FE诊断分片验证，本分片不创建其用例。
- F-REC-02 / exception：同仓库策略只解析请求URL的owner/repo/kind并读取本进程排序快照Top-50桶，不会访问GitHub或CI网络接口。契约没有可用HTTP故障注入入口；连接失败/停服务不能验证该策略降级。已用不同仓库负向场景和Top5边界覆盖业务分支，不把无匹配或400误记为运行时异常。
- F-REC-03 / exception：文档策略仅用内置域名/路径判定并读取本进程同域索引，不会请求React、MDN或其他文档网站。参考AC含openTabs而被类别检查识别为外部依赖，但本API不调用浏览器tabs。真实HTTP无法使这段纯内存判断发生可控依赖异常；无同站点候选已归negative，不伪造异常API。
- F-REC-04 / exception：同域策略只比较域名并读取同进程排序快照，页面历史已通过sync入库，运行时不调用浏览器history或新闻站点。当前无外部推荐依赖或HTTP故障注入契约；空/不匹配数据走可断言的负向与单候选边界，不能用停后端冒充策略异常响应。
- F-REC-05 / exception：过滤和排序在本进程内对dupKey、归档状态、decideArchive与分数运算，不读外部存储或站点；本测试后端关闭SNAPSHOT_FILE。契约未提供能经HTTP触发过滤运行时异常的入口；已打开/已归档/低分被过滤属于有效输入业务分支，不能为填exception而标成外部失败。
- F-REC-06 / exception：全局兜底只读本进程高分桶和排除集合，不调用外部搜索/推荐服务，currentPage=null也不访问浏览器API。合格候选为空是业务负向分支而非外部依赖故障；没有合法HTTP故障注入入口，停止服务仅使接口不可调用，故不伪造后端降级断言。
- F-REC-07 / exception：关联规则读取同进程已保存规则和recentHistory请求数据，只计算连续去重计数及目标域候选，搜索兜底仅返回URL、不会发起站点搜索请求。未触发/禁用/重复不足阈值已分别作为negative/boundary验证。契约无可用HTTP运行时故障注入机制，不能通过真实依赖失败验证异常响应。

## 契约待定点与范围限制

- 策略重叠时“取最高rel”与文字顺序rule>same_repo存在歧义：PR→Actions的rel=1.0大于rule的0.95。当前用例不构造二者同时命中，待后端owner定案。
- “有数据至少1条”以过滤后有合格候选为前提；全部已打开/已归档/待归档的页面不得突破过滤来凑数。
- 规则搜索兜底仅测库中确无目标域名记录；“目标存在但被过滤后为空”是否搜索未冻结，不擅自确定。搜索路径和具体理由文案未冻结，只断言https目标域名、非空title/reason和固定score=0.8。
- PRD的recentHistory“最多20”按api-contract细化为最多500输入、时间倒序仅取20；原型缺少20条截断时仍以正式契约为准。
- 未运行浏览器，不创建ego-lite空间；F-REC-08和全部UI/E2E分片均在本任务范围外。

## 类别分布与静态校验

统计来源：`.workflow/context/logs/case-API-REC-check-cases.json` 为指定 `check-cases.mjs --json` 的完整输出。该脚本的 `stats` 是全项目汇总；以下 Feature 类别数直接摘自其 `matrix`。REC 独立用例总数按该次检查输入中的本分片唯一 ID 聚合，避免一条用例关联多个 Feature 后重复计数。派生结果保存在 `.workflow/context/logs/case-API-REC-summary.json`。

| Feature | positive | negative | boundary | exception 用例 | exception 豁免 | 类别缺口 |
|---|---:|---:|---:|---:|---:|---|
| F-REC-01 | 1 | 4 | 5 | 0 | 1 | 无 |
| F-REC-02 | 2 | 1 | 1 | 0 | 1 | 无 |
| F-REC-03 | 2 | 1 | 1 | 0 | 1 | 无 |
| F-REC-04 | 1 | 1 | 1 | 0 | 1 | 无 |
| F-REC-05 | 2 | 2 | 1 | 0 | 1 | 无 |
| F-REC-06 | 2 | 1 | 1 | 0 | 1 | 无 |
| F-REC-07 | 2 | 3 | 2 | 0 | 1 | 无 |

| 本分片唯一 Case 统计 | 数量 |
|---|---:|
| positive | 10 |
| negative | 12 |
| boundary | 9 |
| exception | 0 |
| 合计 | 31 |

优先级为 P0=8、P1=18、P2=5。15/15 条 BE 验收标准均有直接验收见证，REC 后端代码点覆盖 7/7，共享 C-BE-CORE-08 引用 4 条、C-BE-CORE-09 引用 3 条。exception 共 7 条明确豁免，均未冒充异常执行。

指定 `node .workflow/validators/validate.mjs cases --module=REC --brief` 最终退出码 0，`pass=true`、`errors=0`、`warnings=0`。报告为 `.workflow/reports/validate-cases-REC.json`，最终原始输出为 `.workflow/context/logs/case-API-REC-final-validator.log`。首次运行曾受其他分片尚未汇总的 UI 文档缺失与全项目检查输出截断影响；最终使用仅作用于本次 Node 进程的 stdout 阻塞预加载重跑，未修改 validator 或上游，也未改 UI 分片。

指定 `node .agents/skills/nav-test-case-design/scripts/check-cases.mjs --json` 退出码 1；完整输出快照中全项目有 194 个错误，REC 相关错误 0、警告 0，F-REC-01～07 的 `missing=[]`。该次 `stats.cases=179`，`stats.byType={API:146,UI:33}`，`stats.byCategory={positive:65,boundary:35,negative:33,exception:21,state:17,security:3,performance:5}`；这些数字是当时项目级快照，不能宣称全项目通过，也不能混作本分片统计。其他模块和 UI/E2E 的缺口不在本任务修复范围。

本阶段只完成用例设计、参考数值复算与静态追溯校验。真实 HTTP 业务执行数为 0，没有业务 PASS 或运行覆盖率结论。
