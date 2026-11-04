# 接口用例：PERSIST

执行约定：PERSIST 用例需要「重启后端」，因此每条用例在自己的临时目录里启动独立的后端子进程（空闲端口、独立 SNAPSHOT_FILE），不依赖 webServer 后端，也不调用 reset；数据仍通过真实的 `POST /api/sync` / `POST /api/rules` 构造；样例按 D-01 平移（最新一条 = 导入时刻 − 5 分钟）。

## PERSIST 后端持久化（后端接口）

### TC-API-PERSIST-001 配置快照文件：导入样例并保存 2 条规则，等待 2 秒后强杀重启，health 仍为 pageCount=10、ruleCount=2
- 优先级：P1 ｜ 类别：positive ｜ 技术：scenario
- 关联 Feature：F-PERSIST-01（AC1） ｜ 关联 Code：C-BE-PERSIST-01、C-BE-PERSIST-02
- 前置条件：用例自行启动独立后端子进程：node server/src/index.js，环境变量 PORT=<用 net.listen(0) 取得的空闲端口>、HOST=127.0.0.1、SNAPSHOT_FILE=<本用例临时目录>/snapshot.json、LOG_FILE=evidence/<CaseID>/server-persist.log，不设置 ENABLE_TEST_API（避免 reset 写空快照）；以 GET /api/health 返回 200 作为就绪；用例结束时 SIGTERM 结束子进程并删除临时目录（不使用 webServer 后端）
- 测试数据：样例：tests/fixtures/sample.mjs 的 samplePayload({ now: T })，T 为用例开始时取的 Date.now()（D-01：最新一条 = T − 5 分钟），经 POST /api/sync 导入：received=14、created=10、pageCount=10（PRD 13.2）；规则①（7 天 issue 归档）：{ rawText:"把 7 天没访问过的 GitHub issue 建议归档", type:"archive_candidate", domain:"github.com", urlPattern:"/issues/", inactiveDays:7, action:"suggest_archive" }；规则②（docs.internal 保护）：{ rawText:"docs.internal.com 的页面永远不要归档", type:"never_archive", domain:"docs.internal.com", action:"keep" }；写入防抖 SNAPSHOT_DEBOUNCE_MS=1000，等待 2 秒确保防抖写入已落盘；用 SIGKILL 结束进程，证明数据来自防抖写入而不是退出时的 flush
- 步骤：
  - S1：启动子进程 A，GET /api/health
  - S2：向 A POST /api/sync 导入平移后的样例
  - S3：向 A POST /api/rules，请求体 { rules: [规则①, 规则②] }，记录返回的 2 个 id
  - S4：等待 2000 ms，读取快照目录
  - S5：对 A 发送 SIGKILL 并等待退出；以相同 SNAPSHOT_FILE 启动子进程 B
  - S6：向 B GET /api/health；GET /api/rules
  - S7：向 B GET /api/pages/cleanup-suggestions?now=T
- 预期：
  - E1：S1 的 body.persistence="snapshot"，body.pageCount=0
  - E2：S4 时 snapshot.json 存在且能被 JSON.parse，schemaVersion=1；目录中没有 *.tmp 文件
  - E3：S6 health 返回 200，body.status="ok"、body.pageCount=10、body.ruleCount=2
  - E4：S6 GET /api/rules 返回的规则 id 集合等于 S3 返回的 2 个 id
  - E5：S7 的 body.summary 深等于 { archive: 2, merge: 1, keep: 1 }
- 证据：evidence/TC-API-PERSIST-001/（api: S6、S7 响应；server-persist.log（两次启动））

### TC-API-PERSIST-002 正式快照完整、另残留写了一半的 tmp 文件：启动加载完整快照（pageCount=10），tmp 被删除
- 优先级：P1 ｜ 类别：exception ｜ 技术：error-guessing
- 关联 Feature：F-PERSIST-01（AC2） ｜ 关联 Code：C-BE-PERSIST-02、C-BE-PERSIST-01
- 前置条件：用例自行启动独立后端子进程：node server/src/index.js，环境变量 PORT=<用 net.listen(0) 取得的空闲端口>、HOST=127.0.0.1、SNAPSHOT_FILE=<本用例临时目录>/snapshot.json、LOG_FILE=evidence/<CaseID>/server-persist.log，不设置 ENABLE_TEST_API（避免 reset 写空快照）；以 GET /api/health 返回 200 作为就绪；用例结束时 SIGTERM 结束子进程并删除临时目录（不使用 webServer 后端）
- 测试数据：样例：tests/fixtures/sample.mjs 的 samplePayload({ now: T })，T 为用例开始时取的 Date.now()（D-01：最新一条 = T − 5 分钟），经 POST /api/sync 导入：received=14、created=10、pageCount=10（PRD 13.2）；半截临时文件：在快照目录写 snapshot.json.99999.tmp，内容为截断的 JSON 文本 {"schemaVersion":1,"pages":[{"url":"https://half（模拟写到一半崩溃，命名与写入器 <file>.<pid>.tmp 一致）
- 步骤：
  - S1：启动子进程 A，POST /api/sync 导入平移后的样例
  - S2：等待 2000 ms 后对 A 发送 SIGTERM 并等待退出
  - S3：在快照目录写入半截 tmp 文件 snapshot.json.99999.tmp
  - S4：以相同 SNAPSHOT_FILE 启动子进程 B，GET /api/health
  - S5：读取快照目录
- 预期：
  - E1：S2 中子进程 A 退出码为 0
  - E2：S4 返回 200，body.status="ok"、body.pageCount=10
  - E3：S5 时 snapshot.json.99999.tmp 已不存在，snapshot.json 仍能被 JSON.parse
- 证据：evidence/TC-API-PERSIST-002/（api: S4 响应；server-persist.log）

### TC-API-PERSIST-003 快照目录只残留半截 tmp、没有正式快照：后端以空数据启动，status="ok"、pageCount=0，tmp 被删除
- 优先级：P1 ｜ 类别：exception ｜ 技术：error-guessing
- 关联 Feature：F-PERSIST-01（AC2） ｜ 关联 Code：C-BE-PERSIST-02
- 前置条件：用例自行启动独立后端子进程：node server/src/index.js，环境变量 PORT=<用 net.listen(0) 取得的空闲端口>、HOST=127.0.0.1、SNAPSHOT_FILE=<本用例临时目录>/snapshot.json、LOG_FILE=evidence/<CaseID>/server-persist.log，不设置 ENABLE_TEST_API（避免 reset 写空快照）；以 GET /api/health 返回 200 作为就绪；用例结束时 SIGTERM 结束子进程并删除临时目录（不使用 webServer 后端）
- 测试数据：新建空临时目录，只写 snapshot.json.99999.tmp（内容 {"schemaVersion":1,"pages":[），不存在 snapshot.json
- 步骤：
  - S1：在快照目录写入半截 tmp 文件
  - S2：启动子进程，GET /api/health
  - S3：读取快照目录；再次 GET /api/health
- 预期：
  - E1：S2 返回 200，body.status="ok"、body.pageCount=0、body.ruleCount=0、body.persistence="snapshot"
  - E2：S3 时 snapshot.json.99999.tmp 已不存在
  - E3：S3 的 health 仍返回 200（进程没有崩溃）
- 证据：evidence/TC-API-PERSIST-003/（api: S2 响应；server-persist.log）

### TC-API-PERSIST-004 正式快照文件损坏（非法 JSON）：后端不崩溃，以空数据启动并记 warn 日志
- 优先级：P2 ｜ 类别：exception ｜ 技术：error-guessing
- 关联 Feature：F-PERSIST-01（AC2） ｜ 关联 Code：C-BE-PERSIST-02
- 前置条件：用例自行启动独立后端子进程：node server/src/index.js，环境变量 PORT=<用 net.listen(0) 取得的空闲端口>、HOST=127.0.0.1、SNAPSHOT_FILE=<本用例临时目录>/snapshot.json、LOG_FILE=evidence/<CaseID>/server-persist.log，不设置 ENABLE_TEST_API（避免 reset 写空快照）；以 GET /api/health 返回 200 作为就绪；用例结束时 SIGTERM 结束子进程并删除临时目录（不使用 webServer 后端）
- 测试数据：新建空临时目录，写 snapshot.json，内容为截断的 JSON 文本 {"schemaVersion":1,"pages":[{"url"
- 步骤：
  - S1：写入损坏的 snapshot.json
  - S2：启动子进程，GET /api/health
  - S3：POST /api/sync 导入 1 条 history { url:"https://example.com/after-corrupt", lastVisitTime: Date.now() − 1 小时 }；GET /api/health
  - S4：读取 server-persist.log
- 预期：
  - E1：S2 返回 200，body.status="ok"、body.pageCount=0
  - E2：S3 的 sync 返回 200，health body.pageCount=1（损坏后仍可正常写入）
  - E3：S4 的日志中至少有 1 行 level="warn" 且与快照加载相关（含 snapshot 字样）
- 证据：evidence/TC-API-PERSIST-004/（server-persist.log）

### TC-API-PERSIST-005 防抖窗口内（写入后 100 ms）SIGTERM 退出：退出前 flush，重启后 pageCount=10
- 优先级：P2 ｜ 类别：boundary ｜ 技术：boundary
- 关联 Feature：F-PERSIST-01（AC1） ｜ 关联 Code：C-BE-PERSIST-01、C-BE-PERSIST-02
- 前置条件：用例自行启动独立后端子进程：node server/src/index.js，环境变量 PORT=<用 net.listen(0) 取得的空闲端口>、HOST=127.0.0.1、SNAPSHOT_FILE=<本用例临时目录>/snapshot.json、LOG_FILE=evidence/<CaseID>/server-persist.log，不设置 ENABLE_TEST_API（避免 reset 写空快照）；以 GET /api/health 返回 200 作为就绪；用例结束时 SIGTERM 结束子进程并删除临时目录（不使用 webServer 后端）
- 测试数据：样例：tests/fixtures/sample.mjs 的 samplePayload({ now: T })，T 为用例开始时取的 Date.now()（D-01：最新一条 = T − 5 分钟），经 POST /api/sync 导入：received=14、created=10、pageCount=10（PRD 13.2）；写入后 100 ms（< 防抖 1000 ms）即发送 SIGTERM；技术方案 3.5：配置了 SNAPSHOT_FILE 时退出前调用 flushSnapshotSync()
- 步骤：
  - S1：启动子进程 A，POST /api/sync 导入平移后的样例
  - S2：100 ms 后对 A 发送 SIGTERM 并等待退出
  - S3：以相同 SNAPSHOT_FILE 启动子进程 B，GET /api/health
- 预期：
  - E1：S2 中子进程 A 在 3 秒内退出，退出码为 0
  - E2：S3 返回 200，body.pageCount=10
- 证据：evidence/TC-API-PERSIST-005/（api: S3 响应；server-persist.log）

### TC-API-PERSIST-006 未配置快照文件时只用内存：persistence="memory"，重启后 pageCount 归 0
- 优先级：P2 ｜ 类别：positive ｜ 技术：equivalence
- 关联 Feature：F-PERSIST-01（AC1） ｜ 关联 Code：C-BE-PERSIST-02
- 前置条件：用例自行启动独立后端子进程：node server/src/index.js，PORT=<空闲端口>、HOST=127.0.0.1，不设置 SNAPSHOT_FILE 和 ENABLE_TEST_API；cwd 设为本用例临时目录以确认不落盘
- 测试数据：样例：tests/fixtures/sample.mjs 的 samplePayload({ now: T })，T 为用例开始时取的 Date.now()（D-01：最新一条 = T − 5 分钟），经 POST /api/sync 导入：received=14、created=10、pageCount=10（PRD 13.2）
- 步骤：
  - S1：启动子进程 A，GET /api/health
  - S2：向 A POST /api/sync 导入平移后的样例，等待 2000 ms
  - S3：对 A 发送 SIGTERM 并等待退出；以相同环境启动子进程 B，GET /api/health
- 预期：
  - E1：S1 的 body.persistence="memory"
  - E2：S2 的 sync 返回 200，body.pageCount=10
  - E3：S3 的 body.pageCount=0，body.persistence="memory"
- 证据：evidence/TC-API-PERSIST-006/（api: S1、S3 响应）

## Feature → Case 覆盖表

| Feature | AC | 覆盖用例 | 类别分布（正 / 反 / 边 / 异 / 其他） | waiver |
|---|---|---|---|---|
| F-PERSIST-01 | AC1、AC2 | TC-API-PERSIST-001、TC-API-PERSIST-002、TC-API-PERSIST-003、TC-API-PERSIST-004、TC-API-PERSIST-005、TC-API-PERSIST-006 | 2 / 0 / 1 / 3 / 0 | — |

## 类别分布统计

| 模块 | positive | negative | boundary | exception | state | security | performance | compatibility | 合计 |
|---|---|---|---|---|---|---|---|---|---|
| PERSIST | 2 | 0 | 1 | 3 | 0 | 0 | 0 | 0 | 6 |

（统计口径与 `check-cases.mjs --json` 的 stats 一致：按用例的主类别 category 计数。）
