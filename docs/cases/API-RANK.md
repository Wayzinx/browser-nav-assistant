# 接口用例：RANK

执行约定：每条用例前测试夹具自动调用 `POST /api/__test__/reset` 隔离状态；数据一律通过真实的 `POST /api/sync` / `POST /api/rules` 构造；样例按 D-01 平移（最新一条 = T − 5 分钟，T 为用例开始时的 Date.now()），所有 ranked 读请求带 `?now=T` 固定时间；后端生成的规则 id 一律取响应值，不写死。期望值以 PRD 第 13 章和 resource.json 推演为准。

## RANK 历史排序（后端接口）

### TC-API-RANK-001 导入 resource.json 样例：ranked 返回 10 条、按 score 降序（含同分 lastVisitedAt 次序），每条字段完整
- 优先级：P0 ｜ 类别：positive ｜ 技术：equivalence
- 关联 Feature：F-RANK-01（AC1） ｜ 关联 Code：C-BE-RANK-04、C-BE-RANK-05
- 前置条件：后端以 ENABLE_TEST_API=1 启动，测试夹具已调用 POST /api/__test__/reset；没有任何规则
- 测试数据：样例 samplePayload({ now: T })（D-01），POST /api/sync 导入：received=14、created=10、pageCount=10（PRD 13.2）；期望顺序与分数取自 PRD 13.3；读请求带 ?now=T
- 步骤：
  - S1：POST /api/sync 导入平移后的样例，记录 body.syncedAt
  - S2：GET /api/pages/ranked?now=T
- 预期：
  - E1：S2 返回 200，body.total=10，body.pages.length=10，body.generatedAt=T
  - E2：pages 的 url 依次为 issues/123、pull/456、Fetch_API、useState、issues/123?tab=comments、actions、react.dev/learn、docs.internal.com/ai-agent-design、issues/100、Google 搜索页（第 5、6 名同分按 lastVisitedAt 倒序）
  - E3：pages 的 score 依次为 [1.00,0.94,0.83,0.69,0.68,0.68,0.57,0.56,0.23,0.11]，整体非严格降序
  - E4：每个 page 都含 url、title、domain、visitCount、lastVisitedAt、score、reason（非空）、isOpen（布尔）、sources（数组）、scoreDetail（含 recency、frequency、open、domain、domainSource）
  - E5：issues/123 visitCount=8、isOpen=true、sources 含 open_tab 与 history；pull/456 isActive=true、isOpen=true、visitCount=5、sources 含 active_tab、lastVisitedAt=S1.body.syncedAt；Google isOpen=false、visitCount=1
  - E6：issues/123 的 lastVisitedAt=shiftedTime(url, T)，domain="github.com"；Fetch_API domain="developer.mozilla.org"
- 证据：evidence/TC-API-RANK-001/（api: S1、S2 响应）

### TC-API-RANK-002 limit=3：只返回前 3 名 issues/123、pull/456、Fetch_API，total 仍为 10
- 优先级：P0 ｜ 类别：positive ｜ 技术：equivalence
- 关联 Feature：F-RANK-01（AC2） ｜ 关联 Code：C-BE-RANK-05
- 前置条件：后端已 reset，没有任何规则
- 测试数据：样例 samplePayload({ now: T })，created=10、pageCount=10；读请求带 ?now=T
- 步骤：
  - S1：POST /api/sync 导入平移后的样例
  - S2：GET /api/pages/ranked?limit=3&now=T
- 预期：
  - E1：S2 返回 200，body.pages.length=3，body.total=10（total 为 limit 截断前数量）
  - E2：pages 的 url 依次为 issues/123、pull/456、Fetch_API，score 依次为 [1.00,0.94,0.83]
- 证据：evidence/TC-API-RANK-002/（api: S2 响应）

### TC-API-RANK-003 openOnly=true：只返回 4 个打开中的页面（activeTab + 3 个 openTabs），且全部 isOpen=true
- 优先级：P1 ｜ 类别：positive ｜ 技术：equivalence
- 关联 Feature：F-RANK-01（AC3） ｜ 关联 Code：C-BE-RANK-04、C-BE-RANK-05
- 前置条件：后端已 reset，没有任何规则
- 测试数据：样例 samplePayload({ now: T })，pageCount=10；打开中的页面 = pull/456（activeTab）+ issues/123、Fetch_API、docs.internal（3 个 openTabs）共 4 个；读请求带 ?now=T
- 步骤：
  - S1：POST /api/sync 导入平移后的样例
  - S2：GET /api/pages/ranked?openOnly=true&now=T
- 预期：
  - E1：S2 返回 200，body.total=4，body.pages.length=4
  - E2：pages 的 url 依次为 issues/123、pull/456、Fetch_API、docs.internal.com/ai-agent-design（按 score 降序）
  - E3：pages 每一项 isOpen=true，且不包含 useState 等未打开页面
- 证据：evidence/TC-API-RANK-003/（api: S2 响应）

### TC-API-RANK-004 domain=react.dev：只返回 useState 与 react.dev/learn 两个页面，按分数降序
- 优先级：P1 ｜ 类别：positive ｜ 技术：equivalence
- 关联 Feature：F-RANK-01（AC4） ｜ 关联 Code：C-BE-RANK-04、C-BE-RANK-05
- 前置条件：后端已 reset，没有任何规则
- 测试数据：样例 samplePayload({ now: T })，pageCount=10；react.dev 域名下恰好 2 个页面：useState（0.69）、learn（0.57）；读请求带 ?now=T
- 步骤：
  - S1：POST /api/sync 导入平移后的样例
  - S2：GET /api/pages/ranked?domain=react.dev&now=T
- 预期：
  - E1：S2 返回 200，body.total=2，body.pages.length=2
  - E2：pages 的 url 依次为 react.useState、react.dev/learn，每项 domain="react.dev"，score 依次为 [0.69,0.57]
- 证据：evidence/TC-API-RANK-004/（api: S2 响应）

### TC-API-RANK-005 后端数据为空：ranked 返回 200，pages=[]、total=0、domains=[]
- 优先级：P1 ｜ 类别：boundary ｜ 技术：boundary
- 关联 Feature：F-RANK-01（AC5） ｜ 关联 Code：C-BE-RANK-04、C-BE-RANK-05
- 前置条件：后端已 reset，不导入任何数据，没有任何规则
- 测试数据：空库（页面 0、规则 0）
- 步骤：
  - S1：GET /api/health
  - S2：GET /api/pages/ranked
- 预期：
  - E1：S1 返回 200，body.pageCount=0
  - E2：S2 返回 200，body.pages 深等于 []，body.total=0，body.domains 深等于 []
  - E3：S2 的 body.generatedAt 为正整数毫秒时间戳
- 证据：evidence/TC-API-RANK-005/（api: S2 响应）

### TC-API-RANK-006 limit 边界 1 与 500：分别返回 1 条与 10 条，total 恒为 10
- 优先级：P1 ｜ 类别：boundary ｜ 技术：boundary
- 关联 Feature：F-RANK-01（AC1） ｜ 关联 Code：C-BE-RANK-05
- 前置条件：后端已 reset，没有任何规则
- 测试数据：样例 samplePayload({ now: T })，pageCount=10；契约：limit 为 1–500 的整数；读请求带 ?now=T
- 步骤：
  - S1：POST /api/sync 导入平移后的样例
  - S2：GET /api/pages/ranked?limit=1&now=T
  - S3：GET /api/pages/ranked?limit=500&now=T
- 预期：
  - E1：S2 返回 200，body.pages.length=1，pages[0].url="https://github.com/org/repo/issues/123"，body.total=10
  - E2：S3 返回 200，body.pages.length=10，body.total=10
- 证据：evidence/TC-API-RANK-006/（api: S2、S3 响应）

### TC-API-RANK-007 非法查询参数（limit=0/501/1.5/abc/-1、openOnly=yes、now=abc）：统一 400 VALIDATION_FAILED 且无副作用
- 优先级：P1 ｜ 类别：negative ｜ 技术：equivalence
- 关联 Feature：F-RANK-01（AC1） ｜ 关联 Code：C-BE-RANK-05
- 前置条件：后端已 reset，没有任何规则
- 测试数据：样例 samplePayload({ now: T })，pageCount=10；非法入参等价类：limit 越界 0/501/-1、非整数 1.5、非数字 abc；openOnly 取 yes；now 取 abc（契约 errors）
- 步骤：
  - S1：POST /api/sync 导入平移后的样例
  - S2：依次请求 ?limit=0、?limit=501、?limit=-1、?limit=1.5、?limit=abc（都带 now=T）
  - S3：GET /api/pages/ranked?openOnly=yes&now=T
  - S4：GET /api/pages/ranked?limit=10&now=abc
  - S5：GET /api/pages/ranked?now=T；GET /api/health
- 预期：
  - E1：S2 的 5 次请求都返回 400，body.error.code="VALIDATION_FAILED"，message 非空，details.fields 包含 "limit"
  - E2：S3 返回 400，body.error.details.fields 包含 "openOnly"
  - E3：S4 返回 400，body.error.details.fields 包含 "now"
  - E4：S5 的 ranked 返回 200 且 body.total=10，health body.pageCount=10（非法请求没有副作用）
- 证据：evidence/TC-API-RANK-007/（api: S2–S4 的 7 个错误响应）

### TC-API-RANK-008 用不支持的方法 POST ranked：返回 405 METHOD_NOT_ALLOWED 且带 Allow 头，随后 GET 仍正常
- 优先级：P2 ｜ 类别：exception ｜ 技术：error-guessing
- 关联 Feature：F-RANK-01（AC1） ｜ 关联 Code：C-BE-RANK-05
- 前置条件：后端已 reset，没有任何规则
- 测试数据：样例 samplePayload({ now: T })，pageCount=10；契约 common.errorCodes：路径存在但方法不支持 → 405（带 Allow 头）
- 步骤：
  - S1：POST /api/sync 导入平移后的样例
  - S2：POST /api/pages/ranked，Content-Type: application/json，请求体 {}
  - S3：GET /api/pages/ranked?now=T
- 预期：
  - E1：S2 返回 405，body.error.code="METHOD_NOT_ALLOWED"，message 非空
  - E2：S2 的响应头 allow 包含 "GET"
  - E3：S3 返回 200，body.total=10、body.pages.length=10
- 证据：evidence/TC-API-RANK-008/（api: S2 响应含响应头）

### TC-API-RANK-009 domains 去重排序列表：按页面数降序、同数按字母序，且不受 domain/openOnly/limit 过滤影响
- 优先级：P1 ｜ 类别：positive ｜ 技术：decision-table
- 关联 Feature：F-RANK-01（AC1、AC4） ｜ 关联 Code：C-BE-RANK-04、C-BE-RANK-05
- 前置条件：后端已 reset，没有任何规则
- 测试数据：样例 samplePayload({ now: T })，pageCount=10；域名页面数 github.com=5、react.dev=2、developer.mozilla.org / docs.internal.com / google.com 各 1（domain 为小写 host 去掉 www.，同数按字母序）；契约 v1.1.0：domains 不受本次过滤影响、最多 50 个；读请求带 ?now=T
- 步骤：
  - S1：POST /api/sync 导入平移后的样例
  - S2：GET /api/pages/ranked?now=T
  - S3：GET /api/pages/ranked?domain=react.dev&openOnly=true&limit=1&now=T
- 预期：
  - E1：S2 的 body.domains 深等于 ["github.com","react.dev","developer.mozilla.org","docs.internal.com","google.com"]
  - E2：S3 的 body.pages 深等于 []、body.total=0（react.dev 两个页面都未打开），但 body.domains 仍等于 E1 的 5 个域名
  - E3：S2、S3 的 body.generatedAt 都等于 T
- 证据：evidence/TC-API-RANK-009/（api: S2、S3 响应）

### TC-API-RANK-010 domain 过滤的子域边界：react.dev 同时匹配 react.dev 与 sub.react.dev，不匹配只是后缀相同的 notreact.dev
- 优先级：P1 ｜ 类别：boundary ｜ 技术：boundary
- 关联 Feature：F-RANK-01（AC4） ｜ 关联 Code：C-BE-RANK-04、C-BE-RANK-05
- 前置条件：后端已 reset，没有任何规则
- 测试数据：T=Date.now()；activeTab=null、openTabs=[]，history 3 条（T−1 小时、visitCount=1）：https://react.dev/a、https://sub.react.dev/b、https://notreact.dev/c；契约：domain 过滤返回域名等于该值或为其子域的页面
- 步骤：
  - S1：POST /api/sync 导入 3 条 history
  - S2：GET /api/pages/ranked?domain=react.dev&limit=500&now=T
  - S3：GET /api/pages/ranked?domain=sub.react.dev&limit=500&now=T
  - S4：GET /api/pages/ranked?domain=notreact.dev&limit=500&now=T
- 预期：
  - E1：S1 返回 200，body.created=3、body.pageCount=3
  - E2：S2 的 body.total=2，url 集合为 {react.dev/a, sub.react.dev/b}，不含 notreact.dev/c
  - E3：S3 的 body.total=1，pages[0].url="https://sub.react.dev/b"
  - E4：S4 的 body.total=1，pages[0].url="https://notreact.dev/c"
- 证据：evidence/TC-API-RANK-010/（api: S2–S4 响应）

### TC-API-RANK-011 评分公式样例核对：8 个代表页面 score 分别为 1.00/0.94/0.83/0.69/0.57/0.56/0.23/0.11
- 优先级：P0 ｜ 类别：positive ｜ 技术：equivalence
- 关联 Feature：F-RANK-02（AC1） ｜ 关联 Code：C-BE-RANK-01、C-BE-CORE-07
- 前置条件：后端已 reset，没有任何规则
- 测试数据：样例 samplePayload({ now: T })，pageCount=10；期望分数取自 F-RANK-02 AC1 与 PRD 13.3；读请求带 ?now=T 固定时间
- 步骤：
  - S1：POST /api/sync 导入平移后的样例
  - S2：GET /api/pages/ranked?limit=500&now=T，按 url 建索引
- 预期：
  - E1：S2 返回 200
  - E2：issues/123 score=1.00，pull/456 score=0.94，Fetch_API score=0.83
  - E3：useState score=0.69，react.dev/learn score=0.57
  - E4：docs.internal.com/ai-agent-design score=0.56，issues/100 score=0.23，Google 搜索页 score=0.11
  - E5：每个 score 都是保留 2 位小数的数字（乘以 100 后为整数）
- 证据：evidence/TC-API-RANK-011/（api: S2 响应）

### TC-API-RANK-012 issues/100 的 scoreDetail：recency=0.09、frequency=0.32、open=0、domain=1.00、domainSource=affinity
- 优先级：P0 ｜ 类别：positive ｜ 技术：equivalence
- 关联 Feature：F-RANK-02（AC2） ｜ 关联 Code：C-BE-RANK-01、C-BE-CORE-07
- 前置条件：后端已 reset，没有任何规则
- 测试数据：样例 samplePayload({ now: T })；issues/100：24.31 天前访问、visitCount=1、未打开，github.com 是访问量最大的域名（5 个页面），域名分 5/5=1.00；frequency=ln(2)/ln(9)=0.32；读请求带 ?now=T
- 步骤：
  - S1：POST /api/sync 导入平移后的样例
  - S2：GET /api/pages/ranked?limit=500&now=T，取 issues/100 项
- 预期：
  - E1：该项 scoreDetail.recency=0.09
  - E2：scoreDetail.frequency=0.32、open=0、domain=1.00
  - E3：scoreDetail.domainSource="affinity"
- 证据：evidence/TC-API-RANK-012/（api: S2 响应）

### TC-API-RANK-013 全部 10 个页面：score∈[0,1]，且与 0.4r+0.3f+0.2o+0.1d 的差不超过 0.01，各分量也在 [0,1]
- 优先级：P0 ｜ 类别：positive ｜ 技术：equivalence
- 关联 Feature：F-RANK-02（AC3） ｜ 关联 Code：C-BE-RANK-01、C-BE-CORE-07
- 前置条件：后端已 reset，没有任何规则
- 测试数据：样例 samplePayload({ now: T })，pageCount=10；公式 D-05：score=0.4×recency+0.3×frequency+0.2×open+0.1×domain；读请求带 ?now=T
- 步骤：
  - S1：POST /api/sync 导入平移后的样例
  - S2：GET /api/pages/ranked?limit=500&now=T，逐项校验
- 预期：
  - E1：S2 返回 200，pages.length=10
  - E2：每个页面 0 ≤ score ≤ 1，且 0 ≤ recency、frequency、open、domain ≤ 1
  - E3：每个页面 |score − (0.4×recency + 0.3×frequency + 0.2×open + 0.1×domain)| ≤ 0.01
- 证据：evidence/TC-API-RANK-013/（api: S2 响应）

### TC-API-RANK-014 时效分量边界：1 分钟前访问 recency=1.00，50 天前访问 recency=0.01，分数随半衰期衰减且仍在 [0,1]
- 优先级：P1 ｜ 类别：boundary ｜ 技术：boundary
- 关联 Feature：F-RANK-02（AC3） ｜ 关联 Code：C-BE-RANK-01、C-BE-CORE-07
- 前置条件：后端已 reset，没有任何规则
- 测试数据：T=Date.now()；history 2 条（activeTab=null、openTabs=[]）：https://a.example/new（T−1 分钟，visitCount=10）、https://b.example/old（T−50 天，visitCount=1）；recency=0.5^(天/7)：1 分钟→1.00，50 天→0.007→0.01；frequency 分母=最大 visitCount=10：new=1.00，old=ln(2)/ln(11)=0.29；域名分 domain=domainVisits[域]/max(domainVisits)（D-05，域名访问量=Σ visitCount）：a.example=10、b.example=1 → new=1.00、old=0.10；score_old=0.4×0.0071+0.3×0.2891+0.1×0.10=0.0995→0.10；open 都为 0；读请求带 ?now=T
- 步骤：
  - S1：POST /api/sync 导入 2 条 history
  - S2：GET /api/pages/ranked?limit=500&now=T
- 预期：
  - E1：S1 返回 200，body.created=2
  - E2：new 项 scoreDetail.recency=1.00、frequency=1.00、open=0、domain=1.00，score=0.80
  - E3：old 项 scoreDetail.recency=0.01、frequency=0.29、domain=0.10，score=0.10
  - E4：pages[0] 为 a.example/new（0.80 在 0.10 之前），两项 score 都满足 0 ≤ score ≤ 1
- 证据：evidence/TC-API-RANK-014/（api: S2 响应）

### TC-API-RANK-015 未来时间戳（T+30 天）按现在处理：recency=1.00、score 不超过 1，lastVisitedAt 不超过 now+5 分钟
- 优先级：P1 ｜ 类别：negative ｜ 技术：error-guessing
- 关联 Feature：F-RANK-02（AC3） ｜ 关联 Code：C-BE-RANK-01、C-BE-CORE-07
- 前置条件：后端已 reset，没有任何规则
- 测试数据：T=Date.now()；history 1 条（activeTab=null、openTabs=[]）：https://example.com/future（lastVisitTime=T+30 天，visitCount=3）；D-01：客户端时间戳超过「现在 + 5 分钟」按「现在」处理，防止时效分量大于 1；读请求带 ?now=T
- 步骤：
  - S1：POST /api/sync 导入未来时间戳页面，记录 body.syncedAt
  - S2：GET /api/pages/ranked?limit=500&now=T
- 预期：
  - E1：S1 返回 200，body.created=1
  - E2：该页面 scoreDetail.recency=1.00、frequency=1.00、domain=1.00、open=0，score=0.80（无分量超过 1）
  - E3：lastVisitedAt ≤ T+300000（now+5 分钟），且与 S1.body.syncedAt 之差不超过 5000ms
  - E4：全部页面 0 ≤ score ≤ 1
- 证据：evidence/TC-API-RANK-015/（api: S1、S2 响应）

### TC-API-RANK-016 理由文案：issues/123 为完整三句，pull/456 以「正在浏览」开头
- 优先级：P0 ｜ 类别：positive ｜ 技术：equivalence
- 关联 Feature：F-RANK-03（AC1） ｜ 关联 Code：C-BE-RANK-03
- 前置条件：后端已 reset，没有任何规则
- 测试数据：样例 samplePayload({ now: T })，pageCount=10；理由文案与分句顺序取 PRD 6.3 / 13.3；读请求带 ?now=T
- 步骤：
  - S1：POST /api/sync 导入平移后的样例
  - S2：GET /api/pages/ranked?limit=500&now=T
- 预期：
  - E1：issues/123 的 reason 深等于「最近 3 天内多次访问（8 次），当前仍处于打开状态，常用域名 github.com」
  - E2：pull/456 的 reason 以「正在浏览」开头，且深等于「正在浏览，最近 3 天内多次访问（5 次），常用域名 github.com」
- 证据：evidence/TC-API-RANK-016/（api: S2 响应）

### TC-API-RANK-017 旧页面理由：issues/100 含「已 24 天未访问」，Google 搜索页含「已 35 天未访问」
- 优先级：P1 ｜ 类别：positive ｜ 技术：equivalence
- 关联 Feature：F-RANK-03（AC2） ｜ 关联 Code：C-BE-RANK-03
- 前置条件：后端已 reset，没有任何规则
- 测试数据：样例 samplePayload({ now: T })；issues/100 距 T 24.31 天→整天 24，Google 35.88 天→整天 35（D-20 向下取整）；读请求带 ?now=T
- 步骤：
  - S1：POST /api/sync 导入平移后的样例
  - S2：GET /api/pages/ranked?limit=500&now=T
- 预期：
  - E1：issues/100 的 reason 深等于「已 24 天未访问，常用域名 github.com」
  - E2：Google 搜索页的 reason 深等于「已 35 天未访问」（域名亲和分 0.05 不足 0.6，不追加域名句）
- 证据：evidence/TC-API-RANK-017/（api: S2 响应）

### TC-API-RANK-018 全部 10 个页面：reason 非空且按「，」分隔不超过 3 句
- 优先级：P1 ｜ 类别：positive ｜ 技术：equivalence
- 关联 Feature：F-RANK-03（AC3） ｜ 关联 Code：C-BE-RANK-03
- 前置条件：后端已 reset，没有任何规则
- 测试数据：样例 samplePayload({ now: T })，pageCount=10；D-23：按条件顺序最多取 3 句，用「，」连接；读请求带 ?now=T
- 步骤：
  - S1：POST /api/sync 导入平移后的样例
  - S2：GET /api/pages/ranked?limit=500&now=T
- 预期：
  - E1：10 个页面 reason 均为非空字符串（trim 后长度 ≥ 4）
  - E2：每个 reason.split(「，」).length 满足 1 ≤ 句数 ≤ 3
  - E3：issues/123 与 pull/456 的 reason 均恰好为 3 句，Google 搜索页恰好为 1 句
- 证据：evidence/TC-API-RANK-018/（api: S2 响应）

### TC-API-RANK-019 关闭全部标签页后再次同步：isOpen 刷新为 false，理由不再出现「正在浏览 / 当前仍处于打开状态」
- 优先级：P1 ｜ 类别：negative ｜ 技术：state-transition
- 关联 Feature：F-RANK-03（AC1、AC3） ｜ 关联 Code：C-BE-RANK-03
- 前置条件：后端已 reset，没有任何规则
- 测试数据：T=Date.now()；两次同步都用 samplePayload({ now: T })（history 时间戳相同），第 2 次 transform 置 activeTab=null、openTabs=[]（D-04 快照语义）；读请求带 ?now=T
- 步骤：
  - S1：POST /api/sync 第 1 次导入样例（activeTab + 3 个 openTabs）
  - S2：POST /api/sync 第 2 次导入，activeTab=null、openTabs=[]，history 不变
  - S3：GET /api/pages/ranked?limit=500&now=T
- 预期：
  - E1：S2 返回 200，body.received=10、body.created=0、body.updated=10（页面仍是 10 个，visitCount 不累加）
  - E2：pull/456、issues/123、Fetch_API、docs.internal 四项 isOpen=false，pull/456 isActive=false
  - E3：issues/123 的 reason 深等于「最近 3 天内多次访问（8 次），常用域名 github.com」；pull/456 的 reason 不再以「正在浏览」开头
  - E4：全部 10 个 reason 都不包含「当前仍处于打开状态」，且每条不超过 3 句
- 证据：evidence/TC-API-RANK-019/（api: S2、S3 响应）

### TC-API-RANK-020 理由首句的时段边界：20 小时→今天访问过、2 天→最近 3 天内访问、3 天 1 小时→3 天前访问、13 天→13 天前访问、14 天→已 14 天未访问
- 优先级：P1 ｜ 类别：boundary ｜ 技术：boundary
- 关联 Feature：F-RANK-03（AC2、AC3） ｜ 关联 Code：C-BE-RANK-03
- 前置条件：后端已 reset，没有任何规则
- 测试数据：T=Date.now()；5 条 history（activeTab=null、openTabs=[]，visitCount=1、未打开）：example.com/p0…p4，lastVisitTime 分别为 T−20 小时、T−2 天、T−3 天−1 小时、T−13 天、T−14 天；D-20 向下取整（0/2/3/13/14），归档阈值 14 天；5 个页面同域名，域名分 1.00 会追加「常用域名 example.com」；读请求带 ?now=T
- 步骤：
  - S1：POST /api/sync 导入 5 条 history
  - S2：GET /api/pages/ranked?limit=500&now=T，按 path 取各项 reason 第 1 句
- 预期：
  - E1：/p0（20 小时）reason 第 1 句为「今天访问过」
  - E2：/p1（2 天）第 1 句为「最近 3 天内访问」；/p2（3 天 1 小时）第 1 句为「3 天前访问」
  - E3：/p3（13 天）第 1 句为「13 天前访问」；/p4（14 天）第 1 句为「已 14 天未访问」（整天数 ≥ 阈值 14）
  - E4：每条 reason 不超过 3 句，且都以「，常用域名 example.com」结尾
- 证据：evidence/TC-API-RANK-020/（api: S2 响应）

### TC-API-RANK-021 保存 never_archive（docs.internal.com）后域名分 0.10→1.00、score 0.56→0.65、名次 8→7；删除规则后恢复
- 优先级：P0 ｜ 类别：positive ｜ 技术：state-transition
- 关联 Feature：F-RANK-04（AC1、AC2） ｜ 关联 Code：C-BE-RANK-02、C-BE-RANK-03、C-BE-CORE-13
- 前置条件：后端已 reset，没有任何规则
- 测试数据：样例 samplePayload({ now: T })，pageCount=10；规则 { rawText:"docs.internal.com 的页面永远不要归档", type:"never_archive", domain:"docs.internal.com", action:"keep" }；PRD 13.3：保存后 domain 0.10→1.00、score 0.56→0.65、第 8 升第 7；删除后恢复；读请求带 ?now=T
- 步骤：
  - S1：POST /api/sync 导入平移后的样例
  - S2：GET /api/pages/ranked?limit=500&now=T，记录 docs.internal 页面基线
  - S3：POST /api/rules 保存 never_archive 规则，记录 rules[0].id 为 ID
  - S4：GET /api/pages/ranked?limit=500&now=T
  - S5：DELETE /api/rules/<ID>
  - S6：GET /api/pages/ranked?limit=500&now=T
- 预期：
  - E1：S2 中该页面 score=0.56、scoreDetail.domain=0.10、domainSource="affinity"，下标为 7（第 8 名）
  - E2：S3 返回 201，body.ruleCount=1，ID 为非空字符串，rules[0].enabled=true
  - E3：S4 中该页面 scoreDetail.domain=1.00、domainSource="protected"、score=0.65，下标为 6（第 7 名）；第 8 名为 react.dev/learn（0.57）
  - E4：S4 中该页面 reason 深等于「6 天前访问，当前仍处于打开状态，属于受保护域名」
  - E5：S5 返回 200，body.deleted=ID、body.ruleCount=0
  - E6：S6 中该页面 score 恢复为 0.56、domain=0.10、domainSource="affinity"、下标为 7，reason 深等于「6 天前访问，当前仍处于打开状态」，不包含「属于受保护域名」
- 证据：evidence/TC-API-RANK-021/（api: S2–S6 响应）

### TC-API-RANK-022 保存 boost_domain（react.dev）后两个 react 页面域名分=1.00、理由含「命中优先域名规则」，score 升到 0.75/0.63
- 优先级：P0 ｜ 类别：positive ｜ 技术：equivalence
- 关联 Feature：F-RANK-04（AC3） ｜ 关联 Code：C-BE-RANK-02、C-BE-RANK-03、C-BE-CORE-13
- 前置条件：后端已 reset，没有任何规则
- 测试数据：样例 samplePayload({ now: T })，pageCount=10；规则 { rawText:"react.dev 优先显示", type:"boost_domain", domain:"react.dev", action:"boost" }（PRD 6.6）；公式 D-05：useState 0.4×0.95+0.3×0.89+0.1=0.75，learn 0.4×0.95+0.3×0.50+0.1=0.63；读请求带 ?now=T
- 步骤：
  - S1：POST /api/sync 导入平移后的样例
  - S2：POST /api/rules 保存 boost_domain 规则
  - S3：GET /api/pages/ranked?domain=react.dev&limit=500&now=T
  - S4：GET /api/pages/ranked?limit=500&now=T，取非 react.dev 页面
- 预期：
  - E1：S2 返回 201，body.ruleCount=1，rules[0].type="boost_domain"、enabled=true
  - E2：S3 两个页面 scoreDetail.domain=1.00、domainSource="boost"，score 分别为 useState=0.75、learn=0.63
  - E3：S3 两个页面 reason 都包含「命中优先域名规则」
  - E4：S4 中 issues/123=1.00、pull/456=0.94、Fetch_API=0.83、Google=0.11（非 react.dev 页面分数不变），Google domainSource="affinity"
- 证据：evidence/TC-API-RANK-022/（api: S2–S4 响应）

### TC-API-RANK-023 enabled=false 的 never_archive 规则不影响排序：docs 页仍为 0.56、域名分 0.10、理由无受保护句
- 优先级：P1 ｜ 类别：negative ｜ 技术：equivalence
- 关联 Feature：F-RANK-04（AC1） ｜ 关联 Code：C-BE-RANK-02、C-BE-CORE-13
- 前置条件：后端已 reset，没有任何规则
- 测试数据：样例 samplePayload({ now: T })，pageCount=10；规则带 enabled:false（契约 rules[].enabled 可选）：never_archive(domain=docs.internal.com, action=keep, enabled=false)；读请求带 ?now=T
- 步骤：
  - S1：POST /api/sync 导入平移后的样例
  - S2：POST /api/rules 保存 enabled=false 的规则
  - S3：GET /api/pages/ranked?limit=500&now=T，取 docs.internal 页面
- 预期：
  - E1：S2 返回 201，body.rules[0].enabled=false、body.ruleCount=1（规则已保存但停用）
  - E2：S3 中该页面 score=0.56、scoreDetail.domain=0.10、domainSource="affinity"，下标为 7（第 8 名）
  - E3：reason 深等于「6 天前访问，当前仍处于打开状态」，不包含「属于受保护域名」
- 证据：evidence/TC-API-RANK-023/（api: S2、S3 响应）

### TC-API-RANK-024 规则域名匹配边界：react.dev 规则加权 sub.react.dev 子域，但不加权只是后缀相同的 notreact.dev
- 优先级：P1 ｜ 类别：boundary ｜ 技术：boundary
- 关联 Feature：F-RANK-04（AC3） ｜ 关联 Code：C-BE-RANK-02、C-BE-CORE-13
- 前置条件：后端已 reset，没有任何规则
- 测试数据：T=Date.now()；6 条 history（T−1 小时、visitCount=1、openTabs=[]）：react.dev/a、sub.react.dev/b、notreact.dev/c、example.com/p1、p2、p3；域名页面数 example.com=3（最大），其余各 1，小域名亲和分=1/3≈0.33；规则 boost_domain(domain=react.dev, action=boost)，匹配口径：域名等于规则域名或以「.规则域名」结尾；读请求带 ?now=T
- 步骤：
  - S1：POST /api/sync 导入 6 条 history
  - S2：GET /api/pages/ranked?limit=500&now=T，记录规则前域名分
  - S3：POST /api/rules 保存 boost_domain(react.dev) 规则
  - S4：GET /api/pages/ranked?limit=500&now=T
- 预期：
  - E1：S1 返回 200，body.created=6
  - E2：S2 中 react.dev/a、sub.react.dev/b、notreact.dev/c 三项 scoreDetail.domain 都为 0.33、domainSource="affinity"；example.com 三项 domain=1.00
  - E3：S4 中 react.dev/a 与 sub.react.dev/b 的 domain=1.00、domainSource="boost"，reason 包含「命中优先域名规则」
  - E4：S4 中 notreact.dev/c 的 domain 仍为 0.33、domainSource="affinity"，reason 不含「命中优先域名规则」；example.com 三项 domainSource 仍为 "affinity"
- 证据：evidence/TC-API-RANK-024/（api: S2、S4 响应）

## Feature → Case 覆盖表

| Feature | AC | 覆盖用例 | 类别分布（正 / 反 / 边 / 异 / 其他） | waiver |
|---|---|---|---|---|
| F-RANK-01 | AC1、AC2、AC3、AC4、AC5 | TC-API-RANK-001、TC-API-RANK-002、TC-API-RANK-003、TC-API-RANK-004、TC-API-RANK-005、TC-API-RANK-006、TC-API-RANK-007、TC-API-RANK-008、TC-API-RANK-009、TC-API-RANK-010 | 5 / 1 / 3 / 1 / 0 | — |
| F-RANK-02 | AC1、AC2、AC3 | TC-API-RANK-011、TC-API-RANK-012、TC-API-RANK-013、TC-API-RANK-014、TC-API-RANK-015 | 3 / 1 / 1 / 0 / 0 | exception（纯派生计算无外部资源，接口异常在 F-RANK-01 覆盖） |
| F-RANK-03 | AC1、AC2、AC3 | TC-API-RANK-016、TC-API-RANK-017、TC-API-RANK-018、TC-API-RANK-019、TC-API-RANK-020 | 3 / 1 / 1 / 0 / 0 | — |
| F-RANK-04 | AC1、AC2、AC3 | TC-API-RANK-021、TC-API-RANK-022、TC-API-RANK-023、TC-API-RANK-024 | 2 / 1 / 1 / 0 / 0 | — |

## 类别分布统计

| 模块 | positive | negative | boundary | exception | state | security | performance | compatibility | 合计 |
|---|---|---|---|---|---|---|---|---|---|
| RANK | 13 | 4 | 6 | 1 | 0 | 0 | 0 | 0 | 24 |

（统计口径与 `check-cases.mjs --json` 的 stats 一致：按用例的主类别 category 计数。F-RANK-05 为 FE-only display Feature，由 UI 分片覆盖，不在本分片。）
