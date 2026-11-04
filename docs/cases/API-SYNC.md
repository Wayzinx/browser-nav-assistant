# SYNC API 测试用例分片

> 第 2 轮续跑；本文件与 `docs/trace/cases/API-SYNC.json` 同源。仅设计 type=API 的 SYNC 用例，产品 HTTP 尚未执行。

## 范围与执行约定

- 覆盖 F-SYNC-01/02/03/04/05/07 的接口观察面及 C-BE-SYNC-01..05；F-SYNC-06 属于 FE-only，由现有 UI 分片负责。
- F-SYNC-01 的 AC 跨越 FE/BE：AC1 在本分片验证接收/落库；AC2 的前端过滤、AC3 的按钮禁用和重入阻止由 `docs/trace/cases/UI-SYNC.json` 中编号 001/002/003 完整验证。本分片只记录已过滤请求、单次上报的接口结果；acceptanceRefs 是接口侧追溯，不能据此宣称完整 UI AC 已由 API 证明。后端没有被假定具备 single-flight。
- 每案以真实 `POST /api/__test__/reset` 开始，自行构造数据并调用真实 `POST /api/sync`；按 `normalizedUrl` 查找页面，使用响应的动态 id/syncedAt。不得依赖其他用例或 mock 后端。
- 样例按 D-01 整体平移，最新历史=T−300000ms；同案重放复用同一份 payload。`ranked` 使用 `limit=500&now=<已保存的时间>`，不断言随真实时间变动的排名。
- 无副作用比较只取业务字段（见各案 Q/H 定义），固定同一 now；不把评分、generatedAt、uptime 或访问日志新增视为业务副作用。
- 解析异常实际经过 HTTP/JSON 解析器并检查 400 与恢复；未虚构下游数据库/磁盘故障接口。每条用例均设计执行后留痕，当前没有创建 PASS 证据。
- 规范依据：PRD §6.1/§13.1–13.2、D-01..04；`docs/trace/api-contract.json` 的 `/api/sync`、`/api/pages/ranked`、`/api/health`、`/api/__test__/reset`。字节和长度边界补充后端技术方案 §5.1。

## 用例

### TC-API-SYNC-001 一次已收集上下文上报：后端接收三个字段并返回两条页面

- 优先级：P0 ｜ 类别：positive ｜ 技术：scenario
- 关联 Feature：F-SYNC-01
- 关联 AC：F-SYNC-01#AC1、F-SYNC-01#AC3
- 关联 Code：C-BE-SYNC-01、C-BE-SYNC-04
- 前置条件：
  - 使用独占的真实 HTTP 后端 API_BASE（测试默认 http://127.0.0.1:4100），ENABLE_TEST_API=1，单请求超时 10 秒；禁止 mock 或 route 后端。
  - 每案自行执行 S1 清空页面、规则、同步日志及缓存，不依赖执行顺序；只通过 POST /api/sync 构造页面。
- 测试数据：A=https://github.com/org/repo/pull/456，B=https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API；payload={activeTab:{url:A},openTabs:[{url:A},{url:B}],history:[]}。F-SYNC-01#AC1 只验证接口接收与落库；#AC3 只验证已由调用方防重入后的一次上报结果和实际访问日志条数。按钮 disabled 与二次点击不发请求仍由 UI-SYNC.json 的编号 003 完整验证，API 不假设服务端合并并发请求。
- 步骤：
  - S1：POST /api/__test__/reset，请求体 {}，Content-Type: application/json。
  - S2：记录本案服务端访问日志起始偏移；构造 payload，确认 activeTab、openTabs、history 三个自有字段均存在。
  - S3：只发出一次 POST /api/sync（application/json），body=payload，响应记为 R。
  - S4：GET /api/pages/ranked?limit=500&now=<R.syncedAt>，随后 GET /api/health；截取从日志偏移至此的访问日志。
- 预期：
  - E1：S1 返回 HTTP 200，body.ok=true。
  - E2：POST 返回 HTTP 200，R.ok=true，R.mode="full"。
  - E3：R 的统计元组 (received,created,updated,rejected,pageCount)=(3,2,1,0,2)。
  - E4：ranked 返回 HTTP 200，total=2，pages 的 URL 集合恰为 {https://github.com/org/repo/pull/456,https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API}。
  - E5：本案同步区间访问日志中 method=POST 且 path=/api/sync 的记录恰为 1 条，与本次请求 ID 对应。
  - E6：health 返回 HTTP 200，pageCount=2，lastSyncAt=R.syncedAt。
- 证据：
  - evidence/TC-API-SYNC-001/result.json（执行后生成，设计阶段不标 PASS）
  - evidence/TC-API-SYNC-001/api/（逐次请求、原始请求体和响应，x-request-id 按本案 ID 与请求序号区分）
  - evidence/TC-API-SYNC-001/server.log（真实后端本案时间段的访问与错误日志）

### TC-API-SYNC-002 系统页已在采集侧跳过的上下文：activeTab=null且后端只保存普通页面

- 优先级：P0 ｜ 类别：positive ｜ 技术：equivalence
- 关联 Feature：F-SYNC-01
- 关联 AC：F-SYNC-01#AC2
- 关联 Code：C-BE-SYNC-01、C-BE-SYNC-04
- 前置条件：
  - 使用独占的真实 HTTP 后端 API_BASE（测试默认 http://127.0.0.1:4100），ENABLE_TEST_API=1，单请求超时 10 秒；禁止 mock 或 route 后端。
  - 每案自行执行 S1 清空页面、规则、同步日志及缓存，不依赖执行顺序；只通过 POST /api/sync 构造页面。
- 测试数据：A=https://github.com/org/repo/pull/456，B=https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API；接口输入为 {activeTab:null,openTabs:[{url:A},{url:B}],history:[]}。AC2 的 API 侧前提是采集侧已经跳过 chrome://version/，本案断言实际发送体与后端接收结果，不能证明过滤算法；浏览器存在系统页仍不上传的完整证明属于 UI-SYNC.json 编号 002。
- 步骤：
  - S1：POST /api/__test__/reset，请求体 {}，Content-Type: application/json。
  - S2：构造上述 payload 并保存将实际发送的 JSON 字节；不在 API 测试中调用浏览器或实现过滤器。
  - S3：POST /api/sync（application/json），body=payload，响应记为 R。
  - S4：GET /api/pages/ranked?limit=500&now=<R.syncedAt>；GET /api/health。
- 预期：
  - E1：S1 返回 HTTP 200，body.ok=true。
  - E2：实际发送 JSON 包含 activeTab、openTabs、history，activeTab=null，三处记录中 chrome:// URL 数量=0。
  - E3：POST 返回 HTTP 200，(received,created,updated,rejected,pageCount)=(2,2,0,0,2)。
  - E4：ranked.total=2，URL 集合恰为 {https://github.com/org/repo/pull/456,https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API}，所有页面 isOpen=true、isActive=false。
  - E5：health.pageCount=2，后端不存在 chrome:// 页面。
- 证据：
  - evidence/TC-API-SYNC-002/result.json（执行后生成，设计阶段不标 PASS）
  - evidence/TC-API-SYNC-002/api/（逐次请求、原始请求体和响应，x-request-id 按本案 ID 与请求序号区分）
  - evidence/TC-API-SYNC-002/server.log（真实后端本案时间段的访问与错误日志）

### TC-API-SYNC-003 D-01平移样例首次导入：14条观测合并为10页且保留时间和来源

- 优先级：P0 ｜ 类别：positive ｜ 技术：scenario
- 关联 Feature：F-SYNC-02、F-SYNC-03、F-SYNC-04
- 关联 AC：F-SYNC-02#AC1、F-SYNC-03#AC2、F-SYNC-04#AC1
- 关联 Code：C-BE-SYNC-02、C-BE-SYNC-03、C-BE-SYNC-04、C-BE-CORE-10
- 前置条件：
  - 使用独占的真实 HTTP 后端 API_BASE（测试默认 http://127.0.0.1:4100），ENABLE_TEST_API=1，单请求超时 10 秒；禁止 mock 或 route 后端。
  - 每案自行执行 S1 清空页面、规则、同步日志及缓存，不依赖执行顺序；只通过 POST /api/sync 构造页面。
- 测试数据：样例 P 是 resource.json 的深拷贝；T=Date.now()，delta=T-300000-max(resource.history.lastVisitTime)，P.history 每个 lastVisitTime 加 delta，activeTab/openTabs 保持原字段；整案重复上传复用同一个 P，不重新平移。读 ranked 使用 limit=500 与已保存的 now，页面按 normalizedUrl 查找，不依赖排序或生成的 id。 PRD §13.2：14 条观测、10 个 normalizedUrl；issues/123 历史次数=8，pull/456=5。
- 步骤：
  - S1：POST /api/__test__/reset，请求体 {}，Content-Type: application/json。
  - S2：按 D-01 构造 P，保存 P.history 中 issues/123、pull/456 的 lastVisitTime。
  - S3：POST /api/sync（application/json），body=P，响应记为 R。
  - S4：GET /api/pages/ranked?limit=500&now=<R.syncedAt>，响应记为 G；GET /api/health。
- 预期：
  - E1：S1 返回 HTTP 200，body.ok=true。
  - E2：POST 返回 HTTP 200，R.ok=true，R.mode="full"，syncedAt 是正整数毫秒时间戳。
  - E3：R 的统计元组 (received,created,updated,rejected,pageCount)=(14,10,4,0,10)。
  - E4：R.rejectedByReason={invalid_url:0,privacy:0}。
  - E5：G 返回 HTTP 200，total=10，pages.length=10，normalizedUrl 集合恰为 resource.json 的10个业务URL（包括独立的 ?tab=comments 页面）。
  - E6：url=https://github.com/org/repo/issues/123 的 visitCount=8，lastVisitedAt=P.history 对应记录的 lastVisitTime。
  - E7：url=https://github.com/org/repo/pull/456 的 visitCount=5，lastVisitedAt=R.syncedAt，isActive=true。
  - E8：url=https://github.com/org/repo/pull/456 的 sources 集合恰为 {history,active_tab}。
  - E9：url=https://github.com/org/repo/issues/123 的 sources 集合恰为 {history,open_tab}。
  - E10：url=https://react.dev/learn 的 sources 恰为 ["history"]，isOpen=false。
  - E11：health 返回 HTTP 200，pageCount=10，lastSyncAt=R.syncedAt。
- 证据：
  - evidence/TC-API-SYNC-003/result.json（执行后生成，设计阶段不标 PASS）
  - evidence/TC-API-SYNC-003/api/（逐次请求、原始请求体和响应，x-request-id 按本案 ID 与请求序号区分）
  - evidence/TC-API-SYNC-003/server.log（真实后端本案时间段的访问与错误日志）

### TC-API-SYNC-004 主机大小写、跟踪参数、hash和尾斜杠不同：两条历史只建一页

- 优先级：P0 ｜ 类别：positive ｜ 技术：equivalence
- 关联 Feature：F-SYNC-02
- 关联 AC：F-SYNC-02#AC2
- 关联 Code：C-BE-SYNC-03、C-BE-SYNC-04、C-BE-CORE-09
- 前置条件：
  - 使用独占的真实 HTTP 后端 API_BASE（测试默认 http://127.0.0.1:4100），ENABLE_TEST_API=1，单请求超时 10 秒；禁止 mock 或 route 后端。
  - 每案自行执行 S1 清空页面、规则、同步日志及缓存，不依赖执行顺序；只通过 POST /api/sync 构造页面。
- 测试数据：T=Date.now()；activeTab=null，openTabs=[]；history 两项 url 分别为 https://GitHub.com/org/repo/issues/123/?utm_source=mail#c1 和 https://github.com/org/repo/issues/123，lastVisitTime 分别 T-1200000、T-600000，visitCount 分别2、8。
- 步骤：
  - S1：POST /api/__test__/reset，请求体 {}，Content-Type: application/json。
  - S2：按 testData 构造两个历史观测，POST /api/sync（application/json），响应记为 R。
  - S3：GET /api/pages/ranked?limit=500&now=<R.syncedAt>；GET /api/health。
- 预期：
  - E1：S1 返回 HTTP 200，body.ok=true。
  - E2：POST 返回 HTTP 200，(received,created,updated,rejected,pageCount)=(2,1,1,0,1)。
  - E3：ranked.total=1、pages.length=1，唯一页面 normalizedUrl="https://github.com/org/repo/issues/123"。
  - E4：health.pageCount=1，不存在由 hash、utm_source、大小写或尾斜杠产生的第二条记录。
- 证据：
  - evidence/TC-API-SYNC-004/result.json（执行后生成，设计阶段不标 PASS）
  - evidence/TC-API-SYNC-004/api/（逐次请求、原始请求体和响应，x-request-id 按本案 ID 与请求序号区分）
  - evidence/TC-API-SYNC-004/server.log（真实后端本案时间段的访问与错误日志）

### TC-API-SYNC-005 业务query有无tab=comments：同路径仍保存两条normalizedUrl

- 优先级：P0 ｜ 类别：positive ｜ 技术：decision-table
- 关联 Feature：F-SYNC-02
- 关联 AC：F-SYNC-02#AC3
- 关联 Code：C-BE-SYNC-03、C-BE-SYNC-04、C-BE-CORE-09
- 前置条件：
  - 使用独占的真实 HTTP 后端 API_BASE（测试默认 http://127.0.0.1:4100），ENABLE_TEST_API=1，单请求超时 10 秒；禁止 mock 或 route 后端。
  - 每案自行执行 S1 清空页面、规则、同步日志及缓存，不依赖执行顺序；只通过 POST /api/sync 构造页面。
- 测试数据：T=Date.now()；activeTab=null，openTabs=[]；history 分别为 https://github.com/org/repo/issues/123 与 https://github.com/org/repo/issues/123?tab=comments，lastVisitTime=T-600000，visitCount 分别8、3。
- 步骤：
  - S1：POST /api/__test__/reset，请求体 {}，Content-Type: application/json。
  - S2：POST /api/sync（application/json），提交 testData 的两条历史，响应记为 R。
  - S3：GET /api/pages/ranked?limit=500&now=<R.syncedAt>；GET /api/health。
- 预期：
  - E1：S1 返回 HTTP 200，body.ok=true。
  - E2：POST 返回 HTTP 200，(received,created,updated,rejected,pageCount)=(2,2,0,0,2)。
  - E3：ranked.total=2，normalizedUrl 集合恰为 {https://github.com/org/repo/issues/123,https://github.com/org/repo/issues/123?tab=comments}。
  - E4：health.pageCount=2，保留业务 query，不把整理建议的 dupKey 当存储主键。
- 证据：
  - evidence/TC-API-SYNC-005/result.json（执行后生成，设计阶段不标 PASS）
  - evidence/TC-API-SYNC-005/api/（逐次请求、原始请求体和响应，x-request-id 按本案 ID 与请求序号区分）
  - evidence/TC-API-SYNC-005/server.log（真实后端本案时间段的访问与错误日志）

### TC-API-SYNC-006 空上下文首次同步：0条观测仍返回200且不生成来源或页面

- 优先级：P1 ｜ 类别：boundary ｜ 技术：boundary
- 关联 Feature：F-SYNC-01、F-SYNC-02、F-SYNC-04
- 关联 AC：F-SYNC-01#AC1、F-SYNC-02#AC1、F-SYNC-04#AC1
- 关联 Code：C-BE-SYNC-01、C-BE-SYNC-03、C-BE-SYNC-04
- 前置条件：
  - 使用独占的真实 HTTP 后端 API_BASE（测试默认 http://127.0.0.1:4100），ENABLE_TEST_API=1，单请求超时 10 秒；禁止 mock 或 route 后端。
  - 每案自行执行 S1 清空页面、规则、同步日志及缓存，不依赖执行顺序；只通过 POST /api/sync 构造页面。
- 测试数据：payload={activeTab:null,openTabs:[],history:[]}，空输入是接收数量与来源集合的0边界。
- 步骤：
  - S1：POST /api/__test__/reset，请求体 {}，Content-Type: application/json。
  - S2：POST /api/sync（application/json），提交空 payload，响应记为 R。
  - S3：GET /api/pages/ranked?limit=500&now=<R.syncedAt>；GET /api/health。
- 预期：
  - E1：S1 返回 HTTP 200，body.ok=true。
  - E2：POST 返回 HTTP 200，R.ok=true，R.mode="full"。
  - E3：(received,created,updated,rejected,pageCount)=(0,0,0,0,0)，rejectedByReason={invalid_url:0,privacy:0}。
  - E4：ranked 返回 HTTP 200，pages=[]，total=0，不生成虚构页面或 sources。
  - E5：health.pageCount=0，lastSyncAt=R.syncedAt。
- 证据：
  - evidence/TC-API-SYNC-006/result.json（执行后生成，设计阶段不标 PASS）
  - evidence/TC-API-SYNC-006/api/（逐次请求、原始请求体和响应，x-request-id 按本案 ID 与请求序号区分）
  - evidence/TC-API-SYNC-006/server.log（真实后端本案时间段的访问与错误日志）

### TC-API-SYNC-007 同一份平移样例重放：不新增页面且visitCount不累加

- 优先级：P0 ｜ 类别：positive ｜ 技术：state-transition
- 关联 Feature：F-SYNC-02、F-SYNC-03
- 关联 AC：F-SYNC-02#AC1、F-SYNC-03#AC1
- 关联 Code：C-BE-SYNC-02、C-BE-SYNC-03、C-BE-SYNC-04
- 前置条件：
  - 使用独占的真实 HTTP 后端 API_BASE（测试默认 http://127.0.0.1:4100），ENABLE_TEST_API=1，单请求超时 10 秒；禁止 mock 或 route 后端。
  - 每案自行执行 S1 清空页面、规则、同步日志及缓存，不依赖执行顺序；只通过 POST /api/sync 构造页面。
- 测试数据：样例 P 是 resource.json 的深拷贝；T=Date.now()，delta=T-300000-max(resource.history.lastVisitTime)，P.history 每个 lastVisitTime 加 delta，activeTab/openTabs 保持原字段；整案重复上传复用同一个 P，不重新平移。读 ranked 使用 limit=500 与已保存的 now，页面按 normalizedUrl 查找，不依赖排序或生成的 id。
- 步骤：
  - S1：POST /api/__test__/reset，请求体 {}，Content-Type: application/json。
  - S2：构造 P；POST /api/sync（application/json）上传 P 得到 R1；GET /api/pages/ranked?limit=500&now=<R1.syncedAt> 保存各页 firstSeenAt。
  - S3：再次 POST /api/sync 上传完全相同的 P，响应记为 R2；不重算 history 时间。
  - S4：GET /api/pages/ranked?limit=500&now=<R2.syncedAt>；GET /api/health。
- 预期：
  - E1：S1 返回 HTTP 200，body.ok=true。
  - E2：R1 返回 HTTP 200，(received,created,updated,rejected,pageCount)=(14,10,4,0,10)。
  - E3：R2 返回 HTTP 200，(received,created,updated,rejected,pageCount)=(14,0,14,0,10)。
  - E4：第二次 ranked 中 https://github.com/org/repo/issues/123 的 visitCount=8，不能变为16；https://github.com/org/repo/pull/456 的 visitCount=5。
  - E5：第二次 ranked.total=10，全部页面 firstSeenAt 与首次回读值相等，sources 无重复项。
  - E6：第二次 ranked 中 https://github.com/org/repo/issues/123 的 lastVisitedAt 仍为 P.history 对应时间，https://github.com/org/repo/pull/456 的 lastVisitedAt=R2.syncedAt。
  - E7：health.pageCount=10，lastSyncAt=R2.syncedAt。
- 证据：
  - evidence/TC-API-SYNC-007/result.json（执行后生成，设计阶段不标 PASS）
  - evidence/TC-API-SYNC-007/api/（逐次请求、原始请求体和响应，x-request-id 按本案 ID 与请求序号区分）
  - evidence/TC-API-SYNC-007/server.log（真实后端本案时间段的访问与错误日志）

### TC-API-SYNC-008 较小次数和更早历史后再来新历史：次数取max、首次时间取min、空标题不覆盖

- 优先级：P1 ｜ 类别：boundary ｜ 技术：state-transition
- 关联 Feature：F-SYNC-03
- 关联 AC：F-SYNC-03#AC1、F-SYNC-03#AC2、F-SYNC-03#AC3
- 关联 Code：C-BE-SYNC-02、C-BE-SYNC-03
- 前置条件：
  - 使用独占的真实 HTTP 后端 API_BASE（测试默认 http://127.0.0.1:4100），ENABLE_TEST_API=1，单请求超时 10 秒；禁止 mock 或 route 后端。
  - 每案自行执行 S1 清空页面、规则、同步日志及缓存，不依赖执行顺序；只通过 POST /api/sync 构造页面。
- 测试数据：T=Date.now()，U=https://example.com/merge；三次请求均 activeTab=null、openTabs=[]、history 只有 U：(lastVisitTime,visitCount,title) 依次为 (T-600000,8,"Original")、(T-1200000,2,"")、(T-300000,12,"New")。这是 F-SYNC-03 描述中 max/min 和非空标题规则的补充边界，不替代样例 AC 的正例。
- 步骤：
  - S1：POST /api/__test__/reset，请求体 {}，Content-Type: application/json。
  - S2：按第一组数据 POST /api/sync（application/json），保存 R1 和 ranked 的 U（now=R1.syncedAt）。
  - S3：按第二组数据 POST /api/sync，保存 R2 和 ranked 的 U（now=R2.syncedAt）。
  - S4：按第三组数据 POST /api/sync，保存 R3 和 ranked 的 U（now=R3.syncedAt）；GET /api/health。
- 预期：
  - E1：S1 返回 HTTP 200，body.ok=true。
  - E2：三次 POST 均返回 HTTP 200；R1 (created,updated,pageCount)=(1,0,1)，R2/R3 均为 (0,1,1)。
  - E3：首次 U.visitCount=8，lastVisitedAt=firstSeenAt=T-600000，title="Original"。
  - E4：第二次 U.visitCount=8，lastVisitedAt=T-600000，firstSeenAt=T-1200000，title="Original"。
  - E5：第三次 U.visitCount=12，lastVisitedAt=T-300000，firstSeenAt=T-1200000，title="New"。
  - E6：三次回读 U 的 id 相等，sources=["history"]；health.pageCount=1。
- 证据：
  - evidence/TC-API-SYNC-008/result.json（执行后生成，设计阶段不标 PASS）
  - evidence/TC-API-SYNC-008/api/（逐次请求、原始请求体和响应，x-request-id 按本案 ID 与请求序号区分）
  - evidence/TC-API-SYNC-008/server.log（真实后端本案时间段的访问与错误日志）

### TC-API-SYNC-009 history次数为0、缺省和1：入库visitCount最小值均为1

- 优先级：P1 ｜ 类别：boundary ｜ 技术：boundary
- 关联 Feature：F-SYNC-03
- 关联 AC：F-SYNC-03#AC1
- 关联 Code：C-BE-SYNC-02、C-BE-SYNC-03
- 前置条件：
  - 使用独占的真实 HTTP 后端 API_BASE（测试默认 http://127.0.0.1:4100），ENABLE_TEST_API=1，单请求超时 10 秒；禁止 mock 或 route 后端。
  - 每案自行执行 S1 清空页面、规则、同步日志及缓存，不依赖执行顺序；只通过 POST /api/sync 构造页面。
- 测试数据：T=Date.now()；三个不同URL https://example.com/count-zero、https://example.com/count-missing、https://example.com/count-one，lastVisitTime=T-600000，visitCount 分别为0、字段省略、1；activeTab=null、openTabs=[]。依据 PRD §6.1 的最小次数1。
- 步骤：
  - S1：POST /api/__test__/reset，请求体 {}，Content-Type: application/json。
  - S2：POST /api/sync（application/json），上传 testData 三条 history，响应记为 R。
  - S3：GET /api/pages/ranked?limit=500&now=<R.syncedAt>；GET /api/health。
- 预期：
  - E1：S1 返回 HTTP 200，body.ok=true。
  - E2：POST 返回 HTTP 200，(received,created,updated,rejected,pageCount)=(3,3,0,0,3)。
  - E3：ranked.total=3，count-zero、count-missing、count-one 三个页面的 visitCount 全部等于1。
  - E4：三个页面的 lastVisitedAt 均为 T-600000，sources 均为 ["history"]；health.pageCount=3。
- 证据：
  - evidence/TC-API-SYNC-009/result.json（执行后生成，设计阶段不标 PASS）
  - evidence/TC-API-SYNC-009/api/（逐次请求、原始请求体和响应，x-request-id 按本案 ID 与请求序号区分）
  - evidence/TC-API-SYNC-009/server.log（真实后端本案时间段的访问与错误日志）

### TC-API-SYNC-010 新历史标题为空字符串：title回退为原始URL

- 优先级：P0 ｜ 类别：positive ｜ 技术：equivalence
- 关联 Feature：F-SYNC-03
- 关联 AC：F-SYNC-03#AC3
- 关联 Code：C-BE-SYNC-02、C-BE-SYNC-03
- 前置条件：
  - 使用独占的真实 HTTP 后端 API_BASE（测试默认 http://127.0.0.1:4100），ENABLE_TEST_API=1，单请求超时 10 秒；禁止 mock 或 route 后端。
  - 每案自行执行 S1 清空页面、规则、同步日志及缓存，不依赖执行顺序；只通过 POST /api/sync 构造页面。
- 测试数据：T=Date.now()；payload={activeTab:null,openTabs:[],history:[{url:"https://example.com/a",title:"",lastVisitTime:T-600000,visitCount:1}]}。
- 步骤：
  - S1：POST /api/__test__/reset，请求体 {}，Content-Type: application/json。
  - S2：POST /api/sync（application/json），body=payload，响应记为 R。
  - S3：GET /api/pages/ranked?limit=500&now=<R.syncedAt>；GET /api/health。
- 预期：
  - E1：S1 返回 HTTP 200，body.ok=true。
  - E2：POST 返回 HTTP 200，(received,created,updated,rejected,pageCount)=(1,1,0,0,1)。
  - E3：ranked.total=1，唯一页面 url="https://example.com/a"，title="https://example.com/a"。
  - E4：该页 visitCount=1、lastVisitedAt=T-600000、sources=["history"]；health.pageCount=1。
- 证据：
  - evidence/TC-API-SYNC-010/result.json（执行后生成，设计阶段不标 PASS）
  - evidence/TC-API-SYNC-010/api/（逐次请求、原始请求体和响应，x-request-id 按本案 ID 与请求序号区分）
  - evidence/TC-API-SYNC-010/server.log（真实后端本案时间段的访问与错误日志）

### TC-API-SYNC-011 样例历史页之后成为openTab：sources累积history与open_tab

- 优先级：P0 ｜ 类别：positive ｜ 技术：state-transition
- 关联 Feature：F-SYNC-04
- 关联 AC：F-SYNC-04#AC1、F-SYNC-04#AC2
- 关联 Code：C-BE-SYNC-03、C-BE-SYNC-04
- 前置条件：
  - 使用独占的真实 HTTP 后端 API_BASE（测试默认 http://127.0.0.1:4100），ENABLE_TEST_API=1，单请求超时 10 秒；禁止 mock 或 route 后端。
  - 每案自行执行 S1 清空页面、规则、同步日志及缓存，不依赖执行顺序；只通过 POST /api/sync 构造页面。
- 测试数据：样例 P 是 resource.json 的深拷贝；T=Date.now()，delta=T-300000-max(resource.history.lastVisitTime)，P.history 每个 lastVisitTime 加 delta，activeTab/openTabs 保持原字段；整案重复上传复用同一个 P，不重新平移。读 ranked 使用 limit=500 与已保存的 now，页面按 normalizedUrl 查找，不依赖排序或生成的 id。 第二次 payload={activeTab:null,openTabs:[{url:"https://react.dev/learn"}],history:[]}。
- 步骤：
  - S1：POST /api/__test__/reset，请求体 {}，Content-Type: application/json。
  - S2：构造 P；POST /api/sync（application/json）上传，保存 R1；GET /api/pages/ranked?limit=500&now=<R1.syncedAt> 保存来源集合。
  - S3：POST /api/sync 提交第二次 payload，保存 R2；GET /api/pages/ranked?limit=500&now=<R2.syncedAt>；GET /api/health。
- 预期：
  - E1：S1 返回 HTTP 200，body.ok=true。
  - E2：第一次 ranked 中 https://react.dev/learn 的 sources=["history"]，isOpen=false。
  - E3：第二次 POST 返回 HTTP 200，(received,created,updated,rejected,pageCount)=(1,0,1,0,10)。
  - E4：第二次 https://react.dev/learn 的 sources 集合恰为 {history,open_tab}，isOpen=true。
  - E5：第二次 https://github.com/org/repo/pull/456 的 sources 仍为 {history,active_tab}，https://github.com/org/repo/issues/123 仍为 {history,open_tab}；全部来源数组无重复。
  - E6：health.pageCount=10，lastSyncAt=R2.syncedAt。
- 证据：
  - evidence/TC-API-SYNC-011/result.json（执行后生成，设计阶段不标 PASS）
  - evidence/TC-API-SYNC-011/api/（逐次请求、原始请求体和响应，x-request-id 按本案 ID 与请求序号区分）
  - evidence/TC-API-SYNC-011/server.log（真实后端本案时间段的访问与错误日志）

### TC-API-SYNC-012 同页重复openTab并转active后关闭：来源至多三种且关闭不删除历史来源

- 优先级：P1 ｜ 类别：boundary ｜ 技术：state-transition
- 关联 Feature：F-SYNC-04
- 关联 AC：F-SYNC-04#AC1、F-SYNC-04#AC2
- 关联 Code：C-BE-SYNC-03、C-BE-SYNC-04
- 前置条件：
  - 使用独占的真实 HTTP 后端 API_BASE（测试默认 http://127.0.0.1:4100），ENABLE_TEST_API=1，单请求超时 10 秒；禁止 mock 或 route 后端。
  - 每案自行执行 S1 清空页面、规则、同步日志及缓存，不依赖执行顺序；只通过 POST /api/sync 构造页面。
- 测试数据：T=Date.now()，U=https://example.com/sources；第一批只有 history:[{url:U,lastVisitTime:T-600000,visitCount:2}]；第二批 activeTab:{url:U}、openTabs:[{url:U},{url:U}]、history:[]；第三批 activeTab:null、openTabs:[]、history:[]。来源集合基数 1→3→3，重复同来源不增加第四项；该组合是来源并集规则的补充边界。
- 步骤：
  - S1：POST /api/__test__/reset，请求体 {}，Content-Type: application/json。
  - S2：POST /api/sync（application/json）导入第一批，保存 R1；GET /api/pages/ranked?limit=500&now=<R1.syncedAt>记录 U。
  - S3：POST /api/sync 导入第二批，保存 R2；GET /api/pages/ranked?limit=500&now=<R2.syncedAt>记录 U。
  - S4：POST /api/sync 导入第三批，保存 R3；GET /api/pages/ranked?limit=500&now=<R3.syncedAt>；GET /api/health。
- 预期：
  - E1：S1 返回 HTTP 200，body.ok=true。
  - E2：第一批返回 HTTP 200，pageCount=1，U.sources=["history"]。
  - E3：第二批返回 HTTP 200，(received,created,updated,rejected,pageCount)=(3,0,3,0,1)。
  - E4：第二批 U.sources 集合恰为 {history,open_tab,active_tab}，sources.length=3。
  - E5：第三批返回 HTTP 200，(received,created,updated,rejected,pageCount)=(0,0,0,0,1)。
  - E6：第三批 U.sources 集合仍恰为 {history,open_tab,active_tab}，sources.length=3；health.pageCount=1。
- 证据：
  - evidence/TC-API-SYNC-012/result.json（执行后生成，设计阶段不标 PASS）
  - evidence/TC-API-SYNC-012/api/（逐次请求、原始请求体和响应，x-request-id 按本案 ID 与请求序号区分）
  - evidence/TC-API-SYNC-012/server.log（真实后端本案时间段的访问与错误日志）

### TC-API-SYNC-013 第二批只保留两个openTabs与原activeTab：旧打开文档自动关闭

- 优先级：P0 ｜ 类别：positive ｜ 技术：state-transition
- 关联 Feature：F-SYNC-05
- 关联 AC：F-SYNC-05#AC1
- 关联 Code：C-BE-SYNC-05
- 前置条件：
  - 使用独占的真实 HTTP 后端 API_BASE（测试默认 http://127.0.0.1:4100），ENABLE_TEST_API=1，单请求超时 10 秒；禁止 mock 或 route 后端。
  - 每案自行执行 S1 清空页面、规则、同步日志及缓存，不依赖执行顺序；只通过 POST /api/sync 构造页面。
- 测试数据：样例 P 是 resource.json 的深拷贝；T=Date.now()，delta=T-300000-max(resource.history.lastVisitTime)，P.history 每个 lastVisitTime 加 delta，activeTab/openTabs 保持原字段；整案重复上传复用同一个 P，不重新平移。读 ranked 使用 limit=500 与已保存的 now，页面按 normalizedUrl 查找，不依赖排序或生成的 id。 第二批={activeTab:{url:"https://github.com/org/repo/pull/456"},openTabs:[{url:"https://github.com/org/repo/issues/123"},{url:"https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API"}],history:[]}。
- 步骤：
  - S1：POST /api/__test__/reset，请求体 {}，Content-Type: application/json。
  - S2：构造 P，POST /api/sync（application/json）导入样例，保存 R1；GET /api/pages/ranked?limit=500&now=<R1.syncedAt>记录初始打开集合。
  - S3：POST /api/sync 上传第二批，保存 R2；GET /api/pages/ranked?limit=500&now=<R2.syncedAt>；GET /api/health。
- 预期：
  - E1：S1 返回 HTTP 200，body.ok=true。
  - E2：首次 https://docs.internal.com/ai-agent-design.isOpen=true，https://github.com/org/repo/pull/456.isActive=true。
  - E3：第二次 POST 返回 HTTP 200，(received,created,updated,rejected,pageCount)=(3,0,3,0,10)。
  - E4：第二次 https://docs.internal.com/ai-agent-design.isOpen=false，https://github.com/org/repo/issues/123.isOpen=true，https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API.isOpen=true。
  - E5：第二次 isOpen=true 的 URL 集合恰为 {https://github.com/org/repo/pull/456,https://github.com/org/repo/issues/123,https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API}，isActive=true 的集合恰为 {https://github.com/org/repo/pull/456}。
  - E6：ranked.total=10，health.pageCount=10，没有因关闭标签页而删除页面。
- 证据：
  - evidence/TC-API-SYNC-013/result.json（执行后生成，设计阶段不标 PASS）
  - evidence/TC-API-SYNC-013/api/（逐次请求、原始请求体和响应，x-request-id 按本案 ID 与请求序号区分）
  - evidence/TC-API-SYNC-013/server.log（真实后端本案时间段的访问与错误日志）

### TC-API-SYNC-014 第二批activeTab=null：原活动页isOpen与isActive均清除

- 优先级：P0 ｜ 类别：positive ｜ 技术：state-transition
- 关联 Feature：F-SYNC-05
- 关联 AC：F-SYNC-05#AC1、F-SYNC-05#AC2
- 关联 Code：C-BE-SYNC-05
- 前置条件：
  - 使用独占的真实 HTTP 后端 API_BASE（测试默认 http://127.0.0.1:4100），ENABLE_TEST_API=1，单请求超时 10 秒；禁止 mock 或 route 后端。
  - 每案自行执行 S1 清空页面、规则、同步日志及缓存，不依赖执行顺序；只通过 POST /api/sync 构造页面。
- 测试数据：样例 P 是 resource.json 的深拷贝；T=Date.now()，delta=T-300000-max(resource.history.lastVisitTime)，P.history 每个 lastVisitTime 加 delta，activeTab/openTabs 保持原字段；整案重复上传复用同一个 P，不重新平移。读 ranked 使用 limit=500 与已保存的 now，页面按 normalizedUrl 查找，不依赖排序或生成的 id。 第二批={activeTab:null,openTabs:[{url:"https://github.com/org/repo/issues/123"},{url:"https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API"}],history:[]}。
- 步骤：
  - S1：POST /api/__test__/reset，请求体 {}，Content-Type: application/json。
  - S2：构造 P；POST /api/sync（application/json）导入样例，保存 R1；GET /api/pages/ranked?limit=500&now=<R1.syncedAt>记录原活动页。
  - S3：POST /api/sync 上传第二批，保存 R2；GET /api/pages/ranked?limit=500&now=<R2.syncedAt>；GET /api/health。
- 预期：
  - E1：S1 返回 HTTP 200，body.ok=true。
  - E2：首次 https://github.com/org/repo/pull/456.isOpen=true、isActive=true，https://docs.internal.com/ai-agent-design.isOpen=true。
  - E3：第二次 POST 返回 HTTP 200，(received,created,updated,rejected,pageCount)=(2,0,2,0,10)。
  - E4：第二次 https://github.com/org/repo/pull/456.isOpen=false 且 isActive=false，https://docs.internal.com/ai-agent-design.isOpen=false。
  - E5：第二次 isOpen=true 的 URL 集合恰为 {https://github.com/org/repo/issues/123,https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API}，isActive=true 的页面数=0。
  - E6：health.pageCount=10，lastSyncAt=R2.syncedAt。
- 证据：
  - evidence/TC-API-SYNC-014/result.json（执行后生成，设计阶段不标 PASS）
  - evidence/TC-API-SYNC-014/api/（逐次请求、原始请求体和响应，x-request-id 按本案 ID 与请求序号区分）
  - evidence/TC-API-SYNC-014/server.log（真实后端本案时间段的访问与错误日志）

### TC-API-SYNC-015 已导入样例后同步空对象：缺省空快照关闭全部页面但保留记录

- 优先级：P1 ｜ 类别：boundary ｜ 技术：boundary
- 关联 Feature：F-SYNC-05
- 关联 AC：F-SYNC-05#AC1、F-SYNC-05#AC2
- 关联 Code：C-BE-SYNC-05
- 前置条件：
  - 使用独占的真实 HTTP 后端 API_BASE（测试默认 http://127.0.0.1:4100），ENABLE_TEST_API=1，单请求超时 10 秒；禁止 mock 或 route 后端。
  - 每案自行执行 S1 清空页面、规则、同步日志及缓存，不依赖执行顺序；只通过 POST /api/sync 构造页面。
- 测试数据：样例 P 是 resource.json 的深拷贝；T=Date.now()，delta=T-300000-max(resource.history.lastVisitTime)，P.history 每个 lastVisitTime 加 delta，activeTab/openTabs 保持原字段；整案重复上传复用同一个 P，不重新平移。读 ranked 使用 limit=500 与已保存的 now，页面按 normalizedUrl 查找，不依赖排序或生成的 id。 第二次 payload={}；依据 /api/sync 契约，缺省 activeTab 等同 null，缺省 openTabs/history 等同 []。
- 步骤：
  - S1：POST /api/__test__/reset，请求体 {}，Content-Type: application/json。
  - S2：构造 P；POST /api/sync（application/json）导入样例，保存 R1；GET /api/pages/ranked?limit=500&now=<R1.syncedAt>记录页面 id 与来源。
  - S3：POST /api/sync（application/json）提交 {}，保存 R2；GET /api/pages/ranked?limit=500&now=<R2.syncedAt>；GET /api/health。
- 预期：
  - E1：S1 返回 HTTP 200，body.ok=true。
  - E2：第二次 POST 返回 HTTP 200，(received,created,updated,rejected,pageCount)=(0,0,0,0,10)。
  - E3：第二次 ranked.total=10，全部10页 isOpen=false、isActive=false。
  - E4：全部页面 id、sources、visitCount、lastVisitedAt、firstSeenAt、title 与空快照前相等。
  - E5：health.pageCount=10，lastSyncAt=R2.syncedAt。
- 证据：
  - evidence/TC-API-SYNC-015/result.json（执行后生成，设计阶段不标 PASS）
  - evidence/TC-API-SYNC-015/api/（逐次请求、原始请求体和响应，x-request-id 按本案 ID 与请求序号区分）
  - evidence/TC-API-SYNC-015/server.log（真实后端本案时间段的访问与错误日志）

### TC-API-SYNC-016 已有样例时openTabs为字符串：400且不得部分合并、补来源或清空打开快照

- 优先级：P1 ｜ 类别：negative ｜ 技术：error-guessing
- 关联 Feature：F-SYNC-01、F-SYNC-02、F-SYNC-03、F-SYNC-04、F-SYNC-05、F-SYNC-07
- 关联 AC：F-SYNC-01#AC1、F-SYNC-02#AC1、F-SYNC-03#AC1、F-SYNC-04#AC1、F-SYNC-05#AC1、F-SYNC-05#AC2、F-SYNC-07#AC2
- 关联 Code：C-BE-SYNC-01、C-BE-SYNC-02、C-BE-SYNC-03、C-BE-SYNC-04、C-BE-SYNC-05、C-BE-CORE-08
- 前置条件：
  - 使用独占的真实 HTTP 后端 API_BASE（测试默认 http://127.0.0.1:4100），ENABLE_TEST_API=1，单请求超时 10 秒；禁止 mock 或 route 后端。
  - 每案自行执行 S1 清空页面、规则、同步日志及缓存，不依赖执行顺序；只通过 POST /api/sync 构造页面。
- 测试数据：样例 P 是 resource.json 的深拷贝；T=Date.now()，delta=T-300000-max(resource.history.lastVisitTime)，P.history 每个 lastVisitTime 加 delta，activeTab/openTabs 保持原字段；整案重复上传复用同一个 P，不重新平移。读 ranked 使用 limit=500 与已保存的 now，页面按 normalizedUrl 查找，不依赖排序或生成的 id。 Q(Pages) 将 ranked.pages 按 normalizedUrl 排序，只投影 id、url、normalizedUrl、title、domain、visitCount、lastVisitedAt、firstSeenAt、sources（按集合比较）、isOpen、isActive、isImportant；排除 score、scoreDetail、reason、generatedAt。H 保存 health.pageCount、ruleCount、enabledRuleCount、lastSyncAt；失败后使用同一个 now 回读。 非法请求={activeTab:{url:"https://react.dev/learn"},openTabs:"bad",history:[{url:"https://github.com/org/repo/issues/123",title:"Changed",lastVisitTime:T-60000,visitCount:999},{url:"https://example.com/must-not-create",lastVisitTime:T-60000,visitCount:1}]}。
- 步骤：
  - S1：POST /api/__test__/reset，请求体 {}，Content-Type: application/json。
  - S2：构造 P；POST /api/sync 导入，保存 R0；GET /api/pages/ranked?limit=500&now=<R0.syncedAt>与 GET /api/health，保存 Q0/H0。
  - S3：POST /api/sync（application/json），提交上述非法请求，响应记为 Bad。
  - S4：GET /api/pages/ranked?limit=500&now=<R0.syncedAt> 与 GET /api/health，得到 Q1/H1。
- 预期：
  - E1：S1 返回 HTTP 200，body.ok=true。
  - E2：Bad 返回 HTTP 400，error.code="VALIDATION_FAILED"，error.message 是非空字符串。
  - E3：Bad.error.details.fields 包含 "openTabs"。
  - E4：Q1 与 Q0 深度相等：已有页面的次数、标题、时间、来源和 isOpen/isActive 均未改变，新URL不存在。
  - E5：H1 与 H0 相等，pageCount=10，lastSyncAt=R0.syncedAt，未提交部分同步。
- 证据：
  - evidence/TC-API-SYNC-016/result.json（执行后生成，设计阶段不标 PASS）
  - evidence/TC-API-SYNC-016/api/（逐次请求、原始请求体和响应，x-request-id 按本案 ID 与请求序号区分）
  - evidence/TC-API-SYNC-016/server.log（真实后端本案时间段的访问与错误日志）

### TC-API-SYNC-017 空库收到非法JSON：400 INVALID_JSON且pageCount保持0

- 优先级：P1 ｜ 类别：exception ｜ 技术：error-guessing
- 关联 Feature：F-SYNC-07
- 关联 AC：F-SYNC-07#AC1
- 关联 Code：C-BE-SYNC-01、C-BE-CORE-05
- 前置条件：
  - 使用独占的真实 HTTP 后端 API_BASE（测试默认 http://127.0.0.1:4100），ENABLE_TEST_API=1，单请求超时 10 秒；禁止 mock 或 route 后端。
  - 每案自行执行 S1 清空页面、规则、同步日志及缓存，不依赖执行顺序；只通过 POST /api/sync 构造页面。
- 测试数据：原始 UTF-8 请求体为 {bad（4字节）；Content-Type: application/json。必须用 raw data/字符串传输，不得让 JSON 客户端把它序列化成合法 JSON 字符串。
- 步骤：
  - S1：POST /api/__test__/reset，请求体 {}，Content-Type: application/json。
  - S2：POST /api/sync，Content-Type: application/json，原始 body={bad，响应记为 Bad。
  - S3：GET /api/health；GET /api/pages/ranked?limit=500&now=<Date.now()>。
- 预期：
  - E1：S1 返回 HTTP 200，body.ok=true。
  - E2：Bad 返回 HTTP 400，body.error.code="INVALID_JSON"，body.error.message 是非空字符串。
  - E3：health 返回 HTTP 200，pageCount=0、lastSyncAt=null。
  - E4：ranked 返回 HTTP 200，pages=[]、total=0，没有解析失败产生的页面。
- 证据：
  - evidence/TC-API-SYNC-017/result.json（执行后生成，设计阶段不标 PASS）
  - evidence/TC-API-SYNC-017/api/（逐次请求、原始请求体和响应，x-request-id 按本案 ID 与请求序号区分）
  - evidence/TC-API-SYNC-017/server.log（真实后端本案时间段的访问与错误日志）

### TC-API-SYNC-018 JSON解析异常后恢复：原页面与同步快照不变且合法重试仍幂等

- 优先级：P1 ｜ 类别：exception ｜ 技术：state-transition
- 关联 Feature：F-SYNC-01、F-SYNC-02、F-SYNC-03、F-SYNC-04、F-SYNC-05、F-SYNC-07
- 关联 AC：F-SYNC-01#AC1、F-SYNC-02#AC1、F-SYNC-03#AC1、F-SYNC-04#AC1、F-SYNC-05#AC1、F-SYNC-05#AC2、F-SYNC-07#AC1
- 关联 Code：C-BE-SYNC-01、C-BE-SYNC-02、C-BE-SYNC-03、C-BE-SYNC-04、C-BE-SYNC-05、C-BE-CORE-05
- 前置条件：
  - 使用独占的真实 HTTP 后端 API_BASE（测试默认 http://127.0.0.1:4100），ENABLE_TEST_API=1，单请求超时 10 秒；禁止 mock 或 route 后端。
  - 每案自行执行 S1 清空页面、规则、同步日志及缓存，不依赖执行顺序；只通过 POST /api/sync 构造页面。
- 测试数据：样例 P 是 resource.json 的深拷贝；T=Date.now()，delta=T-300000-max(resource.history.lastVisitTime)，P.history 每个 lastVisitTime 加 delta，activeTab/openTabs 保持原字段；整案重复上传复用同一个 P，不重新平移。读 ranked 使用 limit=500 与已保存的 now，页面按 normalizedUrl 查找，不依赖排序或生成的 id。 Q(Pages) 将 ranked.pages 按 normalizedUrl 排序，只投影 id、url、normalizedUrl、title、domain、visitCount、lastVisitedAt、firstSeenAt、sources（按集合比较）、isOpen、isActive、isImportant；排除 score、scoreDetail、reason、generatedAt。H 保存 health.pageCount、ruleCount、enabledRuleCount、lastSyncAt；失败后使用同一个 now 回读。 BadRaw 为 JSON.stringify({activeTab:{url:"https://react.dev/learn"},openTabs:[],history:[{url:"https://github.com/org/repo/issues/123",visitCount:999,lastVisitTime:T-60000}]}) 删除末尾右花括号后的原始字节。解析器实际抛出的异常必须转为契约400；此案验证请求解析依赖失败对各合并规则的影响，不假装触发磁盘故障或数据库故障。
- 步骤：
  - S1：POST /api/__test__/reset，请求体 {}，Content-Type: application/json。
  - S2：构造 P；POST /api/sync 导入，保存 R0；GET /api/pages/ranked?limit=500&now=<R0.syncedAt>与 GET /api/health，保存 Q0/H0。
  - S3：POST /api/sync，Content-Type: application/json，原始 body=BadRaw，响应记为 Bad；Content-Length 与实际 BadRaw 字节长度一致，不模拟超时。
  - S4：GET /api/pages/ranked?limit=500&now=<R0.syncedAt>和 GET /api/health，保存 Q1/H1。
  - S5：合法重试：POST /api/sync（application/json）提交未改变的 P，保存 R2；GET /api/pages/ranked?limit=500&now=<R2.syncedAt> 与 GET /api/health。
- 预期：
  - E1：S1 返回 HTTP 200，body.ok=true。
  - E2：Bad 返回 HTTP 400，error.code="INVALID_JSON"，error.message 是非空字符串。
  - E3：Q1=Q0、H1=H0（深度相等），pageCount=10、lastSyncAt=R0.syncedAt；异常不改变任何页面、来源或打开快照。
  - E4：重试返回 HTTP 200，(received,created,updated,rejected,pageCount)=(14,0,14,0,10)。
  - E5：重试后 https://github.com/org/repo/issues/123.visitCount=8、sources={history,open_tab}，https://github.com/org/repo/pull/456.lastVisitedAt=R2.syncedAt，打开集合与样例相等。
  - E6：重试后 health.pageCount=10，lastSyncAt=R2.syncedAt；不使用 mock 或新增故障注入接口。
- 证据：
  - evidence/TC-API-SYNC-018/result.json（执行后生成，设计阶段不标 PASS）
  - evidence/TC-API-SYNC-018/api/（逐次请求、原始请求体和响应，x-request-id 按本案 ID 与请求序号区分）
  - evidence/TC-API-SYNC-018/server.log（真实后端本案时间段的访问与错误日志）

### TC-API-SYNC-019 history恰好500条：全部接收并可按limit=500完整回读

- 优先级：P1 ｜ 类别：boundary ｜ 技术：boundary
- 关联 Feature：F-SYNC-02、F-SYNC-07
- 关联 AC：F-SYNC-02#AC1、F-SYNC-07#AC3
- 关联 Code：C-BE-SYNC-01、C-BE-SYNC-02、C-BE-SYNC-04
- 前置条件：
  - 使用独占的真实 HTTP 后端 API_BASE（测试默认 http://127.0.0.1:4100），ENABLE_TEST_API=1，单请求超时 10 秒；禁止 mock 或 route 后端。
  - 每案自行执行 S1 清空页面、规则、同步日志及缓存，不依赖执行顺序；只通过 POST /api/sync 构造页面。
- 测试数据：T=Date.now()；activeTab=null，openTabs=[]；history 为 i=0..499 的500条不同URL https://example.com/history/<i>，lastVisitTime=T-600000-i*1000，visitCount=1；JSON 字节数小于1_048_576。
- 步骤：
  - S1：POST /api/__test__/reset，请求体 {}，Content-Type: application/json。
  - S2：本案生成500条 history；POST /api/sync（application/json），响应记为 R。
  - S3：GET /api/pages/ranked?limit=500&now=<R.syncedAt>；GET /api/health。
- 预期：
  - E1：S1 返回 HTTP 200，body.ok=true。
  - E2：POST 返回 HTTP 200，(received,created,updated,rejected,pageCount)=(500,500,0,0,500)。
  - E3：ranked 返回 HTTP 200，total=500、pages.length=500，normalizedUrl 集合恰为构造的500个URL。
  - E4：health.pageCount=500，没有第500条被当作超限而丢弃。
- 证据：
  - evidence/TC-API-SYNC-019/result.json（执行后生成，设计阶段不标 PASS）
  - evidence/TC-API-SYNC-019/api/（逐次请求、原始请求体和响应，x-request-id 按本案 ID 与请求序号区分）
  - evidence/TC-API-SYNC-019/server.log（真实后端本案时间段的访问与错误日志）

### TC-API-SYNC-020 history为501条：413且不得部分写入前500条

- 优先级：P2 ｜ 类别：boundary ｜ 技术：boundary
- 关联 Feature：F-SYNC-07
- 关联 AC：F-SYNC-07#AC3
- 关联 Code：C-BE-SYNC-01
- 前置条件：
  - 使用独占的真实 HTTP 后端 API_BASE（测试默认 http://127.0.0.1:4100），ENABLE_TEST_API=1，单请求超时 10 秒；禁止 mock 或 route 后端。
  - 每案自行执行 S1 清空页面、规则、同步日志及缓存，不依赖执行顺序；只通过 POST /api/sync 构造页面。
- 测试数据：T=Date.now()；activeTab=null，openTabs=[]；history 是 i=0..500 的501条不同URL https://example.com/over-history/<i>，lastVisitTime=T-600000、visitCount=1；body 小于1 MB，排除字节上限干扰。
- 步骤：
  - S1：POST /api/__test__/reset，请求体 {}，Content-Type: application/json。
  - S2：本案构造501条 history；POST /api/sync（application/json），响应记为 Bad。
  - S3：GET /api/health；GET /api/pages/ranked?limit=500&now=<T>。
- 预期：
  - E1：S1 返回 HTTP 200，body.ok=true。
  - E2：Bad 返回 HTTP 413，error.code="PAYLOAD_TOO_LARGE"，error.message 是非空字符串。
  - E3：health.pageCount=0、lastSyncAt=null，未部分写入前500条。
  - E4：ranked 返回 HTTP 200，total=0、pages=[]。
- 证据：
  - evidence/TC-API-SYNC-020/result.json（执行后生成，设计阶段不标 PASS）
  - evidence/TC-API-SYNC-020/api/（逐次请求、原始请求体和响应，x-request-id 按本案 ID 与请求序号区分）
  - evidence/TC-API-SYNC-020/server.log（真实后端本案时间段的访问与错误日志）

### TC-API-SYNC-021 openTabs从500到501条：上限内全打开、超限后保留上次快照

- 优先级：P2 ｜ 类别：boundary ｜ 技术：boundary
- 关联 Feature：F-SYNC-05、F-SYNC-07
- 关联 AC：F-SYNC-05#AC1、F-SYNC-05#AC2、F-SYNC-07#AC3
- 关联 Code：C-BE-SYNC-01、C-BE-SYNC-05
- 前置条件：
  - 使用独占的真实 HTTP 后端 API_BASE（测试默认 http://127.0.0.1:4100），ENABLE_TEST_API=1，单请求超时 10 秒；禁止 mock 或 route 后端。
  - 每案自行执行 S1 清空页面、规则、同步日志及缓存，不依赖执行顺序；只通过 POST /api/sync 构造页面。
- 测试数据：T=Date.now()；P500={activeTab:null,openTabs: i=0..499 的 {url:"https://example.com/tabs/<i>",lastAccessed:T-600000},history:[]}；P501 在这500条之外加入 https://example.com/tabs/500，并将 activeTab 改为新URL https://example.com/must-not-activate。两批 JSON 都小于1 MB；history始终为空，因此单独检查 openTabs 上限。Q(Pages) 将 ranked.pages 按 normalizedUrl 排序，只投影 id、url、normalizedUrl、title、domain、visitCount、lastVisitedAt、firstSeenAt、sources（按集合比较）、isOpen、isActive、isImportant；排除 score、scoreDetail、reason、generatedAt。H 保存 health.pageCount、ruleCount、enabledRuleCount、lastSyncAt；失败后使用同一个 now 回读。
- 步骤：
  - S1：POST /api/__test__/reset，请求体 {}，Content-Type: application/json。
  - S2：POST /api/sync（application/json）提交 P500，保存 R0；GET /api/pages/ranked?limit=500&now=<R0.syncedAt>与 GET /api/health，保存 Q0/H0。
  - S3：POST /api/sync（application/json）提交 P501，保存 Bad。
  - S4：GET /api/pages/ranked?limit=500&now=<R0.syncedAt> 与 GET /api/health，保存 Q1/H1。
- 预期：
  - E1：S1 返回 HTTP 200，body.ok=true。
  - E2：P500 返回 HTTP 200，(received,created,updated,rejected,pageCount)=(500,500,0,0,500)。
  - E3：Q0 含500个页面，全部 isOpen=true、isActive=false、sources=["open_tab"]。
  - E4：P501 返回 HTTP 413，error.code="PAYLOAD_TOO_LARGE"，error.message 是非空字符串。
  - E5：Q1=Q0、H1=H0（深度相等），pageCount=500、lastSyncAt=R0.syncedAt；新URL不存在，旧快照未变化。
- 证据：
  - evidence/TC-API-SYNC-021/result.json（执行后生成，设计阶段不标 PASS）
  - evidence/TC-API-SYNC-021/api/（逐次请求、原始请求体和响应，x-request-id 按本案 ID 与请求序号区分）
  - evidence/TC-API-SYNC-021/server.log（真实后端本案时间段的访问与错误日志）

### TC-API-SYNC-022 javascript记录旁有合法HTTPS历史：200拒收1条但合法页入库

- 优先级：P1 ｜ 类别：positive ｜ 技术：equivalence
- 关联 Feature：F-SYNC-07
- 关联 AC：F-SYNC-07#AC4
- 关联 Code：C-BE-SYNC-01、C-BE-SYNC-02
- 前置条件：
  - 使用独占的真实 HTTP 后端 API_BASE（测试默认 http://127.0.0.1:4100），ENABLE_TEST_API=1，单请求超时 10 秒；禁止 mock 或 route 后端。
  - 每案自行执行 S1 清空页面、规则、同步日志及缓存，不依赖执行顺序；只通过 POST /api/sync 构造页面。
- 测试数据：T=Date.now()；payload={activeTab:null,openTabs:[],history:[{url:"javascript:alert(1)",lastVisitTime:T-600000,visitCount:1},{url:"https://example.com/ok",title:"OK page",lastVisitTime:T-600000,visitCount:1}]}。
- 步骤：
  - S1：POST /api/__test__/reset，请求体 {}，Content-Type: application/json。
  - S2：POST /api/sync（application/json），body=payload，响应记为 R。
  - S3：GET /api/pages/ranked?limit=500&now=<R.syncedAt>；GET /api/health。
- 预期：
  - E1：S1 返回 HTTP 200，body.ok=true。
  - E2：POST 返回 HTTP 200，R.ok=true，(received,created,updated,rejected,pageCount)=(2,1,0,1,1)。
  - E3：R.rejectedByReason={invalid_url:1,privacy:0}，单条坏URL不转换为整请求400。
  - E4：ranked 返回 HTTP 200，total=1，唯一页面 normalizedUrl="https://example.com/ok"、title="OK page"。
  - E5：ranked 中 javascript: URL 数量=0，health.pageCount=1。
- 证据：
  - evidence/TC-API-SYNC-022/result.json（执行后生成，设计阶段不标 PASS）
  - evidence/TC-API-SYNC-022/api/（逐次请求、原始请求体和响应，x-request-id 按本案 ID 与请求序号区分）
  - evidence/TC-API-SYNC-022/server.log（真实后端本案时间段的访问与错误日志）

### TC-API-SYNC-023 URL长度2048与2049字符：接收上限内记录、超长计入rejected

- 优先级：P2 ｜ 类别：boundary ｜ 技术：boundary
- 关联 Feature：F-SYNC-02、F-SYNC-07
- 关联 AC：F-SYNC-02#AC2、F-SYNC-07#AC4
- 关联 Code：C-BE-SYNC-02、C-BE-SYNC-04、C-BE-CORE-09
- 前置条件：
  - 使用独占的真实 HTTP 后端 API_BASE（测试默认 http://127.0.0.1:4100），ENABLE_TEST_API=1，单请求超时 10 秒；禁止 mock 或 route 后端。
  - 每案自行执行 S1 清空页面、规则、同步日志及缓存，不依赖执行顺序；只通过 POST /api/sync 构造页面。
- 测试数据：T=Date.now()，prefix="https://example.com/length/"；U2048=prefix+"a".repeat(2048-prefix.length)，U2049=U2048+"a"；用ASCII确保字符长度即字节长度。activeTab=null、openTabs=[]，history 为这两个URL，lastVisitTime=T-600000、visitCount=1；body小于1MB。
- 步骤：
  - S1：POST /api/__test__/reset，请求体 {}，Content-Type: application/json。
  - S2：本案构造 U2048/U2049 并先验证 length 分别2048、2049；POST /api/sync（application/json）上传两条历史，记为 R。
  - S3：GET /api/pages/ranked?limit=500&now=<R.syncedAt>；GET /api/health。
- 预期：
  - E1：S1 返回 HTTP 200，body.ok=true。
  - E2：POST 返回 HTTP 200，(received,created,updated,rejected,pageCount)=(2,1,0,1,1)。
  - E3：R.rejectedByReason={invalid_url:1,privacy:0}。
  - E4：ranked.total=1，唯一页面 normalizedUrl=U2048，normalizedUrl.length=2048，U2049 不存在。
  - E5：health.pageCount=1，2049字符记录既不建立新主键也不更新合法页面。
- 证据：
  - evidence/TC-API-SYNC-023/result.json（执行后生成，设计阶段不标 PASS）
  - evidence/TC-API-SYNC-023/api/（逐次请求、原始请求体和响应，x-request-id 按本案 ID 与请求序号区分）
  - evidence/TC-API-SYNC-023/server.log（真实后端本案时间段的访问与错误日志）

### TC-API-SYNC-024 已有样例时Content-Type为text/plain：415且页面和上次同步时间不变

- 优先级：P2 ｜ 类别：negative ｜ 技术：equivalence
- 关联 Feature：F-SYNC-07
- 关联 AC：F-SYNC-07#AC1、F-SYNC-07#AC2
- 关联 Code：C-BE-SYNC-01、C-BE-CORE-05
- 前置条件：
  - 使用独占的真实 HTTP 后端 API_BASE（测试默认 http://127.0.0.1:4100），ENABLE_TEST_API=1，单请求超时 10 秒；禁止 mock 或 route 后端。
  - 每案自行执行 S1 清空页面、规则、同步日志及缓存，不依赖执行顺序；只通过 POST /api/sync 构造页面。
- 测试数据：样例 P 是 resource.json 的深拷贝；T=Date.now()，delta=T-300000-max(resource.history.lastVisitTime)，P.history 每个 lastVisitTime 加 delta，activeTab/openTabs 保持原字段；整案重复上传复用同一个 P，不重新平移。读 ranked 使用 limit=500 与已保存的 now，页面按 normalizedUrl 查找，不依赖排序或生成的 id。 Q(Pages) 将 ranked.pages 按 normalizedUrl 排序，只投影 id、url、normalizedUrl、title、domain、visitCount、lastVisitedAt、firstSeenAt、sources（按集合比较）、isOpen、isActive、isImportant；排除 score、scoreDetail、reason、generatedAt。H 保存 health.pageCount、ruleCount、enabledRuleCount、lastSyncAt；失败后使用同一个 now 回读。 契约扩展反例：发送文本 "{}"，显式 Content-Type: text/plain；这是合法JSON字节但媒体类型不支持，不能误判 INVALID_JSON。
- 步骤：
  - S1：POST /api/__test__/reset，请求体 {}，Content-Type: application/json。
  - S2：构造 P；POST /api/sync（application/json）导入，记为 R0；GET /api/pages/ranked?limit=500&now=<R0.syncedAt>与 GET /api/health，保存 Q0/H0。
  - S3：POST /api/sync，Content-Type: text/plain，原始 UTF-8 body="{}"，响应记为 Bad。
  - S4：GET /api/pages/ranked?limit=500&now=<R0.syncedAt> 与 GET /api/health，得到 Q1/H1。
- 预期：
  - E1：S1 返回 HTTP 200，body.ok=true。
  - E2：Bad 返回 HTTP 415，error.code="UNSUPPORTED_MEDIA_TYPE"，error.message 是非空字符串。
  - E3：Q1=Q0、H1=H0（深度相等），pageCount=10、lastSyncAt=R0.syncedAt，空体内容不能清除打开快照。
- 证据：
  - evidence/TC-API-SYNC-024/result.json（执行后生成，设计阶段不标 PASS）
  - evidence/TC-API-SYNC-024/api/（逐次请求、原始请求体和响应，x-request-id 按本案 ID 与请求序号区分）
  - evidence/TC-API-SYNC-024/server.log（真实后端本案时间段的访问与错误日志）

### TC-API-SYNC-025 请求体恰好1MB与超出1字节：前者200、后者413且无副作用

- 优先级：P2 ｜ 类别：boundary ｜ 技术：boundary
- 关联 Feature：F-SYNC-07
- 关联 AC：F-SYNC-07#AC3
- 关联 Code：C-BE-SYNC-01、C-BE-SYNC-02、C-BE-CORE-05
- 前置条件：
  - 使用独占的真实 HTTP 后端 API_BASE（测试默认 http://127.0.0.1:4100），ENABLE_TEST_API=1，单请求超时 10 秒；禁止 mock 或 route 后端。
  - 每案自行执行 S1 清空页面、规则、同步日志及缓存，不依赖执行顺序；只通过 POST /api/sync 构造页面。
- 测试数据：T=Date.now()；K={activeTab:null,openTabs:[],history:[{url:"https://example.com/body",title:"",lastVisitTime:T-600000,visitCount:1}]}；b0=Buffer.byteLength(JSON.stringify(K),"utf8")，将 title 设为 "a".repeat(1048576-b0)，序列化为 Raw1；Raw2 仅将该 title 再加一个 a 后重新序列化。必须断言两次实际发送的原始UTF-8字节长度分别1048576、1048577（1MB=1_048_576），客户端不能二次JSON编码。title过长按后端方案§5.1截断500字符。Q(Pages) 将 ranked.pages 按 normalizedUrl 排序，只投影 id、url、normalizedUrl、title、domain、visitCount、lastVisitedAt、firstSeenAt、sources（按集合比较）、isOpen、isActive、isImportant；排除 score、scoreDetail、reason、generatedAt。H 保存 health.pageCount、ruleCount、enabledRuleCount、lastSyncAt；失败后使用同一个 now 回读。
- 步骤：
  - S1：POST /api/__test__/reset，请求体 {}，Content-Type: application/json。
  - S2：构造 Raw1、Raw2 并核实字节长度；POST /api/sync（Content-Type: application/json，原始 body=Raw1），保存 R0。
  - S3：GET /api/pages/ranked?limit=500&now=<R0.syncedAt>与 GET /api/health，保存 Q0/H0。
  - S4：POST /api/sync（Content-Type: application/json，原始 body=Raw2），保存 Bad。
  - S5：GET /api/pages/ranked?limit=500&now=<R0.syncedAt> 与 GET /api/health，得到 Q1/H1。
- 预期：
  - E1：S1 返回 HTTP 200，body.ok=true。
  - E2：Raw1 返回 HTTP 200，(received,created,updated,rejected,pageCount)=(1,1,0,0,1)。
  - E3：Q0 只有 normalizedUrl="https://example.com/body" 的页面，title="a".repeat(500)，visitCount=1。
  - E4：Raw2 返回 HTTP 413，error.code="PAYLOAD_TOO_LARGE"，error.message 是非空字符串。
  - E5：Q1=Q0、H1=H0（深度相等），pageCount=1、lastSyncAt=R0.syncedAt，超限请求没有刷新同步状态。
- 证据：
  - evidence/TC-API-SYNC-025/result.json（执行后生成，设计阶段不标 PASS）
  - evidence/TC-API-SYNC-025/api/（逐次请求、原始请求体和响应，x-request-id 按本案 ID 与请求序号区分）
  - evidence/TC-API-SYNC-025/server.log（真实后端本案时间段的访问与错误日志）

### TC-API-SYNC-026 history时间超过当前十分钟：按本次服务器时间截断且不污染未来排序

- 优先级：P1 ｜ 类别：boundary ｜ 技术：boundary
- 关联 Feature：F-SYNC-03
- 关联 AC：F-SYNC-03#AC2
- 关联 Code：C-BE-SYNC-02、C-BE-SYNC-03
- 前置条件：
  - 使用独占的真实 HTTP 后端 API_BASE（测试默认 http://127.0.0.1:4100），ENABLE_TEST_API=1，单请求超时 10 秒；禁止 mock 或 route 后端。
  - 每案自行执行 S1 清空页面、规则、同步日志及缓存，不依赖执行顺序；只通过 POST /api/sync 构造页面。
- 测试数据：T=Date.now()；history=[{url:"https://example.com/future",lastVisitTime:T+600000,visitCount:8}]，activeTab=null、openTabs=[]。依据D-01，超过服务器现在+5分钟的客户端时间按服务器现在处理；用+10分钟留出处理裕量，不测不稳定的+5分钟等值。
- 步骤：
  - S1：POST /api/__test__/reset，请求体 {}，Content-Type: application/json。
  - S2：记录 T、构造上述 payload；POST /api/sync（application/json），保存 R。
  - S3：GET /api/pages/ranked?limit=500&now=<R.syncedAt>；GET /api/health。
- 预期：
  - E1：S1 返回 HTTP 200，body.ok=true。
  - E2：POST 返回 HTTP 200，(received,created,updated,rejected,pageCount)=(1,1,0,0,1)。
  - E3：唯一页面 lastVisitedAt=R.syncedAt、firstSeenAt=R.syncedAt，lastVisitedAt 不等于 T+600000。
  - E4：唯一页面 visitCount=8、sources=["history"]、isOpen=false、isActive=false。
  - E5：health.pageCount=1、lastSyncAt=R.syncedAt。
- 证据：
  - evidence/TC-API-SYNC-026/result.json（执行后生成，设计阶段不标 PASS）
  - evidence/TC-API-SYNC-026/api/（逐次请求、原始请求体和响应，x-request-id 按本案 ID 与请求序号区分）
  - evidence/TC-API-SYNC-026/server.log（真实后端本案时间段的访问与错误日志）

### TC-API-SYNC-027 根节点、activeTab、history与mode类型非法：每个等价类均400且无入库

- 优先级：P2 ｜ 类别：negative ｜ 技术：decision-table
- 关联 Feature：F-SYNC-07
- 关联 AC：F-SYNC-07#AC2
- 关联 Code：C-BE-SYNC-01、C-BE-CORE-08
- 前置条件：
  - 使用独占的真实 HTTP 后端 API_BASE（测试默认 http://127.0.0.1:4100），ENABLE_TEST_API=1，单请求超时 10 秒；禁止 mock 或 route 后端。
  - 每案自行执行 S1 清空页面、规则、同步日志及缓存，不依赖执行顺序；只通过 POST /api/sync 构造页面。
- 测试数据：表格每一行是独立请求值：null、[]、42、"text"、{activeTab:"bad"}、{openTabs:{}}、{history:"bad"}、{mode:"unknown"}。每行都用 JSON.stringify 得到原始请求字节并显式 application/json，尤其 null 不能被客户端当成省略body；不测违反协议的空请求体。
- 步骤：
  - S1：POST /api/__test__/reset，请求体 {}，Content-Type: application/json。
  - S2：遍历 testData 八行；每行先 POST /api/__test__/reset {}，再 POST /api/sync（application/json，原始 body=JSON.stringify(该行)）。
  - S3：每行随后 GET /api/health 与 GET /api/pages/ranked?limit=500&now=<Date.now()>，记录每行的请求、响应和回读。
- 预期：
  - E1：S1 返回 HTTP 200，body.ok=true。
  - E2：表格的8个 POST /api/sync 均返回 HTTP 400、error.code="VALIDATION_FAILED"、error.message 非空字符串。
  - E3：每行后 health.pageCount=0、lastSyncAt=null。
  - E4：每行后 ranked 返回 HTTP 200，total=0、pages=[]；root null/array 不得当作空对象接受。
- 证据：
  - evidence/TC-API-SYNC-027/result.json（执行后生成，设计阶段不标 PASS）
  - evidence/TC-API-SYNC-027/api/（逐次请求、原始请求体和响应，x-request-id 按本案 ID 与请求序号区分）
  - evidence/TC-API-SYNC-027/server.log（真实后端本案时间段的访问与错误日志）

### TC-API-SYNC-028 query换序并移除跟踪参数：仅业务值真正改变时新增主键

- 优先级：P1 ｜ 类别：boundary ｜ 技术：decision-table
- 关联 Feature：F-SYNC-02
- 关联 AC：F-SYNC-02#AC2、F-SYNC-02#AC3
- 关联 Code：C-BE-SYNC-03、C-BE-SYNC-04、C-BE-CORE-09
- 前置条件：
  - 使用独占的真实 HTTP 后端 API_BASE（测试默认 http://127.0.0.1:4100），ENABLE_TEST_API=1，单请求超时 10 秒；禁止 mock 或 route 后端。
  - 每案自行执行 S1 清空页面、规则、同步日志及缓存，不依赖执行顺序；只通过 POST /api/sync 构造页面。
- 测试数据：T=Date.now()；history 的3个URL依次 https://example.com/a?b=2&a=1&utm_source=x#first、https://EXAMPLE.com/a/?a=1&b=2#second、https://example.com/a?a=1&b=3；lastVisitTime=T-600000，visitCount=1；activeTab=null、openTabs=[]。前两条只改变表示，第三条仅把业务参数b从2改为3，作为归一化去重决策边界。
- 步骤：
  - S1：POST /api/__test__/reset，请求体 {}，Content-Type: application/json。
  - S2：POST /api/sync（application/json）提交 testData 三条历史，保存 R。
  - S3：GET /api/pages/ranked?limit=500&now=<R.syncedAt>；GET /api/health。
- 预期：
  - E1：S1 返回 HTTP 200，body.ok=true。
  - E2：POST 返回 HTTP 200，(received,created,updated,rejected,pageCount)=(3,2,1,0,2)。
  - E3：ranked.total=2，normalizedUrl 集合恰为 {https://example.com/a?a=1&b=2,https://example.com/a?a=1&b=3}。
  - E4：health.pageCount=2，没有因query顺序、跟踪参数、hash或host大小写多建页面，也没有吞掉业务参数差异。
- 证据：
  - evidence/TC-API-SYNC-028/result.json（执行后生成，设计阶段不标 PASS）
  - evidence/TC-API-SYNC-028/api/（逐次请求、原始请求体和响应，x-request-id 按本案 ID 与请求序号区分）
  - evidence/TC-API-SYNC-028/server.log（真实后端本案时间段的访问与错误日志）

## Feature → AC → Case 覆盖表

| Feature | AC | 接口用例 | 范围 |
|---|---|---|---|
| F-SYNC-01 | AC1 | TC-API-SYNC-001、TC-API-SYNC-006、TC-API-SYNC-016、TC-API-SYNC-018 | 接口接收/落库；点击由 UI 验证 |
| F-SYNC-01 | AC2 | TC-API-SYNC-002 | 已过滤请求前提；完整前端过滤由 UI 验证 |
| F-SYNC-01 | AC3 | TC-API-SYNC-001 | 一次上报的 BE 结果；按钮防重入由 UI 验证 |
| F-SYNC-02 | AC1 | TC-API-SYNC-003、TC-API-SYNC-006、TC-API-SYNC-007、TC-API-SYNC-016、TC-API-SYNC-018、TC-API-SYNC-019 | 含该 AC 正例及关联反例/边界/异常 |
| F-SYNC-02 | AC2 | TC-API-SYNC-004、TC-API-SYNC-023、TC-API-SYNC-028 | 含该 AC 正例及关联反例/边界/异常 |
| F-SYNC-02 | AC3 | TC-API-SYNC-005、TC-API-SYNC-028 | 含该 AC 正例及关联反例/边界/异常 |
| F-SYNC-03 | AC1 | TC-API-SYNC-007、TC-API-SYNC-008、TC-API-SYNC-009、TC-API-SYNC-016、TC-API-SYNC-018 | 含该 AC 正例及关联反例/边界/异常 |
| F-SYNC-03 | AC2 | TC-API-SYNC-003、TC-API-SYNC-008、TC-API-SYNC-026 | 含该 AC 正例及关联反例/边界/异常 |
| F-SYNC-03 | AC3 | TC-API-SYNC-008、TC-API-SYNC-010 | 含该 AC 正例及关联反例/边界/异常 |
| F-SYNC-04 | AC1 | TC-API-SYNC-003、TC-API-SYNC-006、TC-API-SYNC-011、TC-API-SYNC-012、TC-API-SYNC-016、TC-API-SYNC-018 | 含该 AC 正例及关联反例/边界/异常 |
| F-SYNC-04 | AC2 | TC-API-SYNC-011、TC-API-SYNC-012 | 含该 AC 正例及关联反例/边界/异常 |
| F-SYNC-05 | AC1 | TC-API-SYNC-013、TC-API-SYNC-014、TC-API-SYNC-015、TC-API-SYNC-016、TC-API-SYNC-018、TC-API-SYNC-021 | 含该 AC 正例及关联反例/边界/异常 |
| F-SYNC-05 | AC2 | TC-API-SYNC-014、TC-API-SYNC-015、TC-API-SYNC-016、TC-API-SYNC-018、TC-API-SYNC-021 | 含该 AC 正例及关联反例/边界/异常 |
| F-SYNC-07 | AC1 | TC-API-SYNC-017、TC-API-SYNC-018、TC-API-SYNC-024 | 含该 AC 正例及关联反例/边界/异常 |
| F-SYNC-07 | AC2 | TC-API-SYNC-016、TC-API-SYNC-024、TC-API-SYNC-027 | 含该 AC 正例及关联反例/边界/异常 |
| F-SYNC-07 | AC3 | TC-API-SYNC-019、TC-API-SYNC-020、TC-API-SYNC-021、TC-API-SYNC-025 | 含该 AC 正例及关联反例/边界/异常 |
| F-SYNC-07 | AC4 | TC-API-SYNC-022、TC-API-SYNC-023 | 含该 AC 正例及关联反例/边界/异常 |

## Code → Case 覆盖表

| 代码点 | 接口用例 |
|---|---|
| C-BE-SYNC-01 | TC-API-SYNC-001、TC-API-SYNC-002、TC-API-SYNC-006、TC-API-SYNC-016、TC-API-SYNC-017、TC-API-SYNC-018、TC-API-SYNC-019、TC-API-SYNC-020、TC-API-SYNC-021、TC-API-SYNC-022、TC-API-SYNC-024、TC-API-SYNC-025、TC-API-SYNC-027 |
| C-BE-SYNC-02 | TC-API-SYNC-003、TC-API-SYNC-007、TC-API-SYNC-008、TC-API-SYNC-009、TC-API-SYNC-010、TC-API-SYNC-016、TC-API-SYNC-018、TC-API-SYNC-019、TC-API-SYNC-022、TC-API-SYNC-023、TC-API-SYNC-025、TC-API-SYNC-026 |
| C-BE-SYNC-03 | TC-API-SYNC-003、TC-API-SYNC-004、TC-API-SYNC-005、TC-API-SYNC-006、TC-API-SYNC-007、TC-API-SYNC-008、TC-API-SYNC-009、TC-API-SYNC-010、TC-API-SYNC-011、TC-API-SYNC-012、TC-API-SYNC-016、TC-API-SYNC-018、TC-API-SYNC-026、TC-API-SYNC-028 |
| C-BE-SYNC-04 | TC-API-SYNC-001、TC-API-SYNC-002、TC-API-SYNC-003、TC-API-SYNC-004、TC-API-SYNC-005、TC-API-SYNC-006、TC-API-SYNC-007、TC-API-SYNC-011、TC-API-SYNC-012、TC-API-SYNC-016、TC-API-SYNC-018、TC-API-SYNC-019、TC-API-SYNC-023、TC-API-SYNC-028 |
| C-BE-SYNC-05 | TC-API-SYNC-013、TC-API-SYNC-014、TC-API-SYNC-015、TC-API-SYNC-016、TC-API-SYNC-018、TC-API-SYNC-021 |

## 类别分布与静态验证

下表取自技能脚本 `check-cases.mjs --root=<临时分片统计目录> --json` 的 `stats` 与 `matrix`。统计输入仅为本 API 分片和 SYNC 的 6 个含 BE 的 Feature；不包含 UI/E2E，该临时统计中的全局 E2E 数量要求不作为 API 分片准入条件。项目完整输入另行运行技能检查，实际包含 8 条 E2E。

| 类型 | 用例数 |
|---|---|
| API | 28 |

| 类别 | 用例数 |
|---|---|
| positive | 11 |
| negative | 3 |
| boundary | 12 |
| exception | 2 |

| 优先级 | 用例数 |
|---|---|
| P0 | 10 |
| P1 | 12 |
| P2 | 6 |

| Feature | positive | negative | boundary | exception | 类别缺口 | waiver |
|---|---|---|---|---|---|---|
| F-SYNC-01 | 2 | 1 | 1 | 1 | 0 | 0 |
| F-SYNC-02 | 4 | 1 | 4 | 1 | 0 | 0 |
| F-SYNC-03 | 3 | 1 | 3 | 1 | 0 | 0 |
| F-SYNC-04 | 2 | 1 | 2 | 1 | 0 | 0 |
| F-SYNC-05 | 2 | 1 | 2 | 1 | 0 | 0 |
| F-SYNC-07 | 1 | 3 | 5 | 2 | 0 | 0 |

- AC 结构追溯：17/17；类别缺口：0；waivers：0。F-SYNC-01 的混合层 AC 按上文范围分工，结构引用齐全不代表 API 已验证点击、过滤或按钮禁用。
- 本模块后端代码点：C-BE-SYNC-01..05 共 5/5 均被引用，见代码点覆盖表。
- 完成定义：`node .workflow/validators/validate.mjs cases --module=SYNC --brief` 返回 exit 0、pass=true、errors=0、warnings=0；报告由 validator 生成到 `.workflow/reports/validate-cases-SYNC.json`。
- 额外技能检查：完整输入执行 `check-cases.mjs --json` 返回 exit 0、errors=0；1 个非 SYNC 警告为 F-MENU-01 的 exception waiver 过时，留给其负责分片处理。
- 当前验证范围是用例设计、追溯、编号、独立性和类别矩阵；尚未编写/运行这些 API 用例的脚本，也未产生产品 PASS 或执行证据。
