# 接口用例分片：PRIV（隐私过滤）

> 本文件是 PRIV 模块 type=API 用例的分片，与 `docs/trace/cases/API-PRIV.json` 一一对应；docs/06 由 validator 合并生成。F-PRIV-01 / 02 / 04 只有 FE 层，由 UI 分片覆盖。

执行约定：每条用例前测试夹具自动调用 `POST /api/__test__/reset` 隔离状态；数据一律通过真实的 `POST /api/sync` / `POST /api/rules` / `PUT /api/config` 构造；样例按 D-01 平移（最新一条 = 导入时刻 − 5 分钟）。后端生成的 id 一律取响应值，不写死。

### TC-API-PRIV-001 直接同步一条含 token 的历史：200、rejected=1、不入库、ranked 中没有该 URL
- 优先级：P0 ｜ 类别：positive ｜ 技术：equivalence
- 关联 Feature：F-PRIV-03（AC1） ｜ 关联 Code：C-BE-PRIV-01、C-BE-PRIV-02、C-BE-SYNC-02
- 前置条件：后端以 ENABLE_TEST_API=1 启动（playwright webServer，端口 TEST_PORT，LOG_FILE=evidence/_runtime/server-<port>.log），未配置 SNAPSHOT_FILE；测试夹具已调用 POST /api/__test__/reset，配置恢复默认（privacySensitiveKeywords=["password","token","bank","secret"]，enablePrivacyFilter=true）
- 测试数据：history 只含 1 条 { url: https://example.com/reset?token=abc, title: "t", lastVisitTime: now − 1 小时, visitCount: 1 }；不传 activeTab / openTabs；默认关键词含 token，因此命中隐私过滤
- 步骤：
  - S1：POST /api/__test__/reset
  - S2：POST /api/sync，请求体 { history: [https://example.com/reset?token=abc] }
  - S3：GET /api/pages/ranked
  - S4：GET /api/health
- 预期：
  - E1：S2 返回 200，body.ok=true，body.received=1，body.rejected=1，body.created=0，body.updated=0
  - E2：S2 的 body.rejectedByReason 严格等于 { invalid_url: 0, privacy: 1 }，body.pageCount=0
  - E3：S2 的响应体序列化后不包含字符串「reset?token=abc」（只给计数，不回显 URL）
  - E4：S3 返回 200，body.total=0，body.pages 中没有 url 包含「reset?token=abc」的项
  - E5：S4 返回 200，body.pageCount=0
- 证据：evidence/TC-API-PRIV-001/（api: S2 响应（rejected / rejectedByReason）；api: S3 响应）

### TC-API-PRIV-002 拒收敏感 URL 时后端日志只记域名和数量，不出现完整 URL
- 优先级：P0 ｜ 类别：security ｜ 技术：error-guessing
- 关联 Feature：F-PRIV-03（AC2） ｜ 关联 Code：C-BE-CORE-06、C-BE-PRIV-02
- 前置条件：后端以 ENABLE_TEST_API=1 启动（playwright webServer，端口 TEST_PORT，LOG_FILE=evidence/_runtime/server-<port>.log），未配置 SNAPSHOT_FILE；测试夹具已调用 POST /api/__test__/reset，配置恢复默认（privacySensitiveKeywords=["password","token","bank","secret"]，enablePrivacyFilter=true）
- 测试数据：history 只含 1 条 https://example.com/reset?token=abc；读取 LOG_FILE（evidence/_runtime/server-<port>.log）在 S2 前记录文件字节偏移，S2 后只读新增部分
- 步骤：
  - S1：POST /api/__test__/reset
  - S2：记录 LOG_FILE 当前字节长度 L0
  - S3：POST /api/sync，请求体 { history: [https://example.com/reset?token=abc] }
  - S4：读取 LOG_FILE 从 L0 到文件末尾的新增日志，逐行 JSON.parse
- 预期：
  - E1：S3 返回 200，body.rejected=1，body.rejectedByReason.privacy=1
  - E2：S4 新增日志非空，且全文不包含「reset?token=abc」也不包含「token=abc」
  - E3：S4 中存在 msg="sync done" 的一行，其 rejected=1、rejectedByReason.privacy=1，rejectedDomains["example.com"]=1
- 证据：evidence/TC-API-PRIV-002/（server.log: S3 期间新增日志片段；api: S3 响应）

### TC-API-PRIV-003 activeTab / openTabs / history 三处的敏感 URL 都被拒收，大小写不敏感，普通 URL 正常入库
- 优先级：P0 ｜ 类别：positive ｜ 技术：decision-table
- 关联 Feature：F-PRIV-03（AC1） ｜ 关联 Code：C-BE-PRIV-01、C-BE-PRIV-02、C-BE-SYNC-02
- 前置条件：后端以 ENABLE_TEST_API=1 启动（playwright webServer，端口 TEST_PORT，LOG_FILE=evidence/_runtime/server-<port>.log），未配置 SNAPSHOT_FILE；测试夹具已调用 POST /api/__test__/reset，配置恢复默认（privacySensitiveKeywords=["password","token","bank","secret"]，enablePrivacyFilter=true）
- 测试数据：activeTab=https://accounts.example.com/reset-password?token=8f2a91c（命中 password/token）；openTabs=[https://bank.example.com/account/overview（bank），https://example.com/login?TOKEN=abc（大写 TOKEN）]；history=[https://example.com/?secret=1（secret），https://example.com/priv-ok（不含关键词）]，history 的 lastVisitTime=now−1 小时、visitCount=1。共 5 条，敏感 4 条
- 步骤：
  - S1：POST /api/__test__/reset
  - S2：POST /api/sync，请求体为上述 activeTab + openTabs + history
  - S3：GET /api/pages/ranked
  - S4：GET /api/health
- 预期：
  - E1：S2 返回 200，body.received=5，body.rejected=4，body.created=1，body.pageCount=1
  - E2：S2 的 body.rejectedByReason 严格等于 { invalid_url: 0, privacy: 4 }
  - E3：S3 的 body.total=1，body.pages[0].url="https://example.com/priv-ok"
  - E4：S3 的 body.pages 中没有任何 url 包含 password、token（不区分大小写）、bank、secret
  - E5：S4 的 body.pageCount=1
- 证据：evidence/TC-API-PRIV-003/（api: S2、S3 响应）

### TC-API-PRIV-004 只匹配 URL 的子串：tokenizer 被误拦（已知局限），关键词只出现在标题时不拦
- 优先级：P2 ｜ 类别：boundary ｜ 技术：boundary
- 关联 Feature：F-PRIV-03（AC1） ｜ 关联 Code：C-BE-PRIV-01
- 前置条件：后端以 ENABLE_TEST_API=1 启动（playwright webServer，端口 TEST_PORT，LOG_FILE=evidence/_runtime/server-<port>.log），未配置 SNAPSHOT_FILE；测试夹具已调用 POST /api/__test__/reset，配置恢复默认（privacySensitiveKeywords=["password","token","bank","secret"]，enablePrivacyFilter=true）
- 测试数据：history=[https://huggingface.co/docs/tokenizers（URL 含 token 子串，D-18 已知误伤），{ url: https://example.com/docs-a, title: "password reset guide"（关键词只在标题）}]，lastVisitTime=now−1 小时
- 步骤：
  - S1：POST /api/__test__/reset
  - S2：POST /api/sync，请求体 { history: [上述 2 条] }
  - S3：GET /api/pages/ranked
- 预期：
  - E1：S2 返回 200，body.received=2，body.rejected=1，body.rejectedByReason.privacy=1，body.created=1
  - E2：S3 的 body.total=1，body.pages[0].url="https://example.com/docs-a"，title="password reset guide"
  - E3：S3 的 body.pages 中没有 url="https://huggingface.co/docs/tokenizers" 的项
- 证据：evidence/TC-API-PRIV-004/（api: S2、S3 响应）

### TC-API-PRIV-005 拒收统计区分 invalid_url 与 privacy，坏记录不影响同批正常记录
- 优先级：P1 ｜ 类别：negative ｜ 技术：equivalence
- 关联 Feature：F-PRIV-03（AC1） ｜ 关联 Code：C-BE-PRIV-02、C-BE-SYNC-02
- 前置条件：后端以 ENABLE_TEST_API=1 启动（playwright webServer，端口 TEST_PORT，LOG_FILE=evidence/_runtime/server-<port>.log），未配置 SNAPSHOT_FILE；测试夹具已调用 POST /api/__test__/reset，配置恢复默认（privacySensitiveKeywords=["password","token","bank","secret"]，enablePrivacyFilter=true）
- 测试数据：history=[javascript:alert(1)（非 http(s)），https://example.com/reset?token=abc（敏感），https://example.com/fine（正常）]，lastVisitTime=now−1 小时
- 步骤：
  - S1：POST /api/__test__/reset
  - S2：POST /api/sync，请求体 { history: [上述 3 条] }
  - S3：GET /api/health
- 预期：
  - E1：S2 返回 200，body.received=3，body.rejected=2，body.created=1
  - E2：S2 的 body.rejectedByReason 严格等于 { invalid_url: 1, privacy: 1 }
  - E3：S3 的 body.pageCount=1
- 证据：evidence/TC-API-PRIV-005/（api: S2 响应）

### TC-API-PRIV-006 关闭 enablePrivacyFilter 后敏感 URL 被接收，重新开启后再次拒收
- 优先级：P1 ｜ 类别：state ｜ 技术：state-transition
- 关联 Feature：F-PRIV-03（AC1）、F-PRIV-05（AC3） ｜ 关联 Code：C-BE-PRIV-02、C-BE-PRIV-03
- 前置条件：后端以 ENABLE_TEST_API=1 启动（playwright webServer，端口 TEST_PORT，LOG_FILE=evidence/_runtime/server-<port>.log），未配置 SNAPSHOT_FILE；测试夹具已调用 POST /api/__test__/reset，配置恢复默认（privacySensitiveKeywords=["password","token","bank","secret"]，enablePrivacyFilter=true）
- 测试数据：第 1 次同步 history=[https://example.com/reset?token=abc]；第 2 次同步 history=[https://example.com/?password=1]；lastVisitTime=now−1 小时
- 步骤：
  - S1：POST /api/__test__/reset
  - S2：PUT /api/config，请求体 { enablePrivacyFilter: false }
  - S3：POST /api/sync，history=[https://example.com/reset?token=abc]
  - S4：PUT /api/config，请求体 { enablePrivacyFilter: true }
  - S5：POST /api/sync，history=[https://example.com/?password=1]
  - S6：GET /api/health
- 预期：
  - E1：S2 返回 200，body.enablePrivacyFilter=false
  - E2：S3 返回 200，body.rejected=0，body.created=1，body.rejectedByReason.privacy=0
  - E3：S4 返回 200，body.enablePrivacyFilter=true
  - E4：S5 返回 200，body.rejected=1，body.rejectedByReason.privacy=1，body.created=0
  - E5：S6 的 body.pageCount=1
- 证据：evidence/TC-API-PRIV-006/（api: S2–S5 响应）

### TC-API-PRIV-007 保存 privacy_filter 规则「不要上传包含 cookie 的 URL」后 GET /api/config 关键词含 cookie 与 4 个默认词
- 优先级：P1 ｜ 类别：positive ｜ 技术：equivalence
- 关联 Feature：F-PRIV-05（AC1） ｜ 关联 Code：C-BE-PRIV-02、C-BE-CORE-12
- 前置条件：后端以 ENABLE_TEST_API=1 启动（playwright webServer，端口 TEST_PORT，LOG_FILE=evidence/_runtime/server-<port>.log），未配置 SNAPSHOT_FILE；测试夹具已调用 POST /api/__test__/reset，配置恢复默认（privacySensitiveKeywords=["password","token","bank","secret"]，enablePrivacyFilter=true）
- 测试数据：规则：{ rawText: "不要上传包含 cookie 的 URL", type: "privacy_filter", keywords: ["cookie"], action: "exclude_upload" }
- 步骤：
  - S1：POST /api/__test__/reset
  - S2：GET /api/config
  - S3：POST /api/rules，请求体 { rules: [上述规则] }
  - S4：GET /api/config
- 预期：
  - E1：S2 返回 200，body.privacySensitiveKeywords 严格等于 ["password","token","bank","secret"]
  - E2：S3 返回 201，body.ruleCount=1，body.rules[0].type="privacy_filter"，keywords=["cookie"]
  - E3：S4 返回 200，body.privacySensitiveKeywords 包含 cookie、password、token、bank、secret，共 5 项
  - E4：S4 的 body.baseSensitiveKeywords 严格等于 ["password","token","bank","secret"]（不含规则关键词）
- 证据：evidence/TC-API-PRIV-007/（api: S2–S4 响应）

### TC-API-PRIV-008 保存 cookie 规则后同步 https://example.com/?cookie=1：rejected=1、不入库
- 优先级：P1 ｜ 类别：positive ｜ 技术：equivalence
- 关联 Feature：F-PRIV-05（AC2） ｜ 关联 Code：C-BE-PRIV-01、C-BE-PRIV-02
- 前置条件：后端以 ENABLE_TEST_API=1 启动（playwright webServer，端口 TEST_PORT，LOG_FILE=evidence/_runtime/server-<port>.log），未配置 SNAPSHOT_FILE；测试夹具已调用 POST /api/__test__/reset，配置恢复默认（privacySensitiveKeywords=["password","token","bank","secret"]，enablePrivacyFilter=true）
- 测试数据：规则同「不要上传包含 cookie 的 URL」（privacy_filter，keywords=["cookie"]）；history=[https://example.com/?cookie=1]，lastVisitTime=now−1 小时
- 步骤：
  - S1：POST /api/__test__/reset
  - S2：POST /api/rules 保存 cookie 规则
  - S3：POST /api/sync，history=[https://example.com/?cookie=1]
  - S4：GET /api/pages/ranked
  - S5：GET /api/health
- 预期：
  - E1：S2 返回 201，body.ruleCount=1
  - E2：S3 返回 200，body.rejected=1，body.rejectedByReason.privacy=1，body.created=0
  - E3：S4 的 body.pages 中没有 url="https://example.com/?cookie=1" 的项，body.total=0
  - E4：S5 的 body.pageCount=0
- 证据：evidence/TC-API-PRIV-008/（api: S3、S4 响应）

### TC-API-PRIV-009 PUT /api/config 把关键词改为 5 项（含 session）后 GET 返回含 session，且 session URL 被拒收
- 优先级：P1 ｜ 类别：positive ｜ 技术：equivalence
- 关联 Feature：F-PRIV-05（AC3） ｜ 关联 Code：C-BE-PRIV-03、C-BE-CORE-12、C-BE-PRIV-01
- 前置条件：后端以 ENABLE_TEST_API=1 启动（playwright webServer，端口 TEST_PORT，LOG_FILE=evidence/_runtime/server-<port>.log），未配置 SNAPSHOT_FILE；测试夹具已调用 POST /api/__test__/reset，配置恢复默认（privacySensitiveKeywords=["password","token","bank","secret"]，enablePrivacyFilter=true）
- 测试数据：PUT 请求体 { privacySensitiveKeywords: ["password","token","bank","secret","session"] }；之后同步 history=[https://example.com/?session=1]
- 步骤：
  - S1：POST /api/__test__/reset
  - S2：PUT /api/config，请求体如测试数据
  - S3：GET /api/config
  - S4：POST /api/sync，history=[https://example.com/?session=1]
- 预期：
  - E1：S2 返回 200，body.privacySensitiveKeywords 包含 session，body.cleanupThresholdDays=14（未修改字段保持默认）
  - E2：S3 返回 200，body.baseSensitiveKeywords 严格等于 ["password","token","bank","secret","session"]，body.privacySensitiveKeywords 包含 session
  - E3：S4 返回 200，body.rejected=1，body.rejectedByReason.privacy=1，body.created=0
- 证据：evidence/TC-API-PRIV-009/（api: S2–S4 响应）

### TC-API-PRIV-010 PUT 关键词转小写去重并整体替换：SeSsIoN 被拦、移除的 token 不再拦
- 优先级：P1 ｜ 类别：boundary ｜ 技术：error-guessing
- 关联 Feature：F-PRIV-05（AC3） ｜ 关联 Code：C-BE-PRIV-03、C-BE-PRIV-01
- 前置条件：后端以 ENABLE_TEST_API=1 启动（playwright webServer，端口 TEST_PORT，LOG_FILE=evidence/_runtime/server-<port>.log），未配置 SNAPSHOT_FILE；测试夹具已调用 POST /api/__test__/reset，配置恢复默认（privacySensitiveKeywords=["password","token","bank","secret"]，enablePrivacyFilter=true）
- 测试数据：PUT 请求体 { privacySensitiveKeywords: ["Session","SESSION","password"] }；同步 history=[https://example.com/?SeSsIoN=1，https://example.com/?token=1]，lastVisitTime=now−1 小时
- 步骤：
  - S1：POST /api/__test__/reset
  - S2：PUT /api/config，请求体如测试数据
  - S3：GET /api/config
  - S4：POST /api/sync，history 为上述 2 条
- 预期：
  - E1：S2 返回 200
  - E2：S3 的 body.baseSensitiveKeywords 严格等于 ["session","password"]（小写、去重、共 2 项）
  - E3：S4 返回 200，body.rejected=1，body.rejectedByReason.privacy=1，body.created=1，body.pageCount=1
- 证据：evidence/TC-API-PRIV-010/（api: S3、S4 响应）

### TC-API-PRIV-011 关键词长度与个数边界：50 字符 / 50 项通过，51 字符 / 51 项返回 400
- 优先级：P2 ｜ 类别：boundary ｜ 技术：boundary
- 关联 Feature：F-PRIV-05（AC3） ｜ 关联 Code：C-BE-PRIV-03
- 前置条件：后端以 ENABLE_TEST_API=1 启动（playwright webServer，端口 TEST_PORT，LOG_FILE=evidence/_runtime/server-<port>.log），未配置 SNAPSHOT_FILE；测试夹具已调用 POST /api/__test__/reset，配置恢复默认（privacySensitiveKeywords=["password","token","bank","secret"]，enablePrivacyFilter=true）
- 测试数据：k50 = "a".repeat(50)；k51 = "a".repeat(51)；list50 = ["kw01".."kw50"]（50 个互不相同）；list51 = ["kw01".."kw51"]
- 步骤：
  - S1：POST /api/__test__/reset
  - S2：PUT /api/config，{ privacySensitiveKeywords: [k50] }
  - S3：PUT /api/config，{ privacySensitiveKeywords: [k51] }
  - S4：PUT /api/config，{ privacySensitiveKeywords: list50 }
  - S5：PUT /api/config，{ privacySensitiveKeywords: list51 }
  - S6：GET /api/config
- 预期：
  - E1：S2 返回 200，body.baseSensitiveKeywords 严格等于 [k50]
  - E2：S3 返回 400，body.error.code="VALIDATION_FAILED"，message 非空，details.fields 包含 "privacySensitiveKeywords"
  - E3：S4 返回 200，body.baseSensitiveKeywords 长度=50
  - E4：S5 返回 400，body.error.code="VALIDATION_FAILED"，details.fields 包含 "privacySensitiveKeywords"
  - E5：S6 的 body.baseSensitiveKeywords 长度=50 且等于 list50（失败的 S5 无副作用）
- 证据：evidence/TC-API-PRIV-011/（api: S2–S6 响应）

### TC-API-PRIV-012 关键词改为空数组后不再拦截 password，reset 后恢复 4 个默认词
- 优先级：P2 ｜ 类别：boundary ｜ 技术：state-transition
- 关联 Feature：F-PRIV-05（AC3）、F-PRIV-03（AC1） ｜ 关联 Code：C-BE-PRIV-03、C-BE-PRIV-02、C-BE-CORE-12
- 前置条件：后端以 ENABLE_TEST_API=1 启动（playwright webServer，端口 TEST_PORT，LOG_FILE=evidence/_runtime/server-<port>.log），未配置 SNAPSHOT_FILE；测试夹具已调用 POST /api/__test__/reset，配置恢复默认（privacySensitiveKeywords=["password","token","bank","secret"]，enablePrivacyFilter=true）
- 测试数据：PUT { privacySensitiveKeywords: [] }（0 项为契约下限）；同步 history=[https://example.com/?password=1]
- 步骤：
  - S1：POST /api/__test__/reset
  - S2：PUT /api/config，{ privacySensitiveKeywords: [] }
  - S3：POST /api/sync，history=[https://example.com/?password=1]
  - S4：POST /api/__test__/reset
  - S5：GET /api/config
- 预期：
  - E1：S2 返回 200，body.privacySensitiveKeywords 严格等于 []
  - E2：S3 返回 200，body.rejected=0，body.created=1
  - E3：S4 返回 200，body.ok=true
  - E4：S5 的 body.privacySensitiveKeywords 严格等于 ["password","token","bank","secret"]
- 证据：evidence/TC-API-PRIV-012/（api: S2、S3、S5 响应）

### TC-API-PRIV-013 PUT /api/config 字段非法或无可识别字段：400 VALIDATION_FAILED 且配置不变
- 优先级：P1 ｜ 类别：negative ｜ 技术：equivalence
- 关联 Feature：F-PRIV-05（AC3） ｜ 关联 Code：C-BE-PRIV-03
- 前置条件：后端以 ENABLE_TEST_API=1 启动（playwright webServer，端口 TEST_PORT，LOG_FILE=evidence/_runtime/server-<port>.log），未配置 SNAPSHOT_FILE；测试夹具已调用 POST /api/__test__/reset，配置恢复默认（privacySensitiveKeywords=["password","token","bank","secret"]，enablePrivacyFilter=true）
- 测试数据：非法请求体：① {}；② { privacySensitiveKeywords: "cookie" }（字符串不是数组）；③ { privacySensitiveKeywords: [""] }（空串）；④ { weights: { recency: 1 } }（只读字段，无可识别字段）
- 步骤：
  - S1：POST /api/__test__/reset
  - S2：PUT /api/config，请求体 ①
  - S3：PUT /api/config，请求体 ②
  - S4：PUT /api/config，请求体 ③
  - S5：PUT /api/config，请求体 ④
  - S6：GET /api/config
- 预期：
  - E1：S2 返回 400，body.error.code="VALIDATION_FAILED"，body.error.message 为非空字符串
  - E2：S3 返回 400，body.error.code="VALIDATION_FAILED"，details.fields 包含 "privacySensitiveKeywords"
  - E3：S4 返回 400，body.error.code="VALIDATION_FAILED"
  - E4：S5 返回 400，body.error.code="VALIDATION_FAILED"
  - E5：S6 的 body.privacySensitiveKeywords 严格等于 ["password","token","bank","secret"]，body.weights 严格等于 { recency: 0.4, frequency: 0.3, open: 0.2, domain: 0.1 }
- 证据：evidence/TC-API-PRIV-013/（api: S2–S6 响应）

### TC-API-PRIV-014 PUT /api/config 请求体不是 JSON 返回 400 INVALID_JSON，Content-Type 错误返回 415
- 优先级：P2 ｜ 类别：exception ｜ 技术：error-guessing
- 关联 Feature：F-PRIV-05（AC3） ｜ 关联 Code：C-BE-PRIV-03
- 前置条件：后端以 ENABLE_TEST_API=1 启动（playwright webServer，端口 TEST_PORT，LOG_FILE=evidence/_runtime/server-<port>.log），未配置 SNAPSHOT_FILE；测试夹具已调用 POST /api/__test__/reset，配置恢复默认（privacySensitiveKeywords=["password","token","bank","secret"]，enablePrivacyFilter=true）
- 测试数据：① Content-Type: application/json，body 为字符串「{bad json」；② Content-Type: text/plain，body 为 {"cleanupThresholdDays":7}
- 步骤：
  - S1：POST /api/__test__/reset
  - S2：PUT /api/config，请求 ①
  - S3：PUT /api/config，请求 ②
  - S4：GET /api/config
- 预期：
  - E1：S2 返回 400，body.error.code="INVALID_JSON"，body.error.message 为非空字符串
  - E2：S3 返回 415，body.error.code="UNSUPPORTED_MEDIA_TYPE"，body.error.message 为非空字符串
  - E3：S4 的 body.cleanupThresholdDays=14（两次失败请求无副作用）
- 证据：evidence/TC-API-PRIV-014/（api: S2–S4 响应）

### TC-API-PRIV-015 PUT /api/config 阈值边界：cleanupThresholdDays 1/365、maxHistoryItems 500、historyLookbackDays 90 通过，越界 400
- 优先级：P2 ｜ 类别：boundary ｜ 技术：boundary
- 关联 Feature：F-PRIV-05（AC3） ｜ 关联 Code：C-BE-PRIV-03、C-BE-CORE-12
- 前置条件：后端以 ENABLE_TEST_API=1 启动（playwright webServer，端口 TEST_PORT，LOG_FILE=evidence/_runtime/server-<port>.log），未配置 SNAPSHOT_FILE；测试夹具已调用 POST /api/__test__/reset，配置恢复默认（privacySensitiveKeywords=["password","token","bank","secret"]，enablePrivacyFilter=true）
- 测试数据：合法：cleanupThresholdDays=1、365；maxHistoryItems=500；historyLookbackDays=90。非法：cleanupThresholdDays=0、366；maxHistoryItems=501；historyLookbackDays=91
- 步骤：
  - S1：POST /api/__test__/reset
  - S2：PUT /api/config，{ cleanupThresholdDays: 1 }
  - S3：PUT /api/config，{ cleanupThresholdDays: 365, maxHistoryItems: 500, historyLookbackDays: 90 }
  - S4：PUT /api/config，{ cleanupThresholdDays: 0 }
  - S5：PUT /api/config，{ cleanupThresholdDays: 366 }
  - S6：PUT /api/config，{ maxHistoryItems: 501 }
  - S7：PUT /api/config，{ historyLookbackDays: 91 }
  - S8：GET /api/config
- 预期：
  - E1：S2 返回 200，body.cleanupThresholdDays=1
  - E2：S3 返回 200，body.cleanupThresholdDays=365、body.maxHistoryItems=500、body.historyLookbackDays=90
  - E3：S4、S5 都返回 400，body.error.code="VALIDATION_FAILED"，details.fields 包含 "cleanupThresholdDays"
  - E4：S6 返回 400，details.fields 包含 "maxHistoryItems"；S7 返回 400，details.fields 包含 "historyLookbackDays"
  - E5：S8 的 body.cleanupThresholdDays=365、maxHistoryItems=500、historyLookbackDays=90（越界请求无副作用）
- 证据：evidence/TC-API-PRIV-015/（api: S2–S8 响应）

### TC-API-PRIV-016 删除 cookie 规则后关键词表移除 cookie，?cookie=1 的 URL 可以入库
- 优先级：P2 ｜ 类别：state ｜ 技术：state-transition
- 关联 Feature：F-PRIV-05（AC1、AC2） ｜ 关联 Code：C-BE-PRIV-02、C-BE-PRIV-01
- 前置条件：后端以 ENABLE_TEST_API=1 启动（playwright webServer，端口 TEST_PORT，LOG_FILE=evidence/_runtime/server-<port>.log），未配置 SNAPSHOT_FILE；测试夹具已调用 POST /api/__test__/reset，配置恢复默认（privacySensitiveKeywords=["password","token","bank","secret"]，enablePrivacyFilter=true）
- 测试数据：规则 { rawText: "不要上传包含 cookie 的 URL", type: "privacy_filter", keywords: ["cookie"], action: "exclude_upload" }；history=[https://example.com/?cookie=1]
- 步骤：
  - S1：POST /api/__test__/reset
  - S2：POST /api/rules 保存 cookie 规则，记录返回的 rules[0].id
  - S3：DELETE /api/rules/<S2 返回的 id>
  - S4：GET /api/config
  - S5：POST /api/sync，history=[https://example.com/?cookie=1]
- 预期：
  - E1：S2 返回 201，body.rules[0].id 为非空字符串
  - E2：S3 返回 200，body.deleted 等于 S2 返回的 id，body.ruleCount=0
  - E3：S4 的 body.privacySensitiveKeywords 严格等于 ["password","token","bank","secret"]（不含 cookie）
  - E4：S5 返回 200，body.rejected=0，body.created=1
- 证据：evidence/TC-API-PRIV-016/（api: S2–S5 响应）

### TC-API-PRIV-017 含敏感 URL 的请求体不是合法 JSON：400 INVALID_JSON，错误信息和日志都不回显 URL
- 优先级：P1 ｜ 类别：exception ｜ 技术：error-guessing
- 关联 Feature：F-PRIV-03（AC2） ｜ 关联 Code：C-BE-CORE-06、C-BE-PRIV-02
- 前置条件：后端以 ENABLE_TEST_API=1 启动（playwright webServer，端口 TEST_PORT，LOG_FILE=evidence/_runtime/server-<port>.log），未配置 SNAPSHOT_FILE；测试夹具已调用 POST /api/__test__/reset，配置恢复默认（privacySensitiveKeywords=["password","token","bank","secret"]，enablePrivacyFilter=true）
- 测试数据：Content-Type: application/json，body 为截断的 JSON 字符串「{"history":[{"url":"https://example.com/reset?token=abc"」（缺少结尾括号）；S2 前记录 LOG_FILE 字节偏移
- 步骤：
  - S1：POST /api/__test__/reset
  - S2：记录 LOG_FILE 当前字节长度 L0
  - S3：POST /api/sync，发送上述截断的请求体
  - S4：读取 LOG_FILE 从 L0 到末尾的新增日志
  - S5：GET /api/health
- 预期：
  - E1：S3 返回 400，body.error.code="INVALID_JSON"，body.error.message 为非空字符串
  - E2：S3 的响应体序列化后不包含「reset?token=abc」
  - E3：S4 新增日志全文不包含「reset?token=abc」也不包含「token=abc」
  - E4：S5 的 body.pageCount=0
- 证据：evidence/TC-API-PRIV-017/（server.log: S3 期间新增日志片段；api: S3 响应）

## Feature → Case 覆盖表

| Feature | 用例 |
|---|---|
| F-PRIV-03 | TC-API-PRIV-001、TC-API-PRIV-002、TC-API-PRIV-003、TC-API-PRIV-004、TC-API-PRIV-005、TC-API-PRIV-006、TC-API-PRIV-012、TC-API-PRIV-017 |
| F-PRIV-05 | TC-API-PRIV-006、TC-API-PRIV-007、TC-API-PRIV-008、TC-API-PRIV-009、TC-API-PRIV-010、TC-API-PRIV-011、TC-API-PRIV-012、TC-API-PRIV-013、TC-API-PRIV-014、TC-API-PRIV-015、TC-API-PRIV-016 |
