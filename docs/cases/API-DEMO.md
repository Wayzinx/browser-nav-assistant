# 接口用例分片：DEMO（启动与样例导入）

> 本文件是 DEMO 模块 type=API 用例的分片，与 `docs/trace/cases/API-DEMO.json` 一一对应；脚本类用例以子进程执行 scripts/start.sh、scripts/import-sample.mjs，再用真实 HTTP 断言。

执行约定：每条用例前测试夹具自动调用 `POST /api/__test__/reset` 隔离状态；数据一律通过真实的 `POST /api/sync` / `POST /api/rules` / `PUT /api/config` 构造；样例按 D-01 平移（最新一条 = 导入时刻 − 5 分钟）。后端生成的 id 一律取响应值，不写死。

### TC-API-DEMO-001 PORT=4120 执行 ./scripts/start.sh：4120 端口 health 返回 200，终端打印 status=ok
- 优先级：P0 ｜ 类别：positive ｜ 技术：scenario
- 关联 Feature：F-DEMO-01（AC1、AC2） ｜ 关联 Code：C-BE-DEMO-01、C-BE-CORE-15、C-BE-CORE-01
- 前置条件：项目根目录已执行 npm install（如需要），Node.js ≥ 20 可用；测试进程以子进程方式运行脚本（child_process.spawn，cwd=项目根目录），stdout / stderr 全量写入 evidence/<CaseID>/；端口 4120 空闲（与 TEST_PORT 和 §9 端口表不冲突）
- 测试数据：环境变量 PORT=4120、SNAPSHOT_FILE=evidence/TC-API-DEMO-001/snapshot.json（避免写入 data/）；等待上限 15 秒
- 步骤：
  - S1：spawn ./scripts/start.sh，env 追加 PORT=4120，收集 stdout
  - S2：轮询 stdout，直到出现包含 "status" 的 JSON 行或 15 秒超时
  - S3：GET http://127.0.0.1:4120/api/health
  - S4：向子进程发送 SIGTERM，等待退出
- 预期：
  - E1：S2 在 15 秒内 stdout 中出现可 JSON.parse 的 health 输出，其 status="ok"、version="1.0.0"
  - E2：S3 返回 200，body.status="ok"
  - E3：S4 后子进程在 5 秒内退出，且 4120 端口不再响应
- 证据：evidence/TC-API-DEMO-001/（stdout: start.sh 输出；api: S3 响应）

### TC-API-DEMO-002 不设置 PORT 执行 ./scripts/start.sh：默认监听 3000 并打印 health
- 优先级：P1 ｜ 类别：positive ｜ 技术：equivalence
- 关联 Feature：F-DEMO-01（AC1） ｜ 关联 Code：C-BE-DEMO-01、C-BE-CORE-01
- 前置条件：项目根目录已执行 npm install（如需要），Node.js ≥ 20 可用；测试进程以子进程方式运行脚本（child_process.spawn，cwd=项目根目录），stdout / stderr 全量写入 evidence/<CaseID>/；端口 3000 空闲；若被占用则 test.skip 并在 result.json 记录原因（不能停掉他人进程）
- 测试数据：env 中删除 PORT；SNAPSHOT_FILE=evidence/TC-API-DEMO-002/snapshot.json；等待上限 15 秒
- 步骤：
  - S1：spawn ./scripts/start.sh（env 不含 PORT），收集 stdout
  - S2：等待 stdout 出现 health 输出或 15 秒超时
  - S3：GET http://127.0.0.1:3000/api/health
  - S4：发送 SIGTERM，等待退出
- 预期：
  - E1：S2 在 15 秒内 stdout 中出现 health 输出，status="ok"
  - E2：S3 返回 200，body.status="ok"，body.version="1.0.0"
  - E3：S4 后子进程在 5 秒内退出
- 证据：evidence/TC-API-DEMO-002/（stdout: start.sh 输出；api: S3 响应）

### TC-API-DEMO-003 端口已被占用时 ./scripts/start.sh 以退出码 1 结束并提示换 PORT
- 优先级：P1 ｜ 类别：exception ｜ 技术：error-guessing
- 关联 Feature：F-DEMO-01（AC2） ｜ 关联 Code：C-BE-DEMO-01、C-BE-CORE-01、C-BE-CORE-15
- 前置条件：项目根目录已执行 npm install（如需要），Node.js ≥ 20 可用；测试进程以子进程方式运行脚本（child_process.spawn，cwd=项目根目录），stdout / stderr 全量写入 evidence/<CaseID>/；Playwright webServer 启动的测试后端（原服务）正在 127.0.0.1:TEST_PORT 监听，即被占用的端口
- 测试数据：被占用端口=TEST_PORT（由正在运行的测试后端占用，不另起占位 server）；以 PORT=TEST_PORT、SNAPSHOT_FILE=evidence/TC-API-DEMO-003/snapshot.json、LOG_FILE=共享后端日志执行 start.sh；等待上限 15 秒
- 步骤：
  - S1：GET /api/health（原服务，TEST_PORT），确认端口被占用并记录 startedAt
  - S2：spawn ./scripts/start.sh，env 追加 PORT=TEST_PORT，收集 stdout + stderr
  - S3：等待子进程退出（上限 15 秒）
  - S4：再次 GET /api/health（同一原服务）
- 预期：
  - E1：S3 中子进程在 15 秒内退出，退出码=1
  - E2：stdout + stderr 合并文本包含「已被占用」和「PORT=」
  - E3：S4 返回 200，body.status="ok"，body.startedAt 与 S1 相同（原服务未被替换或中断）
- 证据：evidence/TC-API-DEMO-003/（stdout/stderr: start.sh 输出、退出码；api: S4 响应；server.log: 原服务日志）
- 仲裁说明：原设计用不响应 HTTP 的 net 占位 server 占端口，没有被测调用、也没有后端日志，不满足 AGENTS.md 约定 3 的留痕要求（api/ 返回值 + server.log），而校验器没有豁免机制。现在改由已在运行的后端实例占端口，这正是端口冲突的真实场景，并补充 E3 验证 start.sh 失败不影响原服务。

### TC-API-DEMO-004 执行样例导入脚本后 health.pageCount=10，样例文件与 resource.json 完全一致
- 优先级：P0 ｜ 类别：positive ｜ 技术：scenario
- 关联 Feature：F-DEMO-02（AC1） ｜ 关联 Code：C-BE-DEMO-02、C-BE-DEMO-03
- 前置条件：后端以 ENABLE_TEST_API=1 启动（playwright webServer，端口 TEST_PORT，LOG_FILE=evidence/_runtime/server-<port>.log），未配置 SNAPSHOT_FILE；测试夹具已调用 POST /api/__test__/reset，配置恢复默认（privacySensitiveKeywords=["password","token","bank","secret"]，enablePrivacyFilter=true）；导入脚本通过环境变量 API_BASE 指向测试后端（缺省 http://127.0.0.1:3000）
- 测试数据：resources/sample-history.json 应与 resource.json 深度相等（activeTab 1 + openTabs 3 + history 10 = 14 条，去重后 10 个页面，PRD 第 13 章）
- 步骤：
  - S1：POST /api/__test__/reset
  - S2：读取 resources/sample-history.json 与 resource.json 并 JSON.parse
  - S3：spawn node scripts/import-sample.mjs，env API_BASE=http://127.0.0.1:<TEST_PORT>，等待退出（上限 15 秒）
  - S4：GET /api/health
- 预期：
  - E1：S2 两个对象深度相等（activeTab.url="https://github.com/org/repo/pull/456"，openTabs 3 条，history 10 条）
  - E2：S3 退出码=0
  - E3：S4 返回 200，body.pageCount=10，body.lastSyncAt 为数字（说明走了真实 POST /api/sync）
- 证据：evidence/TC-API-DEMO-004/（stdout: 导入脚本输出；api: S4 响应）

### TC-API-DEMO-005 样例导入后整理建议 archive 含 issues/100（ageDays=24）和 Google 搜索页（ageDays=35）
- 优先级：P0 ｜ 类别：positive ｜ 技术：scenario
- 关联 Feature：F-DEMO-02（AC2） ｜ 关联 Code：C-BE-DEMO-03、C-BE-DEMO-02
- 前置条件：后端以 ENABLE_TEST_API=1 启动（playwright webServer，端口 TEST_PORT，LOG_FILE=evidence/_runtime/server-<port>.log），未配置 SNAPSHOT_FILE；测试夹具已调用 POST /api/__test__/reset，配置恢复默认（privacySensitiveKeywords=["password","token","bank","secret"]，enablePrivacyFilter=true）；导入脚本通过环境变量 API_BASE 指向测试后端
- 测试数据：按 D-01 平移：最新一条（1710100000000）→ 导入时刻 − 5 分钟。issues/100（1708000000000）距最新 2100000000 ms ≈ 24.3 天 → ageDays=24；Google 搜索页（1707000000000）距最新 3100000000 ms ≈ 35.9 天 → ageDays=35（PRD 第 13 章）
- 步骤：
  - S1：POST /api/__test__/reset
  - S2：spawn node scripts/import-sample.mjs（API_BASE=测试后端），等待退出
  - S3：GET /api/pages/cleanup-suggestions
- 预期：
  - E1：S2 退出码=0
  - E2：S3 返回 200，body.summary 严格等于 { archive: 2, merge: 1, keep: 0 }
  - E3：S3 的 archive 项中 url="https://github.com/org/repo/issues/100" 的 ageDays=24，reason="超过 14 天未访问（已 24 天），且不在当前打开的 tab 中"
  - E4：S3 的 archive 项中 url="https://www.google.com/search?q=chrome+extension+manifest+v3" 的 ageDays=35，reason="超过 14 天未访问（已 35 天），且不在当前打开的 tab 中"
- 证据：evidence/TC-API-DEMO-005/（api: S3 响应）

### TC-API-DEMO-006 时间平移保持相对间隔：issues/100 与 Google 页 lastVisitedAt 相差 1000000000 ms，且落在导入时刻窗口内
- 优先级：P1 ｜ 类别：boundary ｜ 技术：boundary
- 关联 Feature：F-DEMO-02（AC2） ｜ 关联 Code：C-BE-DEMO-03
- 前置条件：后端以 ENABLE_TEST_API=1 启动（playwright webServer，端口 TEST_PORT，LOG_FILE=evidence/_runtime/server-<port>.log），未配置 SNAPSHOT_FILE；测试夹具已调用 POST /api/__test__/reset，配置恢复默认（privacySensitiveKeywords=["password","token","bank","secret"]，enablePrivacyFilter=true）；导入脚本通过环境变量 API_BASE 指向测试后端
- 测试数据：平移量 offset = 导入时刻 − 5 分钟 − 1710100000000；issues/100 期望 lastVisitedAt = 导入时刻 − 300000 − 2100000000；Google 期望 = 导入时刻 − 300000 − 3100000000。导入时刻未知，用 S2 前后的 Date.now()（t0、t1）夹逼
- 步骤：
  - S1：POST /api/__test__/reset
  - S2：记录 t0=Date.now()，spawn node scripts/import-sample.mjs（API_BASE=测试后端）等待退出，记录 t1=Date.now()
  - S3：GET /api/pages/cleanup-suggestions
- 预期：
  - E1：S3 中 issues/100 的 lastVisitedAt − Google 页的 lastVisitedAt = 1000000000（严格相等）
  - E2：issues/100 的 lastVisitedAt 落在 [t0 − 2100300000, t1 − 2100300000] 区间内
- 证据：evidence/TC-API-DEMO-006/（api: S3 响应；t0 / t1 记录）

### TC-API-DEMO-007 后端不可达时导入脚本以非 0 退出码结束，不影响正在运行的后端
- 优先级：P1 ｜ 类别：exception ｜ 技术：error-guessing
- 关联 Feature：F-DEMO-02（AC1） ｜ 关联 Code：C-BE-DEMO-03
- 前置条件：后端以 ENABLE_TEST_API=1 启动（playwright webServer，端口 TEST_PORT，LOG_FILE=evidence/_runtime/server-<port>.log），未配置 SNAPSHOT_FILE；测试夹具已调用 POST /api/__test__/reset，配置恢复默认（privacySensitiveKeywords=["password","token","bank","secret"]，enablePrivacyFilter=true）
- 测试数据：API_BASE=http://127.0.0.1:9（无服务端口，模拟后端不可达）；等待上限 15 秒
- 步骤：
  - S1：POST /api/__test__/reset
  - S2：spawn node scripts/import-sample.mjs，env API_BASE=http://127.0.0.1:9，等待退出
  - S3：GET /api/health（测试后端）
- 预期：
  - E1：S2 在 15 秒内退出，退出码 ≠ 0，stdout + stderr 合并文本非空
  - E2：S3 返回 200，body.pageCount=0
- 证据：evidence/TC-API-DEMO-007/（stdout/stderr: 导入脚本输出、退出码）

### TC-API-DEMO-008 连续执行两次样例导入：页面数保持 10
- 优先级：P2 ｜ 类别：state ｜ 技术：state-transition
- 关联 Feature：F-DEMO-02（AC1） ｜ 关联 Code：C-BE-DEMO-03、C-BE-DEMO-02
- 前置条件：后端以 ENABLE_TEST_API=1 启动（playwright webServer，端口 TEST_PORT，LOG_FILE=evidence/_runtime/server-<port>.log），未配置 SNAPSHOT_FILE；测试夹具已调用 POST /api/__test__/reset，配置恢复默认（privacySensitiveKeywords=["password","token","bank","secret"]，enablePrivacyFilter=true）
- 测试数据：两次导入都用 resources/sample-history.json，URL 集合相同（去重后 10 个页面）
- 步骤：
  - S1：POST /api/__test__/reset
  - S2：spawn node scripts/import-sample.mjs（API_BASE=测试后端），等待退出
  - S3：再次 spawn node scripts/import-sample.mjs，等待退出
  - S4：GET /api/health
- 预期：
  - E1：S2、S3 退出码都为 0
  - E2：S4 的 body.pageCount=10（重复导入不新增页面）
- 证据：evidence/TC-API-DEMO-008/（api: S4 响应）

## Feature → Case 覆盖表

| Feature | 用例 |
|---|---|
| F-DEMO-01 | TC-API-DEMO-001、TC-API-DEMO-002、TC-API-DEMO-003 |
| F-DEMO-02 | TC-API-DEMO-004、TC-API-DEMO-005、TC-API-DEMO-006、TC-API-DEMO-007、TC-API-DEMO-008 |
