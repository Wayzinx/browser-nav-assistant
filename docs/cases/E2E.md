# E2E FLOW 端到端链路用例

本文件由 docs/trace/cases/E2E.json 生成。当前交付为测试用例设计，尚未执行产品 E2E；后续每条用例对应一个独立脚本和 evidence/<CaseID>/ 目录。

所有用例均独立 reset 和造数，通过真实 HTTP 串联后端能力；不覆盖浏览器权限、插件交互或前端不上传。增量链路只验证后端兼容接收 mode/cursor。

## TC-E2E-FLOW-001 样例同步后把排序返回的当前页和打开页传给推荐：Actions 首位且同步时间贯通健康信息

优先级：P0；类别：positive；技术：scenario。

Feature / AC：F-SYNC-02#AC1、F-SYNC-03#AC2、F-SYNC-04#AC1、F-RANK-01#AC1、F-RANK-01#AC2、F-REC-02#AC1、F-REC-05#AC1、F-REC-05#AC2。

Code：C-BE-SYNC-03、C-BE-SYNC-04、C-BE-RANK-04、C-BE-RANK-05、C-BE-REC-02、C-BE-REC-06。

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用真实 HTTP；本用例开始独立调用 POST /api/__test__/reset，确认页面、规则和配置恢复默认。
- 本用例自行造数，不依赖任何其他用例或执行顺序；所有生成的 page/rule id 均从本用例响应取值。

测试数据：resource.json 只读复制；取导入前的 T=Date.now()，所有 history.lastVisitTime 加上 delta=T−300000−1710100000000，使最新历史=T−5分钟（D-01）；activeTab/openTabs 不变。T 不晚于实际导入时刻。样例读接口一律带 ?now=T，后续若需跟随同步时间则明确使用响应 syncedAt。

步骤：

- S1：POST /api/sync 导入平移样例；保存响应为 sync1。
- S2：GET /api/pages/ranked?limit=20&now=T，保存为 rank1；按 url 取 PR 对象 current，以及 rank1.pages 中 isOpen=true 且不是 current 的 3 条对象 tabs。；再 GET /api/pages/ranked?limit=3&now=T 保存 top3，验证截断行为。
- S3：POST /api/recommendations/next?now=T，请求 currentPage={url:current.url,title:current.title}、openTabs=tabs 映射的 url/title、recentHistory=rank1.pages 映射的 url/title/lastVisitTime=lastVisitedAt；不手填另一个当前页。
- S4：GET /api/health，核对 pageCount 和 lastSyncAt 对应 sync1。

预期：

- E1：S1 HTTP 200，ok=true、received=14、created=10、updated=4、rejected=0、pageCount=10，syncedAt 是正整数。
- E2：S2 HTTP 200，total=sync1.pageCount=10、pages.length=10、generatedAt=T；每页含 url/title/domain/visitCount/lastVisitedAt/score/reason/isOpen/sources/scoreDetail，score 依次非递增。
- E3：S2 top3 HTTP 200、total=10、pages.length=3，pages 与 rank1 前3条按 id/url 顺序一致；top3 的 3 个 url 依次为 https://github.com/org/repo/issues/123、https://github.com/org/repo/pull/456、https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API。
- E4：S2 issues/123.lastVisitedAt 等于 S1 请求 history 中同 URL 的 lastVisitTime；current.lastVisitedAt=sync1.syncedAt。
- E5：S2 PR.sources 包含 active_tab/history，issues/123.sources 包含 open_tab/history，https://react.dev/learn.sources 仅为 [history]（集合比较）。
- E6：S3 HTTP 200，recommendations.length 在 1–5 之间；首条 url=https://github.com/org/repo/actions、strategy=same_repo、score=0.87、reason 包含 PR 和 CI、contextUrl=current.url。
- E7：S3 不包含 current.url、tabs 中任一 url、issues/123?tab=comments、issues/100 和 Google 样例搜索页；每条 score≥0.3、reason 非空。
- E8：S4 HTTP 200，status=ok，pageCount=sync1.pageCount，lastSyncAt=sync1.syncedAt，ruleCount=0。

证据：

- 设计态，尚未执行产品 E2E；后续按本 Case ID 单独生成 tests/e2e 脚本，执行证据写入 evidence/TC-E2E-FLOW-001/。
- 保留全部带步骤序号的 HTTP 请求/响应、x-request-id 与对应 server.log；特别保留用于后一步请求的 id、url、syncedAt 和前后状态差异。

## TC-E2E-FLOW-002 验收全链：同步→排序→消费排序响应推荐→解析原样保存规则→整理体现→正式id删除→恢复→health.ruleCount

优先级：P0；类别：positive；技术：state-transition。

Feature / AC：F-SYNC-02#AC1、F-RULE-01#AC2、F-RULE-02#AC1、F-RULE-07#AC1、F-RULE-08#AC3、F-CLEAN-01#AC1、F-CLEAN-04#AC1、F-CLEAN-05#AC1、F-DIAG-09#AC2、F-RANK-01#AC1、F-REC-02#AC1。

Code：C-BE-SYNC-04、C-BE-RULE-02、C-BE-RULE-07、C-BE-RULE-06、C-BE-CLEAN-01、C-BE-CLEAN-03、C-BE-CLEAN-04、C-BE-DIAG-01、C-BE-RANK-05、C-BE-REC-02。

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用真实 HTTP；本用例开始独立调用 POST /api/__test__/reset，确认页面、规则和配置恢复默认。
- 本用例自行造数，不依赖任何其他用例或执行顺序；所有生成的 page/rule id 均从本用例响应取值。

测试数据：resource.json 只读复制；取导入前的 T=Date.now()，所有 history.lastVisitTime 加上 delta=T−300000−1710100000000，使最新历史=T−5分钟（D-01）；activeTab/openTabs 不变。T 不晚于实际导入时刻。样例读接口一律带 ?now=T，后续若需跟随同步时间则明确使用响应 syncedAt。 text=把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档。

步骤：

- S1：POST /api/sync 导入平移样例，保存 sync1；GET /api/rules 保存空列表基线。
- S2：GET /api/pages/ranked?limit=20&now=T 保存 rank0，按 url 提取 PR 对象 current 与除 current 外的3条 isOpen=true 页面 tabs；POST /api/recommendations/next?now=T，currentPage 使用 current 的 url/title、openTabs 使用 tabs 的 url/title、recentHistory 使用 rank0.pages 映射的 url/title/lastVisitTime=lastVisitedAt；GET /api/pages/cleanup-suggestions?now=T 保存 clean0。
- S3：POST /api/rules/parse，text 使用测试数据；保存完整响应 parsed；随后 GET /api/rules 确认解析未入库。
- S4：POST /api/rules，body={rules:parsed.rules}，逐字段原样传递，不改 id/notes/rawText；保存响应 saved，按 type 找到正式 archiveId 和 neverId。
- S5：GET /api/rules 与 GET /api/health，读回保存的两条规则与 sync1 时间。
- S6：GET /api/pages/cleanup-suggestions?now=T 保存 clean1，使用 saved 中正式规则 id 验证 ruleId。
- S7：DELETE /api/rules/:id 使用 neverId；再 GET /api/rules、GET /api/health、GET /api/pages/cleanup-suggestions?now=T 保存 clean2。
- S8：DELETE /api/rules/:id 使用 archiveId；再次 GET /api/rules、GET /api/health 和 GET /api/pages/cleanup-suggestions?now=T 保存 clean3，与 clean0 比较。

预期：

- E1：S1 同步 HTTP 200、received=14、created=10、updated=4、pageCount=10，syncedAt 为正整数；规则列表 total=0。
- E2：S2 ranked HTTP 200、total=sync1.pageCount=10、pages.length=10、generatedAt=T；每页含 url/title/domain/visitCount/lastVisitedAt/score/reason/isOpen/sources/scoreDetail，score 按非递增排列；current.url=https://github.com/org/repo/pull/456，tabs 长度=3。
- E3：S2 推荐 HTTP 200、recommendations.length 在1–5之间；首条 url=https://github.com/org/repo/actions、strategy=same_repo、score=0.87、reason 包含 PR 和 CI、contextUrl=current.url，证明推荐消费本步骤排序返回的 PR 及打开快照。
- E4：S2 clean0 HTTP 200、summary={archive:2,merge:1,keep:0}，archive 项含 url/title/reason/ageDays，merge 项含 urls/keepUrl/reason。
- E5：S3 HTTP 200，parsed.rules.length=2、unparsed=[]；第一条 type=archive_candidate、domain=github.com、urlPattern=/issues/、inactiveDays=7、action=suggest_archive、rawText=把 7 天没访问过的 GitHub issue 建议归档；第二条 type=never_archive、domain=docs.internal.com、action=keep、rawText=docs.internal.com 的页面永远不要归档。
- E6：S3 后的列表 total 与 S1 基线相等且为 0，证明 parse 返回结果未保存。
- E7：S4 HTTP 201，ruleCount=2，两条返回规则均有非空正式 id 且互不相同、enabled=true；type/domain/urlPattern/inactiveDays/action/rawText 与 parsed 对应规则一致。不要求正式 id 与预览 id 不同。
- E8：S5 rules HTTP 200、total=2、每条含 id/rawText/type/action/enabled，id 集合等于 saved.rules 的 id 集合；health.pageCount=10、ruleCount=2、lastSyncAt=sync1.syncedAt。
- E9：S6 clean1.summary={archive:2,merge:1,keep:1}；唯一 keep.url=https://docs.internal.com/ai-agent-design、ruleId=neverId、reason 包含 被保护域名配置（docs.internal.com），该 URL 不在 archive。
- E10：S6 issues/100 的 archive.ruleId=archiveId，reason=超过 7 天未访问（已 24 天），且不在当前打开的 tab 中；命中规则「把 7 天没访问过的 GitHub issue 建议归档」。
- E11：S7 DELETE HTTP 200、deleted=neverId、ruleCount=1；列表只含 archiveId，health.ruleCount=1；clean2 不含 docs.internal.com/ai-agent-design 的 keep，issues/100.ruleId 仍为 archiveId。
- E12：S8 DELETE HTTP 200、deleted=archiveId、ruleCount=0；列表 rules=[]、total=0、health.ruleCount=0，pageCount 与 sync1 相同、lastSyncAt=sync1.syncedAt。
- E13：S8 clean3.summary=clean0.summary，suggestions 按 action/url/urls/keepUrl/ageDays/reason/ruleId 投影后与 clean0 深等；issues/100.ruleId=null、reason 恢复为超过 14 天未访问（已 24 天），且不在当前打开的 tab 中。

证据：

- 设计态，尚未执行产品 E2E；后续按本 Case ID 单独生成 tests/e2e 脚本，执行证据写入 evidence/TC-E2E-FLOW-002/。
- 保留全部带步骤序号的 HTTP 请求/响应、x-request-id 与对应 server.log；特别保留用于后一步请求的 id、url、syncedAt 和前后状态差异。

## TC-E2E-FLOW-003 never_archive 规则保存使样例保护页从 0.56 第8升至 0.65 第7，删除后排序理由恢复

优先级：P0；类别：positive；技术：state-transition。

Feature / AC：F-SYNC-02#AC1、F-RANK-04#AC1、F-RANK-04#AC2、F-CLEAN-04#AC1。

Code：C-BE-SYNC-04、C-BE-RANK-02、C-BE-RANK-03、C-BE-CLEAN-01。

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用真实 HTTP；本用例开始独立调用 POST /api/__test__/reset，确认页面、规则和配置恢复默认。
- 本用例自行造数，不依赖任何其他用例或执行顺序；所有生成的 page/rule id 均从本用例响应取值。

测试数据：resource.json 只读复制；取导入前的 T=Date.now()，所有 history.lastVisitTime 加上 delta=T−300000−1710100000000，使最新历史=T−5分钟（D-01）；activeTab/openTabs 不变。T 不晚于实际导入时刻。样例读接口一律带 ?now=T，后续若需跟随同步时间则明确使用响应 syncedAt。 规则文本=docs.internal.com 的页面永远不要归档。

步骤：

- S1：POST /api/sync 导入样例，保存 sync1；GET /api/pages/ranked?now=T 保存 rank0，提取 docs.internal.com/ai-agent-design 的 id、url、scoreDetail、score、reason 和 1-based 名次。
- S2：POST /api/rules/parse 提交规则文本；POST /api/rules 原样使用 parse.rules，保存 saved.rules[0].id 为 protectedId。
- S3：GET /api/pages/ranked?now=T 保存 rank1；按 S1 页面 id 查找同一页面；GET /api/pages/cleanup-suggestions?now=T 验证 keep.ruleId=protectedId。
- S4：DELETE /api/rules/:id 使用 protectedId；GET /api/pages/ranked?now=T 保存 rank2；GET /api/health。

预期：

- E1：S1 同步 HTTP 200、received=14、created=10、updated=4、pageCount=10；rank0 目标 score=0.56、scoreDetail.domain=0.10、scoreDetail.domainSource=affinity、名次=8，reason 不含 属于受保护域名。
- E2：S2 parse HTTP 200、rules.length=1、type=never_archive、domain=docs.internal.com；save HTTP 201、ruleCount=1、正式 protectedId 非空。
- E3：S3 同一 id/url 页面 score=0.65、scoreDetail.domain=1.00、scoreDetail.domainSource=protected、名次=7，reason 包含 属于受保护域名；recency/frequency/open 与 rank0 相同。
- E4：S3 cleanup 有且仅有 1 条 keep，url 等于 rank0 目标 url、ruleId=protectedId、reason 包含 被保护域名配置（docs.internal.com）；该 url 不在 archive。
- E5：S4 DELETE HTTP 200、deleted=protectedId、ruleCount=0；rank2 的同一 id 页面 score=0.56、名次=8、scoreDetail.domain=0.10、scoreDetail.domainSource=affinity、reason 不含 属于受保护域名，reason 等于 rank0。
- E6：S4 health HTTP 200、ruleCount=0、pageCount=sync1.pageCount、lastSyncAt=sync1.syncedAt。

证据：

- 设计态，尚未执行产品 E2E；后续按本 Case ID 单独生成 tests/e2e 脚本，执行证据写入 evidence/TC-E2E-FLOW-003/。
- 保留全部带步骤序号的 HTTP 请求/响应、x-request-id 与对应 server.log；特别保留用于后一步请求的 id、url、syncedAt 和前后状态差异。

## TC-E2E-FLOW-004 同批历史重放后再关闭旧打开页：visitCount不累加，新快照同时影响排序、整理和推荐

优先级：P0；类别：positive；技术：state-transition。

Feature / AC：F-SYNC-02#AC1、F-SYNC-03#AC1、F-SYNC-05#AC1、F-SYNC-05#AC2、F-RANK-01#AC1、F-REC-02#AC1。

Code：C-BE-SYNC-03、C-BE-SYNC-04、C-BE-SYNC-05、C-BE-RANK-05、C-BE-REC-02。

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用真实 HTTP；本用例开始独立调用 POST /api/__test__/reset，确认页面、规则和配置恢复默认。
- 本用例自行造数，不依赖任何其他用例或执行顺序；所有生成的 page/rule id 均从本用例响应取值。

测试数据：resource.json 只读复制；取导入前的 T=Date.now()，所有 history.lastVisitTime 加上 delta=T−300000−1710100000000，使最新历史=T−5分钟（D-01）；activeTab/openTabs 不变。T 不晚于实际导入时刻。样例读接口一律带 ?now=T，后续若需跟随同步时间则明确使用响应 syncedAt。 再准备未打开的 https://example.com/open（title=Old open，lastVisitTime=T−20×86400000，visitCount=1）；第三次同步 openTabs 只保留样例 issues/123 和 Fetch_API，activeTab=null。

步骤：

- S1：POST /api/sync 导入样例并保存 sync1；GET /api/pages/ranked?now=T 保存 rank0。
- S2：POST /api/sync 重发完全相同的样例，保存 sync2；GET /api/pages/ranked?now=T 保存 rankReplay；以 rankReplay 的 PR 为 currentPage、rankReplay 中除 PR 外的全部 isOpen 页为 openTabs 请求推荐 ?now=T，保存 recOpen。
- S3：POST /api/sync 提交 activeTab=null、openTabs 仅 issues/123 与 Fetch_API（从 rankReplay 对象映射）、history 仍为完整平移样例并追加 Old open；保存 sync3。
- S4：GET /api/pages/ranked?now=T 保存 rank3，比较先前页面 id 的 visitCount/isOpen；GET /api/pages/cleanup-suggestions?now=T 保存 clean3。
- S5：以 rank3 中 PR 为 currentPage、rank3 中 isOpen=true 的两页为 openTabs、recentHistory=[]，POST /api/recommendations/next?now=T；GET /api/health。

预期：

- E1：S1 同步 HTTP 200、received=14、created=10、updated=4、pageCount=10；rank0.total=10、pages.length=10、每页含 url/title/domain/visitCount/lastVisitedAt/score/reason/isOpen/sources/scoreDetail 且 score 非递增。
- E2：S2 同步 HTTP 200、created=0、pageCount=10；rankReplay 的 issues/123.visitCount=8，与 rank0 相同，全部已存在页面 visitCount 均未累加。
- E3：S2 推荐第1条=https://github.com/org/repo/actions、strategy=same_repo、score=0.87、reason 包含 PR/CI，contextUrl 等于 rankReplay 中 PR.url。
- E4：S3 同步 HTTP 200、created=1、pageCount=11；rank3 中原10页 id 集合与 rankReplay 一致，issues/123.visitCount 仍=8。
- E5：S4 rank3 中 docs.internal.com/ai-agent-design.isOpen=false、pull/456.isOpen=false、issues/123.isOpen=true、Fetch_API.isOpen=true，isOpen=true 的 url 集合恰为第三次请求的两页。
- E6：S4 关闭后的 docs.internal.com 页面 score 比 rankReplay 减少0.20，scoreDetail.open=0；它未到15个整天，clean3 中没有该页 archive。
- E7：S4 clean3 中 Old open 为 archive、ageDays=20，原样例 Google 与 issues/100 仍为 archive；Old open 来自 S3 新增数据且不在 S5 推荐响应中。
- E8：S5 推荐包含 Actions 首位、strategy=same_repo，contextUrl=rank3 PR.url；不包含第三次完整打开快照的任一 URL 或其重复变体；health.pageCount=sync3.pageCount=11、lastSyncAt=sync3.syncedAt。

证据：

- 设计态，尚未执行产品 E2E；后续按本 Case ID 单独生成 tests/e2e 脚本，执行证据写入 evidence/TC-E2E-FLOW-004/。
- 保留全部带步骤序号的 HTTP 请求/响应、x-request-id 与对应 server.log；特别保留用于后一步请求的 id、url、syncedAt 和前后状态差异。

## TC-E2E-FLOW-005 绕过前端直接同步敏感URL：服务端拒收后排序、整理和健康页数保持隔离

优先级：P0；类别：security；技术：scenario。

Feature / AC：F-PRIV-03#AC1、F-PRIV-03#AC2、F-CLEAN-02#AC3。

Code：C-BE-PRIV-01、C-BE-PRIV-02、C-BE-SYNC-02、C-BE-CLEAN-01。

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用真实 HTTP；本用例开始独立调用 POST /api/__test__/reset，确认页面、规则和配置恢复默认。
- 本用例自行造数，不依赖任何其他用例或执行顺序；所有生成的 page/rule id 均从本用例响应取值。

测试数据：取导入前 T=Date.now()。敏感历史={url:https://example.com/reset?token=abc,title:Sensitive,lastVisitTime:T−30天,visitCount:1}；安全历史={url:https://example.com/old,title:Old,lastVisitTime:T−15天,visitCount:1}；两次请求独立发送，activeTab=null、openTabs=[]。保留敏感请求前后的 server.log 偏移。此链只证明后端兜底，不证明插件未上传。

步骤：

- S1：记录 server.log 起始偏移；POST /api/sync 仅提交敏感历史，保存 denied；GET /api/pages/ranked?now=T。
- S2：POST /api/sync 提交安全历史，保存 safe；GET /api/pages/ranked?now=T，取返回安全页面的 url、lastVisitedAt。
- S3：按 S2 安全页 lastVisitedAt 计算 nowA=lastVisitedAt+14天23小时、nowB=lastVisitedAt+15天；分别 GET /api/pages/cleanup-suggestions?now=nowA 和 ?now=nowB。
- S4：GET /api/health；读取敏感请求对应 server.log 区间，并检查 S1–S4 全部响应不包含被拒收 URL。

预期：

- E1：S1 sync HTTP 200、received=1、created=0、updated=0、rejected=1、rejectedByReason={invalid_url:0,privacy:1}、pageCount=0；紧随 ranked HTTP 200、pages=[]、total=0。
- E2：S2 sync HTTP 200、received=1、created=1、rejected=0、pageCount=1；ranked.total=1、唯一 url=https://example.com/old，lastVisitedAt 等于 safe 请求中的 lastVisitTime。
- E3：S3 nowA 时没有安全页 archive；nowB 时 summary={archive:1,merge:0,keep:0}，唯一 archive.url 等于 S2 返回 url、ageDays=15、lastVisitedAt 等于 S2 返回时间。
- E4：S4 health.pageCount=safe.pageCount=1，lastSyncAt=safe.syncedAt，ruleCount=0；全部 ranked/cleanup 响应中都没有敏感 URL，也没有 敏感页面 title=Sensitive（区分大小写）。
- E5：S4 敏感请求后端日志区间不包含 reset?token=abc 或 token=abc；S1–S4 响应序列化后不回显 https://example.com/reset?token=abc。

证据：

- 设计态，尚未执行产品 E2E；后续按本 Case ID 单独生成 tests/e2e 脚本，执行证据写入 evidence/TC-E2E-FLOW-005/。
- 保留全部带步骤序号的 HTTP 请求/响应、x-request-id 与对应 server.log；特别保留用于后一步请求的 id、url、syncedAt 和前后状态差异。

## TC-E2E-FLOW-006 使用上次syncedAt作为incremental游标：重复窗口不累加，旧页保留且完整打开快照更新

优先级：P1；类别：compatibility；技术：state-transition。

Feature / AC：F-SYNC-02#AC1、F-SYNC-05#AC1、F-SYNC-05#AC2、F-RANK-01#AC1。

Code：C-BE-SYNC-04、C-BE-SYNC-05、C-BE-RANK-05。

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用真实 HTTP；本用例开始独立调用 POST /api/__test__/reset，确认页面、规则和配置恢复默认。
- 本用例自行造数，不依赖任何其他用例或执行顺序；所有生成的 page/rule id 均从本用例响应取值。

测试数据：resource.json 只读复制；取导入前的 T=Date.now()，所有 history.lastVisitTime 加上 delta=T−300000−1710100000000，使最新历史=T−5分钟（D-01）；activeTab/openTabs 不变。T 不晚于实际导入时刻。样例读接口一律带 ?now=T，后续若需跟随同步时间则明确使用响应 syncedAt。 后端 mode/cursor 按契约仅记录、不筛选上传历史；本用例构造模拟客户端增量负载，不覆盖 FE-only F-INCR-01。新增 url=https://example.com/incremental-new，lastVisitTime 必须从首次同步返回的 syncedAt 取值，不用未来时间。

步骤：

- S1：POST /api/sync 使用 mode=full 导入样例，保存 full；GET /api/pages/ranked?now=T 保存 rank0。
- S2：从 rank0 中取 issues/123 构造重叠 history（lastVisitTime 沿用首次请求、visitCount=8），再新增一条 incremental-new（lastVisitTime=full.syncedAt、visitCount=2）；POST /api/sync，mode=incremental、cursor=full.syncedAt、activeTab=null、openTabs 为 rank0 中 issues/123 和 Fetch_API 两页。保存 inc1。
- S3：GET /api/pages/ranked?now=inc1.syncedAt 保存 rank1；再 POST /api/sync 重放 S2 负载，但 cursor=inc1.syncedAt，保存 inc2。
- S4：GET /api/pages/ranked?now=inc2.syncedAt 保存 rank2；GET /api/pages/cleanup-suggestions?now=inc2.syncedAt；GET /api/health。

预期：

- E1：S1 full HTTP 200、mode=full、received=14、created=10、updated=4、pageCount=10；rank0 HTTP 200、total=10、pages.length=10，每页含 url/title/domain/visitCount/lastVisitedAt/score/reason/isOpen/sources/scoreDetail，score 非递增。
- E2：S2 发出的 cursor 严格等于 full.syncedAt；inc1 HTTP 200、mode=incremental、received=4、created=1、updated=3、rejected=0、pageCount=11。
- E3：S3 rank1 保留 rank0 全部10个页面 id，新增 url 只有 incremental-new；issues/123.visitCount=8，新增页 visitCount=2、lastVisitedAt=full.syncedAt。
- E4：S3 rank1 中 docs.internal.com/ai-agent-design.isOpen=false、pull/456.isOpen=false、issues/123.isOpen=true、Fetch_API.isOpen=true；isOpen=true 集合严格等于 S2 完整 openTabs。
- E5：S3 重放请求 cursor=inc1.syncedAt；inc2 HTTP 200、mode=incremental、created=0、updated=4、pageCount=11，未增加任何页面。
- E6：S4 rank2 的页面 id/url/visitCount 与 rank1 逐页相等，isOpen 集合仍为完整两页；cleanup 不含 incremental-new 的 archive，仍包含旧 Google 页与 issues/100 的 archive。
- E7：S4 health.pageCount=inc2.pageCount=11、lastSyncAt=inc2.syncedAt，证明读侧消费最后一批增量请求状态。

证据：

- 设计态，尚未执行产品 E2E；后续按本 Case ID 单独生成 tests/e2e 脚本，执行证据写入 evidence/TC-E2E-FLOW-006/。
- 保留全部带步骤序号的 HTTP 请求/响应、x-request-id 与对应 server.log；特别保留用于后一步请求的 id、url、syncedAt 和前后状态差异。

## TC-E2E-FLOW-007 同一页面跨整数天阈值：14天附近不归档，15天前1ms到恰好15天跃迁并影响推荐

优先级：P1；类别：boundary；技术：boundary。

Feature / AC：F-SYNC-03#AC3、F-CLEAN-02#AC3。

Code：C-BE-SYNC-03、C-BE-CLEAN-01。

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用真实 HTTP；本用例开始独立调用 POST /api/__test__/reset，确认页面、规则和配置恢复默认。
- 本用例自行造数，不依赖任何其他用例或执行顺序；所有生成的 page/rule id 均从本用例响应取值。

测试数据：DAY=86400000；导入前取 T=Date.now()，令 L=T−16×DAY。唯一历史 url=https://example.com/old、title=""、visitCount=8、lastVisitTime=L；activeTab=null、openTabs=[]。判定 ageDays=floor((now−L)/DAY)>14。固定检查 now=L+14DAY−1、L+14DAY、L+14DAY+1、L+14DAY+23小时、L+15DAY−1、L+15DAY、L+15DAY+1；所有 now≤T，历史不会被当作未来时间截断。 五个无归档时点的推算 ageDays 分别为13/14/14/14/14，此为测试算法说明；无建议时响应没有 ageDays 字段。

步骤：

- S1：POST /api/sync 导入唯一历史，保存 sync1；GET /api/pages/ranked?now=T，保存唯一页面 old 的 id/url/lastVisitedAt。
- S2：从 S1 返回的 old.lastVisitedAt 计算测试数据列出的7个 now，分别 GET /api/pages/cleanup-suggestions?now=该值，按同一 old.url 匹配建议。
- S3：以 currentPage={url:https://example.com/context,title:Context}、openTabs=[]、recentHistory=[]，在 nowBefore=old.lastVisitedAt+15DAY−1 请求 POST /api/recommendations/next?now=nowBefore。
- S4：在 nowAt=old.lastVisitedAt+15DAY 以同一请求体请求推荐；再以 nowAfter=old.lastVisitedAt+15DAY+1 请求整理建议和 GET /api/health。

预期：

- E1：S1 sync HTTP 200、created=1、rejected=0、pageCount=1；ranked.total=1、页面 title=https://example.com/old、lastVisitedAt=L，生成 id 非空。
- E2：S2 7次响应均 HTTP 200、generatedAt 等于各请求 now；14天−1ms/恰好14天/14天+1ms/14天23小时/15天−1ms 五个时点 summary.archive=0 且无 old.url 的 archive。
- E3：S2 恰好15天及15天+1ms两次都 summary={archive:1,merge:0,keep:0}，唯一 archive.url=old.url、lastVisitedAt=old.lastVisitedAt、ageDays=15、ruleId=null，reason=超过 14 天未访问（已 15 天），且不在当前打开的 tab 中。
- E4：S3 HTTP 200，推荐结果包含且仅包含 old.url，contextUrl=https://example.com/context、score≥0.3；它在15天前1ms尚未进入待归档集合。
- E5：S4 恰好15天的推荐 HTTP 200、recommendations=[]，同一 old.url 因进入待归档集合而被排除；15天+1ms整理仍含同一 URL 的 archive、ageDays=15。
- E6：S4 health.pageCount=sync1.pageCount=1、ruleCount=0、lastSyncAt=sync1.syncedAt；归档建议和推荐过滤没有真正删除页面。

证据：

- 设计态，尚未执行产品 E2E；后续按本 Case ID 单独生成 tests/e2e 脚本，执行证据写入 evidence/TC-E2E-FLOW-007/。
- 保留全部带步骤序号的 HTTP 请求/响应、x-request-id 与对应 server.log；特别保留用于后一步请求的 id、url、syncedAt 和前后状态差异。

## TC-E2E-FLOW-008 自定义隐私规则解析保存联动config与拒收，按保存id删除后关键词及接收恢复

优先级：P0；类别：positive；技术：state-transition。

Feature / AC：F-PRIV-05#AC1、F-PRIV-05#AC2、F-DIAG-10#AC1。

Code：C-BE-PRIV-01、C-BE-PRIV-02、C-BE-DIAG-02。

前置条件：

- 后端以 ENABLE_TEST_API=1 启动，使用真实 HTTP；本用例开始独立调用 POST /api/__test__/reset，确认页面、规则和配置恢复默认。
- 本用例自行造数，不依赖任何其他用例或执行顺序；所有生成的 page/rule id 均从本用例响应取值。

测试数据：导入前取 T=Date.now()；text=不要上传包含 cookie 的 URL；history 唯一条={url:https://example.com/?cookie=1,title:Cookie guide,lastVisitTime:T−1小时,visitCount:2}；activeTab=null、openTabs=[]。默认关键词顺序为 password/token/bank/secret。

步骤：

- S1：GET /api/config 保存 base；POST /api/rules/parse 提交 text，保存 parsed。
- S2：POST /api/rules，body={rules:parsed.rules} 原样传递；保存 saved.rules[0].id 为 privacyId，GET /api/config 保存 effective。
- S3：从 effective.privacySensitiveKeywords 确认 cookie 后，POST /api/sync 提交测试敏感历史；保存 denied；GET /api/pages/ranked?now=T、GET /api/health。
- S4：DELETE /api/rules/:id 使用 privacyId，随后 GET /api/config 保存 restored，GET /api/health。
- S5：确认 restored 关键词已恢复 base 后，POST /api/sync 重发 S3 完全相同历史，保存 accepted；GET /api/pages/ranked?now=T、GET /api/health。

预期：

- E1：S1 config HTTP 200、cleanupThresholdDays=14、maxHistoryItems=100、enablePrivacyFilter=true、privacySensitiveKeywords=[password,token,bank,secret]，不含 cookie；parse HTTP 200、rules.length=1、type=privacy_filter、keywords=[cookie]、action=exclude_upload。
- E2：S2 save HTTP 201、ruleCount=1、privacyId 非空；effective.privacySensitiveKeywords 的集合=base.privacySensitiveKeywords∪{cookie}，baseSensitiveKeywords 与 base 一致。
- E3：S3 sync HTTP 200、received=1、created=0、updated=0、rejected=1、rejectedByReason.privacy=1、pageCount=0；ranked.pages=[]、total=0；health.ruleCount=1、pageCount=0、lastSyncAt=denied.syncedAt。
- E4：S4 DELETE HTTP 200、deleted=privacyId、ruleCount=0；restored.privacySensitiveKeywords 的集合等于 base.privacySensitiveKeywords，cookie 不在其中；health.ruleCount=0。
- E5：S5 重发原历史 HTTP 200、created=1、rejected=0、pageCount=1；ranked.total=1、唯一 url=https://example.com/?cookie=1、visitCount=2、lastVisitedAt 等于 S3 原请求时间。
- E6：S5 health.pageCount=accepted.pageCount=1、ruleCount=0、lastSyncAt=accepted.syncedAt；同一 URL 从拒收到可接收由已删除的正式 privacyId 对应规则控制。

证据：

- 设计态，尚未执行产品 E2E；后续按本 Case ID 单独生成 tests/e2e 脚本，执行证据写入 evidence/TC-E2E-FLOW-008/。
- 保留全部带步骤序号的 HTTP 请求/响应、x-request-id 与对应 server.log；特别保留用于后一步请求的 id、url、syncedAt 和前后状态差异。

## Feature → Case 覆盖表

| Feature | AC | 覆盖用例 | 类别分布 | waiver |
|---|---|---|---|---|
| F-CLEAN-01 | F-CLEAN-01#AC1 | TC-E2E-FLOW-002 | positive 1 | — |
| F-CLEAN-02 | F-CLEAN-02#AC3 | TC-E2E-FLOW-005、TC-E2E-FLOW-007 | security 1、boundary 1 | — |
| F-CLEAN-04 | F-CLEAN-04#AC1 | TC-E2E-FLOW-002、TC-E2E-FLOW-003 | positive 2 | — |
| F-CLEAN-05 | F-CLEAN-05#AC1 | TC-E2E-FLOW-002 | positive 1 | — |
| F-DIAG-09 | F-DIAG-09#AC2 | TC-E2E-FLOW-002 | positive 1 | — |
| F-DIAG-10 | F-DIAG-10#AC1 | TC-E2E-FLOW-008 | positive 1 | — |
| F-PRIV-03 | F-PRIV-03#AC1、F-PRIV-03#AC2 | TC-E2E-FLOW-005 | security 1 | — |
| F-PRIV-05 | F-PRIV-05#AC1、F-PRIV-05#AC2 | TC-E2E-FLOW-008 | positive 1 | — |
| F-RANK-01 | F-RANK-01#AC1、F-RANK-01#AC2 | TC-E2E-FLOW-001、TC-E2E-FLOW-002、TC-E2E-FLOW-004、TC-E2E-FLOW-006 | positive 3、compatibility 1 | — |
| F-RANK-04 | F-RANK-04#AC1、F-RANK-04#AC2 | TC-E2E-FLOW-003 | positive 1 | — |
| F-REC-02 | F-REC-02#AC1 | TC-E2E-FLOW-001、TC-E2E-FLOW-002、TC-E2E-FLOW-004 | positive 3 | — |
| F-REC-05 | F-REC-05#AC1、F-REC-05#AC2 | TC-E2E-FLOW-001 | positive 1 | — |
| F-RULE-01 | F-RULE-01#AC2 | TC-E2E-FLOW-002 | positive 1 | — |
| F-RULE-02 | F-RULE-02#AC1 | TC-E2E-FLOW-002 | positive 1 | — |
| F-RULE-07 | F-RULE-07#AC1 | TC-E2E-FLOW-002 | positive 1 | — |
| F-RULE-08 | F-RULE-08#AC3 | TC-E2E-FLOW-002 | positive 1 | — |
| F-SYNC-02 | F-SYNC-02#AC1 | TC-E2E-FLOW-001、TC-E2E-FLOW-002、TC-E2E-FLOW-003、TC-E2E-FLOW-004、TC-E2E-FLOW-006 | positive 4、compatibility 1 | — |
| F-SYNC-03 | F-SYNC-03#AC1、F-SYNC-03#AC2、F-SYNC-03#AC3 | TC-E2E-FLOW-001、TC-E2E-FLOW-004、TC-E2E-FLOW-007 | positive 2、boundary 1 | — |
| F-SYNC-04 | F-SYNC-04#AC1 | TC-E2E-FLOW-001 | positive 1 | — |
| F-SYNC-05 | F-SYNC-05#AC1、F-SYNC-05#AC2 | TC-E2E-FLOW-004、TC-E2E-FLOW-006 | positive 1、compatibility 1 | — |

## 类别分布统计

以下数字取自原版 checkCases({ root }) 对 E2E 投影输入的实际 stats：只将本分片8条用例放入临时 cases-api.json，cases-ui.json 为空，features.json 原样复制。临时输入和原始输出保留在 .workflow/context/logs/；全库 AC/类别矩阵缺口不作为本分片统计口径。

| 类别 | 数量 |
|---|---|
| positive | 5 |
| security | 1 |
| compatibility | 1 |
| boundary | 1 |

类型分布：{"E2E":8}；优先级分布：{"P0":6,"P1":2}；设计技术分布：{"scenario":2,"state-transition":5,"boundary":1}。

E2E 用例总数：8；最少步骤数：4；每条均跨至少两个 C-BE 模块。投影 checker 的用例级错误 0、警告 0。

验收命令：`node .workflow/validators/validate.mjs cases --module=E2E --brief`；最近一次结果退出码 0、pass=true、errors=0、warnings=0。验收范围为静态用例设计，不代表产品链路运行通过。
