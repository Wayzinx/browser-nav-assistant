# 接口用例分片：DIAG（启动诊断）

> 本文件是 DIAG 模块 type=API 用例的分片，与 `docs/trace/cases/API-DIAG.json` 一一对应；docs/06 由 `validate.mjs merge-cases` 合并生成。

执行约定：每条用例前测试夹具自动调用 `POST /api/__test__/reset` 隔离状态；数据一律通过真实的 `POST /api/sync` / `POST /api/rules` / `PUT /api/config` 构造；样例按 D-01 平移（最新一条 = 导入时刻 − 5 分钟）。后端生成的 id 一律取响应值，不写死。

## DIAG 启动诊断（后端接口）

### TC-API-DIAG-001 后端数据为空时 GET /api/health 返回 200、version=1.0.0、页面数和规则数为 0
- 优先级：P0 ｜ 类别：positive ｜ 技术：equivalence
- 关联 Feature：F-DIAG-09（AC1）、F-DIAG-01（AC1） ｜ 关联 Code：C-BE-DIAG-01、C-BE-CORE-15、C-BE-CORE-14
- 前置条件：后端以 ENABLE_TEST_API=1 启动，未配置 SNAPSHOT_FILE；测试夹具已调用 POST /api/__test__/reset
- 测试数据：不导入任何数据；未配置 SNAPSHOT_FILE，因此 persistence 期望为 memory
- 步骤：
  - S1：POST /api/__test__/reset
  - S2：GET /api/health
- 预期：
  - E1：S1 返回 200，body.ok=true
  - E2：S2 返回 200，响应头 content-type 包含 application/json
  - E3：S2 的 body.status="ok"，body.version="1.0.0"
  - E4：S2 的 body.uptime 为整数且 uptime ≥ 0
  - E5：S2 的 body.pageCount=0、body.ruleCount=0、body.enabledRuleCount=0
  - E6：S2 的 body.lastSyncAt=null，body.persistence="memory"，body.startedAt 为数字且 ≤ 请求发出时的 Date.now()
- 证据：evidence/TC-API-DIAG-001/（api: S2 响应）

### TC-API-DIAG-002 导入 resource.json 样例并保存 2 条规则后：pageCount=10、ruleCount=2、lastSyncAt 等于导入的 syncedAt
- 优先级：P0 ｜ 类别：positive ｜ 技术：scenario
- 关联 Feature：F-DIAG-09（AC2） ｜ 关联 Code：C-BE-DIAG-01、C-BE-CORE-12
- 前置条件：后端已 reset
- 测试数据：resource.json 按 D-01 平移（最新一条 lastVisitTime = 导入时刻 − 5 分钟）后经 POST /api/sync 导入：activeTab 1 + openTabs 3 + history 10 = 14 条，去重后 10 个页面（PRD 第 13 章 / F-SYNC-02#AC1）。规则取契约示例：① {rawText:"把 7 天没访问过的 GitHub issue 建议归档", type:"archive_candidate", domain:"github.com", urlPattern:"/issues/", inactiveDays:7, action:"suggest_archive"}；② {rawText:"docs.internal.com 的页面永远不要归档", type:"never_archive", domain:"docs.internal.com", action:"keep"}
- 步骤：
  - S1：POST /api/sync，请求体为平移后的 resource.json，记录响应中的 syncedAt
  - S2：POST /api/rules，请求体 { rules: [规则①, 规则②] }
  - S3：GET /api/health
- 预期：
  - E1：S1 返回 200，body.created=10、body.pageCount=10，body.syncedAt 为数字
  - E2：S2 返回 201，body.ruleCount=2，body.rules 共 2 条且 id 非空、互不相同
  - E3：S3 返回 200，body.pageCount=10、body.ruleCount=2、body.enabledRuleCount=2
  - E4：S3 的 body.lastSyncAt 等于 S1 响应中的 syncedAt（严格相等）
  - E5：S3 的 body.status="ok"，body.version="1.0.0"
- 证据：evidence/TC-API-DIAG-002/（api: S1 响应（syncedAt）；api: S3 响应）

### TC-API-DIAG-003 lastSyncAt 跟随最近一次同步更新，reset 后 pageCount 归 0、lastSyncAt 回到 null
- 优先级：P1 ｜ 类别：state ｜ 技术：state-transition
- 关联 Feature：F-DIAG-09（AC1、AC2） ｜ 关联 Code：C-BE-DIAG-01、C-BE-CORE-12、C-BE-CORE-14
- 前置条件：后端已 reset
- 测试数据：第 1 次同步：平移后的 resource.json（10 个页面）；第 2 次同步：只有 1 条 history { url: https://example.com/diag-a, title: "diag-a", lastVisitTime: now − 1 小时, visitCount: 1 }，与样例不重复，因此页面数变为 11
- 步骤：
  - S1：GET /api/health，记录 lastSyncAt
  - S2：POST /api/sync 导入平移后的 resource.json，记录 syncedAt 为 T1
  - S3：GET /api/health
  - S4：POST /api/sync，history 只含 https://example.com/diag-a，记录 syncedAt 为 T2
  - S5：GET /api/health
  - S6：POST /api/__test__/reset
  - S7：GET /api/health
- 预期：
  - E1：S1 的 body.lastSyncAt=null，body.pageCount=0
  - E2：S3 的 body.lastSyncAt=T1，body.pageCount=10
  - E3：S4 返回 200，body.created=1，且 T2 ≥ T1
  - E4：S5 的 body.lastSyncAt=T2，body.pageCount=11
  - E5：S6 返回 200，body.ok=true
  - E6：S7 的 body.pageCount=0、body.ruleCount=0、body.lastSyncAt=null，body.status="ok"
- 证据：evidence/TC-API-DIAG-003/（api: S3、S5、S7 响应）

### TC-API-DIAG-004 停用 1 条规则后 ruleCount 仍为 2、enabledRuleCount=1；删除该规则后 ruleCount=1
- 优先级：P1 ｜ 类别：state ｜ 技术：state-transition
- 关联 Feature：F-DIAG-09（AC2） ｜ 关联 Code：C-BE-DIAG-01、C-BE-CORE-12
- 前置条件：后端已 reset
- 测试数据：规则同契约示例：① archive_candidate（github.com、/issues/、7 天）；② never_archive（docs.internal.com）。规则 id 由后端生成，用 S1 返回值，不写死
- 步骤：
  - S1：POST /api/rules 保存规则①②，记录 never_archive 那条的 id 为 R2
  - S2：GET /api/health
  - S3：PATCH /api/rules/<R2>，请求体 { enabled: false }
  - S4：GET /api/health
  - S5：DELETE /api/rules/<R2>
  - S6：GET /api/health
- 预期：
  - E1：S1 返回 201，body.ruleCount=2
  - E2：S2 的 body.ruleCount=2、body.enabledRuleCount=2
  - E3：S3 返回 200，body.id=R2、body.enabled=false
  - E4：S4 的 body.ruleCount=2、body.enabledRuleCount=1
  - E5：S5 返回 200，body.deleted=R2、body.ruleCount=1
  - E6：S6 的 body.ruleCount=1、body.enabledRuleCount=1
- 证据：evidence/TC-API-DIAG-004/（api: S2、S4、S6 响应）

### TC-API-DIAG-005 uptime 以整秒计：与 startedAt 推算的秒数相差不超过 1，间隔 1.2 秒后至少增加 1
- 优先级：P1 ｜ 类别：boundary ｜ 技术：boundary
- 关联 Feature：F-DIAG-09（AC1） ｜ 关联 Code：C-BE-DIAG-01、C-BE-CORE-15
- 前置条件：后端已 reset
- 测试数据：契约：uptime 为 integer（秒），startedAt 为毫秒时间戳。秒级取整存在 ±1 秒误差，因此用「差值 ≤ 1」而不是严格相等；第二次请求前等待 1200 ms（> 1 秒）以跨过一个整秒边界
- 步骤：
  - S1：GET /api/health，记录 uptime 为 U1、startedAt 为 ST，以及收到响应时的本地 Date.now() 为 N1
  - S2：等待 1200 毫秒
  - S3：GET /api/health，记录 uptime 为 U2
- 预期：
  - E1：U1 为整数（Number.isInteger(U1)=true）且 U1 ≥ 0
  - E2：|U1 − floor((N1 − ST) / 1000)| ≤ 1
  - E3：U2 为整数且 U2 ≥ U1 + 1
  - E4：S3 的 body.startedAt=ST（进程未重启，reset 不改变启动时间）
- 证据：evidence/TC-API-DIAG-005/（api: S1、S3 响应）

### TC-API-DIAG-006 POST / DELETE /api/health 返回 405 METHOD_NOT_ALLOWED，Allow 头含 GET，且不影响数据
- 优先级：P1 ｜ 类别：negative ｜ 技术：error-guessing
- 关联 Feature：F-DIAG-09（AC1） ｜ 关联 Code：C-BE-DIAG-01、C-BE-CORE-03
- 前置条件：后端已 reset
- 测试数据：错误格式按契约 common.errorFormat：{ error: { code, message } }；405 时响应带 Allow 头（docs/03 §1.3）
- 步骤：
  - S1：POST /api/health，Content-Type: application/json，请求体 {}
  - S2：DELETE /api/health
  - S3：GET /api/health
- 预期：
  - E1：S1 返回 405，body.error.code="METHOD_NOT_ALLOWED"，body.error.message 为非空字符串
  - E2：S1 响应头 allow 包含 GET
  - E3：S2 返回 405，body.error.code="METHOD_NOT_ALLOWED"
  - E4：S3 返回 200，body.status="ok"、body.pageCount=0、body.ruleCount=0（错误请求没有副作用）
- 证据：evidence/TC-API-DIAG-006/（api: S1、S2 响应头与响应体）

### TC-API-DIAG-007 health 的 CORS 与请求 ID：chrome-extension 来源被放行并回传 x-request-id，其他来源不返回 Allow-Origin
- 优先级：P1 ｜ 类别：security ｜ 技术：equivalence
- 关联 Feature：F-DIAG-01（AC1）、F-DIAG-09（AC1） ｜ 关联 Code：C-BE-CORE-03、C-BE-DIAG-01
- 前置条件：后端已 reset
- 测试数据：契约 common.cors：允许 chrome-extension://*、http://localhost:*、http://127.0.0.1:*；OPTIONS 预检 204。有效来源取 chrome-extension://abcdefghijklmnopabcdefghijklmnop，无效来源取 https://evil.example.com；请求 ID 取 diag-007-req
- 步骤：
  - S1：GET /api/health，请求头 Origin: chrome-extension://abcdefghijklmnopabcdefghijklmnop、x-request-id: diag-007-req
  - S2：OPTIONS /api/health，请求头 Origin: chrome-extension://abcdefghijklmnopabcdefghijklmnop、Access-Control-Request-Method: GET
  - S3：GET /api/health，请求头 Origin: https://evil.example.com
- 预期：
  - E1：S1 返回 200，响应头 access-control-allow-origin=chrome-extension://abcdefghijklmnopabcdefghijklmnop
  - E2：S1 响应头 x-request-id="diag-007-req"，body.version="1.0.0"
  - E3：S2 返回 204，响应头 access-control-allow-methods 包含 GET
  - E4：S3 响应头中没有 access-control-allow-origin（值为 undefined）
- 证据：evidence/TC-API-DIAG-007/（api: S1、S2、S3 响应头）

### TC-API-DIAG-008 地址指向没有服务的端口时请求被拒绝（ECONNREFUSED）；改回测试后端地址后 health 立即恢复 200
- 优先级：P1 ｜ 类别：exception ｜ 技术：error-guessing
- 关联 Feature：F-DIAG-01（AC2、AC3）、F-DIAG-09（AC1） ｜ 关联 Code：C-BE-DIAG-01
- 前置条件：后端已 reset，测试后端监听 TEST_PORT
- 测试数据：不可达地址按 CONVENTIONS §5 / 技能约束用 http://127.0.0.1:9（无服务端口），不 route、不 mock 后端；可用地址为 webServer 启动的 http://127.0.0.1:<TEST_PORT>。前端将 ECONNREFUSED 归类为「连接被拒绝」（kind=refused），本用例验证其后端侧前提
- 步骤：
  - S1：用 request 直接 GET http://127.0.0.1:9/api/health，timeout 1500 毫秒，捕获异常
  - S2：GET http://127.0.0.1:<TEST_PORT>/api/health
- 预期：
  - E1：S1 抛出异常（没有 HTTP 状态码），异常 message 包含 ECONNREFUSED
  - E2：S2 返回 200，body.status="ok"、body.version="1.0.0"
  - E3：S2 的 body.pageCount=0、body.ruleCount=0
- 证据：evidence/TC-API-DIAG-008/（api: S1 异常信息；api: S2 响应）

### TC-API-DIAG-009 导入样例后连续 5 次 GET /api/health，每次耗时 < 1500 毫秒且 version=1.0.0
- 优先级：P2 ｜ 类别：performance ｜ 技术：boundary
- 关联 Feature：F-DIAG-01（AC1） ｜ 关联 Code：C-BE-DIAG-01
- 前置条件：后端已 reset
- 测试数据：1500 毫秒取自 ui-contract 消息 CHECK_CONNECTION 的 timeoutMs 默认值：health 超过该值会被插件判为超时。耗时用本地 Date.now() 在请求前后相减计算
- 步骤：
  - S1：POST /api/sync 导入平移后的 resource.json
  - S2：连续 5 次 GET /api/health，分别记录每次耗时（毫秒）
- 预期：
  - E1：S1 返回 200，body.pageCount=10
  - E2：S2 的 5 次响应状态都是 200，每次 body.version="1.0.0"、body.pageCount=10
  - E3：S2 的 5 次耗时都 < 1500 毫秒
- 证据：evidence/TC-API-DIAG-009/（api: S2 每次耗时）

### TC-API-DIAG-010 默认配置下 GET /api/config 返回 cleanupThresholdDays=14、maxHistoryItems=100、隐私过滤开启和 4 个默认关键词
- 优先级：P0 ｜ 类别：positive ｜ 技术：equivalence
- 关联 Feature：F-DIAG-10（AC1） ｜ 关联 Code：C-BE-DIAG-02、C-BE-CORE-02
- 前置条件：后端以默认配置启动并已 reset（没有 PUT /api/config 覆盖，没有 privacy_filter 规则）
- 测试数据：默认值来自 resource.json 的 config：cleanupThresholdDays=14、maxHistoryItems=100、enablePrivacyFilter=true、privacySensitiveKeywords=[password, token, bank, secret]
- 步骤：
  - S1：GET /api/config
- 预期：
  - E1：S1 返回 200，响应头 content-type 包含 application/json
  - E2：body.cleanupThresholdDays=14，body.maxHistoryItems=100
  - E3：body.enablePrivacyFilter=true
  - E4：body.privacySensitiveKeywords 等于 ["password","token","bank","secret"]（顺序与内容一致）
  - E5：body.baseSensitiveKeywords 等于 ["password","token","bank","secret"]
- 证据：evidence/TC-API-DIAG-010/（api: S1 响应）

### TC-API-DIAG-011 GET /api/config 扩展字段：historyLookbackDays=30、半衰期 7、四项权重、推荐下限 0.3、apiVersion="1" 和 4 项 limits
- 优先级：P0 ｜ 类别：positive ｜ 技术：equivalence
- 关联 Feature：F-DIAG-10（AC2） ｜ 关联 Code：C-BE-DIAG-02、C-BE-CORE-02
- 前置条件：后端以默认配置启动并已 reset
- 测试数据：权重与半衰期来自 PRD F-RANK-02（score = 0.4×recency + 0.3×frequency + 0.2×open + 0.1×domain，半衰期 7 天）；limits 只输出契约列出的 4 个字段，maxArrayItems 不对外（docs/03 §1.4）
- 步骤：
  - S1：GET /api/config
- 预期：
  - E1：S1 返回 200，body.historyLookbackDays=30，body.recencyHalfLifeDays=7
  - E2：body.weights 深度等于 { recency: 0.4, frequency: 0.3, open: 0.2, domain: 0.1 }
  - E3：body.minRecommendationScore=0.3
  - E4：body.apiVersion="1"（字符串）
  - E5：body.limits 深度等于 { maxItemsPerSync: 500, maxUrlLength: 2048, maxRuleTextLength: 500, maxBodyBytes: 1048576 }，不含 maxArrayItems
- 证据：evidence/TC-API-DIAG-011/（api: S1 响应）

### TC-API-DIAG-012 POST / DELETE /api/config 返回 405，Allow 头含 GET 和 PUT，配置保持默认值
- 优先级：P1 ｜ 类别：negative ｜ 技术：error-guessing
- 关联 Feature：F-DIAG-10（AC1） ｜ 关联 Code：C-BE-DIAG-02、C-BE-CORE-02
- 前置条件：后端以默认配置启动并已 reset
- 测试数据：/api/config 只支持 GET 与 PUT（契约）；POST 请求体故意携带 { cleanupThresholdDays: 3 }，用于检查没有被写入
- 步骤：
  - S1：POST /api/config，Content-Type: application/json，请求体 { "cleanupThresholdDays": 3 }
  - S2：DELETE /api/config
  - S3：GET /api/config
- 预期：
  - E1：S1 返回 405，body.error.code="METHOD_NOT_ALLOWED"，body.error.message 为非空字符串
  - E2：S1 响应头 allow 同时包含 GET 和 PUT
  - E3：S2 返回 405，body.error.code="METHOD_NOT_ALLOWED"
  - E4：S3 返回 200，body.cleanupThresholdDays=14（S1 未写入 3）
- 证据：evidence/TC-API-DIAG-012/（api: S1、S2 响应头与响应体；api: S3 响应）

### TC-API-DIAG-013 阈值取边界值 1 / 365 时 GET /api/config 如实返回，0 / 366 被拒绝且配置保持上一次的有效值
- 优先级：P1 ｜ 类别：boundary ｜ 技术：boundary
- 关联 Feature：F-DIAG-10（AC1、AC2） ｜ 关联 Code：C-BE-DIAG-02、C-BE-CORE-02
- 前置条件：后端以默认配置启动并已 reset
- 测试数据：契约 PUT /api/config：cleanupThresholdDays 为 1–365 的整数；maxHistoryItems 为 1–500。本用例关注 GET /api/config（getPublicConfig）对覆盖值的回显，以及只读字段 weights 不受影响
- 步骤：
  - S1：PUT /api/config，请求体 { "cleanupThresholdDays": 1 }
  - S2：GET /api/config
  - S3：PUT /api/config，请求体 { "cleanupThresholdDays": 365, "maxHistoryItems": 500 }
  - S4：GET /api/config
  - S5：PUT /api/config，请求体 { "cleanupThresholdDays": 0 }
  - S6：PUT /api/config，请求体 { "cleanupThresholdDays": 366 }
  - S7：GET /api/config
- 预期：
  - E1：S1 返回 200；S2 的 body.cleanupThresholdDays=1，body.maxHistoryItems=100
  - E2：S4 的 body.cleanupThresholdDays=365，body.maxHistoryItems=500
  - E3：S5 和 S6 都返回 400，body.error.code="VALIDATION_FAILED"，body.error.details.fields 包含 "cleanupThresholdDays"
  - E4：S7 的 body.cleanupThresholdDays=365、body.maxHistoryItems=500（失败的写入没有改变配置）
  - E5：S7 的 body.weights 仍为 { recency: 0.4, frequency: 0.3, open: 0.2, domain: 0.1 }，body.recencyHalfLifeDays=7
- 证据：evidence/TC-API-DIAG-013/（api: S2、S4、S7 响应；api: S5、S6 错误响应）

### TC-API-DIAG-014 PUT /api/config 请求体非法 JSON 或 Content-Type 错误时返回 400 / 415，GET /api/config 仍为默认值
- 优先级：P1 ｜ 类别：exception ｜ 技术：error-guessing
- 关联 Feature：F-DIAG-10（AC1） ｜ 关联 Code：C-BE-DIAG-02、C-BE-CORE-02
- 前置条件：后端以默认配置启动并已 reset
- 测试数据：错误码按契约 PUT /api/config.errors：非法 JSON → 400 INVALID_JSON；有请求体但 Content-Type 非 application/json → 415 UNSUPPORTED_MEDIA_TYPE
- 步骤：
  - S1：PUT /api/config，Content-Type: application/json，原始请求体为字符串 {"enablePrivacyFilter": fal
  - S2：PUT /api/config，Content-Type: text/plain，请求体为字符串 enablePrivacyFilter=false
  - S3：GET /api/config
- 预期：
  - E1：S1 返回 400，body.error.code="INVALID_JSON"，body.error.message 为非空字符串
  - E2：S2 返回 415，body.error.code="UNSUPPORTED_MEDIA_TYPE"
  - E3：S3 返回 200，body.enablePrivacyFilter=true，body.privacySensitiveKeywords 等于 ["password","token","bank","secret"]，body.cleanupThresholdDays=14
- 证据：evidence/TC-API-DIAG-014/（api: S1、S2 错误响应；api: S3 响应）

### TC-API-DIAG-015 保存 privacy_filter 规则后 privacySensitiveKeywords 合并 cookie、baseSensitiveKeywords 不变；删除规则后恢复 4 个默认词
- 优先级：P1 ｜ 类别：state ｜ 技术：state-transition
- 关联 Feature：F-DIAG-10（AC1） ｜ 关联 Code：C-BE-DIAG-02、C-BE-CORE-02
- 前置条件：后端以默认配置启动并已 reset
- 测试数据：规则 { rawText: "不要上传包含 cookie 的 URL", type: "privacy_filter", action: "exclude_upload", keywords: ["cookie"] }（PRD 规则类型表；F-DIAG-10 描述「privacySensitiveKeywords 已合并 privacy_filter 规则中的关键词」）。规则 id 用 S1 返回值
- 步骤：
  - S1：POST /api/rules 保存上述 privacy_filter 规则，记录返回的 id 为 R
  - S2：GET /api/config
  - S3：DELETE /api/rules/<R>
  - S4：GET /api/config
- 预期：
  - E1：S1 返回 201，body.rules[0].type="privacy_filter"，body.ruleCount=1
  - E2：S2 的 body.privacySensitiveKeywords 包含 "cookie"、"password"、"token"、"bank"、"secret"，共 5 项
  - E3：S2 的 body.baseSensitiveKeywords 仍等于 ["password","token","bank","secret"]
  - E4：S3 返回 200，body.deleted=R
  - E5：S4 的 body.privacySensitiveKeywords 等于 ["password","token","bank","secret"]，不包含 "cookie"
- 证据：evidence/TC-API-DIAG-015/（api: S2、S4 响应）

### TC-API-DIAG-016 关闭隐私过滤后 GET /api/config 返回 enablePrivacyFilter=false，reset 后恢复全部默认配置
- 优先级：P1 ｜ 类别：state ｜ 技术：state-transition
- 关联 Feature：F-DIAG-10（AC1） ｜ 关联 Code：C-BE-DIAG-02、C-BE-CORE-02
- 前置条件：后端以默认配置启动并已 reset
- 测试数据：enablePrivacyFilter=false 是插件诊断「隐私过滤」显示警告的后端前提（F-DIAG-08#AC2 的数据来源）；reset 契约要求「恢复默认配置」
- 步骤：
  - S1：PUT /api/config，请求体 { "enablePrivacyFilter": false, "cleanupThresholdDays": 30 }
  - S2：GET /api/config
  - S3：POST /api/__test__/reset
  - S4：GET /api/config
- 预期：
  - E1：S1 返回 200，body.enablePrivacyFilter=false
  - E2：S2 的 body.enablePrivacyFilter=false、body.cleanupThresholdDays=30，body.privacySensitiveKeywords 仍为 ["password","token","bank","secret"]
  - E3：S3 返回 200，body.ok=true
  - E4：S4 的 body.enablePrivacyFilter=true、body.cleanupThresholdDays=14、body.maxHistoryItems=100
- 证据：evidence/TC-API-DIAG-016/（api: S2、S4 响应）

## Feature → Case 覆盖表（本分片，仅 API）

| Feature | AC | 覆盖用例 | 类别分布 | waiver |
|---|---|---|---|---|
| F-DIAG-01 诊断：后端服务连接 | AC1 | TC-API-DIAG-001、TC-API-DIAG-007、TC-API-DIAG-009 | positive 1 / security 1 / exception 1 / performance 1 | 无 |
| F-DIAG-01 诊断：后端服务连接 | AC2 | TC-API-DIAG-008 | positive 1 / security 1 / exception 1 / performance 1 | 无 |
| F-DIAG-01 诊断：后端服务连接 | AC3 | TC-API-DIAG-008 | positive 1 / security 1 / exception 1 / performance 1 | 无 |
| F-DIAG-09 GET /api/health 返回健康信息 | AC1 | TC-API-DIAG-001、TC-API-DIAG-003、TC-API-DIAG-005、TC-API-DIAG-006、TC-API-DIAG-007、TC-API-DIAG-008 | positive 2 / state 2 / boundary 1 / negative 1 / security 1 / exception 1 | 无 |
| F-DIAG-09 GET /api/health 返回健康信息 | AC2 | TC-API-DIAG-002、TC-API-DIAG-003、TC-API-DIAG-004 | positive 2 / state 2 / boundary 1 / negative 1 / security 1 / exception 1 | 无 |
| F-DIAG-10 GET /api/config 返回配置 | AC1 | TC-API-DIAG-010、TC-API-DIAG-012、TC-API-DIAG-013、TC-API-DIAG-014、TC-API-DIAG-015、TC-API-DIAG-016 | positive 2 / negative 1 / boundary 1 / exception 1 / state 2 | 无 |
| F-DIAG-10 GET /api/config 返回配置 | AC2 | TC-API-DIAG-011、TC-API-DIAG-013 | positive 2 / negative 1 / boundary 1 / exception 1 / state 2 | 无 |

## 类别分布统计（本分片）

| 模块 | positive | state | boundary | negative | security | exception | performance | 合计 |
|---|---|---|---|---|---|---|---|---|
| DIAG（API） | 4 | 4 | 2 | 2 | 1 | 2 | 1 | 16 |

> 全项目统计以 `node .agents/skills/nav-test-case-design/scripts/check-cases.mjs --json` 的 stats 为准（合并后计算）。

## 设计说明

- F-DIAG-01 是 FE+BE 的展示类 Feature：API 分片只验证后端侧前提（health 字段与 version、CORS 放行插件来源、无服务端口返回 ECONNREFUSED、响应耗时低于插件 1500 毫秒超时）；「连接被拒绝」文案、4 条排查步骤、顶栏状态与红点由 UI 分片验证。
- 时间：health 不支持 `?now=`，uptime 为整秒，因此用例 005 用「差值 ≤ 1」与「间隔 1.2 秒后至少 +1」来表达边界，不断言严格相等。
- 只读接口没有入参，反例取「不支持的方法 → 405」，并断言没有副作用。
