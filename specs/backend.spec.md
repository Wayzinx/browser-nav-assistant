# 后端代码规范（backend.spec）

> 适用对象：后端开发 agent（`server/**`、`scripts/**`、`resources/**`），以及代码评审、测试失败分诊。
> 技术栈（CONVENTIONS §5）：Node.js v24，ESM，原生 `node:http`，**零运行时依赖**。
> 优先级：`PROBLEM.md` > `.workflow/CONVENTIONS.md` > 技术方案与契约（`docs/03`、`api-contract.json`）> 本规范。接口长什么样由契约决定，本规范决定代码怎么写。
>
> 规则格式：`BE-<领域>-<序号>`；**MUST** 必须遵守，**SHOULD** 无充分理由不得违反；「机检」表示 `node specs/tools/check-spec.mjs --side=be` 会检查（MUST 报 error，SHOULD 报 warning），「人检」靠评审和测试把关。规则 ID 发布后不改作他用。

---

## 1. 目录与分层（DIR）

| ID | 级别 | 检查 | 规则 |
|---|---|---|---|
| BE-DIR-01 | MUST | 机检 | 入口文件固定为 `server/src/index.js`（`playwright.config.mjs` 的 webServer 和 `scripts/start.sh` 都依赖它）。入口只负责读取配置、创建 server、注册信号处理，不写业务逻辑。 |
| BE-DIR-02 | SHOULD | 人检 | 按下面的目录分层。新增目录要在技术方案中说明理由。 |
| BE-DIR-03 | MUST | 机检 | 零运行时依赖：只允许 import `node:` 内置模块（必须带 `node:` 前缀）和相对路径；禁止 `require()`。 |
| BE-DIR-04 | MUST | 机检 | `domain/` 是纯函数层：不 import `node:http`、`node:https`、`node:net`、`node:fs`、`node:child_process` 等 I/O 模块，不读系统时间（见 BE-TIME-01），只接收参数、返回结果。 |
| BE-DIR-05 | MUST | 机检 | 依赖方向只能是 `routes → services → domain / store`：`domain/` 不 import `store/`、`services/`、`routes/`；`store/` 不 import `services/`、`routes/`；`services/` 不 import `routes/`。 |
| BE-DIR-06 | SHOULD | 人检 | `services/` 通过 `store/` 暴露的仓储函数读写数据，不直接操作内部的 `Map` / 索引，这样以后替换为 SQLite 时只需要改 `store/`。 |

推荐结构：

```
server/src/
├── index.js            # 入口：读取 config → createApp → listen → 注册 SIGTERM/SIGINT
├── app.js              # 组装路由表、CORS、请求日志、集中错误处理
├── config.js           # 环境变量与业务常量（阈值、权重、上限），每个常量都有注释
├── routes/             # 每个资源一个文件：解析参数 → 校验 → 调 service → 输出 DTO
│   ├── sync.js  pages.js  recommendations.js  rules.js  health.js  test-api.js
├── services/           # 业务编排：组合 domain 纯函数和 store
│   ├── sync-service.js  rank-service.js  recommend-service.js  cleanup-service.js  rule-service.js
├── domain/             # 纯函数：可以直接单测，可讲解
│   ├── url.js  scoring.js  recommend.js  cleanup.js  rule-parser.js  privacy.js
├── store/              # 内存存储 + 仓储接口（持久化方案见 docs/03）
│   ├── memory-store.js  indexes.js
└── lib/                # 基础设施
    ├── http.js  logger.js  errors.js  clock.js  validate.js
```

```js
// ✅ 正例：domain 只做计算，时间由调用方传入
// @code C-BE-RANK-01
export function computeScore(page, { now, weights, protectedDomains }) { /* ... */ }

// ❌ 反例：domain 里读系统时间、访问存储
import { listPages } from '../store/memory-store.js'; // 违反 BE-DIR-05
export function computeScore(page) {
  const age = Date.now() - page.lastVisitedAt;         // 违反 BE-TIME-01
}
```

## 2. 命名（NAME）

| ID | 级别 | 检查 | 规则 |
|---|---|---|---|
| BE-NAME-01 | SHOULD | 机检 | 源码文件名使用 kebab-case（`rule-parser.js`），不使用驼峰或下划线。 |
| BE-NAME-02 | MUST | 人检 | 对外 JSON 字段使用 camelCase，沿用 PROBLEM.md 的字段名（`normalizedUrl`、`lastVisitedAt`、`visitCount`、`inactiveDays`……），**只增不减、不改名**；新增字段先写进 `api-contract.json`。 |
| BE-NAME-03 | SHOULD | 人检 | 函数以动词开头（`upsertPages`、`parseRuleText`、`buildCleanupSuggestions`）；常量用 UPPER_SNAKE（`DAY_MS`、`MAX_HISTORY_ITEMS`）；布尔值以 `is` / `has` / `should` 开头；后端生成的 ID 带类型前缀：`page_`、`rule_`、`rec_`。 |

## 3. 接口约定（API）

| ID | 级别 | 检查 | 规则 |
|---|---|---|---|
| BE-API-01 | MUST | 人检 | 请求和响应都是 JSON，响应头为 `Content-Type: application/json; charset=utf-8`。时间戳统一为毫秒 number。 |
| BE-API-02 | MUST | 人检 | 所有错误响应都使用统一格式 `{ "error": { "code": "UPPER_SNAKE", "message": "给人看的中文说明", "details": { ... }? } }`。 |
| BE-API-03 | MUST | 人检 | 错误码只用下面清单中的值；需要新增时，先写进 `api-contract.json` 的 `errors`。 |
| BE-API-04 | MUST | 人检 | 状态码：查询、处理成功返回 200；创建资源（`POST /api/rules`）返回 201；参数错误 400；资源不存在 404；方法不允许 405；请求体过大 413；Content-Type 不是 JSON 返回 415；未预期的异常返回 500。具体以契约为准。 |
| BE-API-05 | MUST | 人检 | 请求体上限 1 MB（`config.MAX_BODY_BYTES`），超过时立即停止读取并返回 413，不能先把整个请求体读进内存。 |
| BE-API-06 | MUST | 人检 | 入参校验放在路由边界（`lib/validate.js`），service 和 domain 只接收已经校验过的数据。未知字段直接忽略，不报错，也不透传。 |
| BE-API-07 | MUST | 人检 | CORS：允许 `chrome-extension://*`、`http://localhost:*`、`http://127.0.0.1:*` 来源；`OPTIONS` 预检返回 204，并带上 `Access-Control-Allow-Methods`、`Access-Control-Allow-Headers: content-type, x-request-id`；用 `Access-Control-Expose-Headers` 暴露 `x-request-id`。其他来源不返回 `Access-Control-Allow-Origin`。 |
| BE-API-08 | SHOULD | 机检 | 写响应统一通过 `lib/http.js` 的 `sendJson` / `sendError`，其他文件不直接调用 `res.writeHead` / `res.end`。 |

错误码清单：

| code | 状态码 | 场景 |
|---|---|---|
| `INVALID_JSON` | 400 | 请求体不是合法 JSON |
| `VALIDATION_FAILED` | 400 | 字段缺失或类型错误；`details.fields` 列出具体字段 |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | 有请求体，但 Content-Type 不是 `application/json` |
| `NOT_FOUND` | 404 | 路由不存在，或资源（例如规则 id）不存在 |
| `METHOD_NOT_ALLOWED` | 405 | 路径存在，但方法不支持 |
| `PAYLOAD_TOO_LARGE` | 413 | 请求体超过上限 |
| `INTERNAL` | 500 | 未预期的异常（`details` 中只放 `reqId`） |

```js
// ✅ 正例：路由层校验 → service → 统一输出
// @code C-BE-RULE-03
export async function deleteRule(req, res, { params }) {
  const removed = ruleService.remove(params.id);
  if (!removed) throw new AppError('NOT_FOUND', 404, `规则 ${params.id} 不存在`);
  sendJson(res, 200, { deleted: params.id });
}

// ❌ 反例：错误格式各写各的，状态码随意
res.writeHead(200); res.end(JSON.stringify({ ok: false, msg: 'not found' }));
```

## 4. 时间（TIME）

| ID | 级别 | 检查 | 规则 |
|---|---|---|---|
| BE-TIME-01 | MUST | 机检 | 「当前时间」只能从 `lib/clock.js` 获取（例如 `clock.now()`）。`Date.now()` 只允许出现在 `clock.js` 中；`domain/` 中禁止无参的 `new Date()`（其他文件出现时报 warning）。耗时统计用 `performance.now()`，`lib/logger.js` 中的日志时间戳也不受此限制。 |
| BE-TIME-02 | MUST | 人检 | 按 PRD 的时间基准决策支持「时间覆盖」（例如读接口上的 `?now=<ms>`）。覆盖值在路由层解析，作为参数传给 service / domain，禁止使用全局可变的「当前时间」。 |
| BE-TIME-03 | SHOULD | 人检 | 天数换算统一使用 `DAY_MS = 86_400_000`；「超过 N 天」的比较方向（`>` 还是 `>=`）以 PRD 第 6 节为准，并写在函数注释中。 |

```js
// ✅ lib/clock.js
// @code C-BE-CORE-02
/** @param {URLSearchParams} [query] 支持 ?now= 覆盖（PRD 决策 D-01） */
export function resolveNow(query) {
  const v = Number(query?.get('now'));
  return Number.isFinite(v) && v > 0 ? v : Date.now();
}
```

## 5. 可观测性与日志（LOG）

测试留痕（AGENTS.md 约定 3）依赖这一节：测试夹具会按字节偏移截取每个用例执行期间的后端日志，写到 `evidence/<CaseID>/server.log`，并通过 `x-request-id`（形如 `TC-API-SYNC-001-03`）把每一次请求和对应的日志行对上号。

| ID | 级别 | 检查 | 规则 |
|---|---|---|---|
| BE-LOG-01 | MUST | 人检 | 统一使用 `lib/logger.js`，每条日志输出一行 JSON 到 stdout，字段包括 `ts`（ISO 字符串）、`level`、`msg`，请求日志还要有 `reqId`、`method`、`path`、`status`、`ms`。每个请求在结束时记录一条 access 日志。日志级别由 `LOG_LEVEL` 控制（默认 `info`）。 |
| BE-LOG-02 | MUST | 机检 | 设置了 `LOG_FILE` 环境变量时，把同样的 JSON 行**同步**追加写入该文件（`fs.appendFileSync`），保证测试结束的瞬间日志已经落盘。不能用异步 stream 写这个文件。 |
| BE-LOG-03 | MUST | 机检（启发式，warning） | 读取请求头 `x-request-id`（没有就生成 `req_<随机>`），写进该请求的所有日志，并在响应头中原样回传。 |
| BE-LOG-04 | MUST | 机检 | 业务代码禁止使用 `console.*`，只有 `lib/logger.js` 可以使用。 |
| BE-LOG-05 | MUST | 人检 | 日志中不得出现包含隐私关键词（password / token / bank / secret 及配置中的其他关键词）的完整 URL：记录时只保留 host，或用 `***` 打码；请求体不整体打印。 |

```js
// ✅ lib/logger.js
import fs from 'node:fs';
// @code C-BE-CORE-03
export function log(level, msg, fields = {}) {
  if (LEVELS[level] < LEVELS[current]) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
  console.log(line);
  if (process.env.LOG_FILE) fs.appendFileSync(process.env.LOG_FILE, line + '\n'); // 同步写：测试留痕按偏移量截取
}

// ❌ 反例
console.log('sync done', req.body);   // 违反 BE-LOG-04 / BE-LOG-05
```

## 6. 错误处理（ERR）

| ID | 级别 | 检查 | 规则 |
|---|---|---|---|
| BE-ERR-01 | MUST | 机检 | 不吞异常：禁止空的 `catch {}`。确实需要忽略时，在 catch 块中写注释说明原因（例如「文件不存在时使用默认值」）。 |
| BE-ERR-02 | MUST | 人检 | `app.js` 集中处理错误：`AppError` 按其 code / status 输出；其他异常一律返回 500 `INTERNAL`，`details` 中只带 `reqId`；完整堆栈只写进 error 日志，**不出现在响应里**。 |
| BE-ERR-03 | MUST | 人检 | 业务错误统一抛 `new AppError(code, status, message, details)`（定义在 `lib/errors.js`），不在各处手写错误响应。 |

```js
// ✅ app.js
try { await route.handler(req, res, ctx); }
catch (err) {
  if (err instanceof AppError) return sendError(res, err.status, err.code, err.message, err.details);
  log('error', 'unhandled', { reqId: ctx.reqId, stack: err.stack });
  sendError(res, 500, 'INTERNAL', '服务内部错误', { reqId: ctx.reqId });
}

// ❌ 反例
try { upsertPages(items); } catch (e) {}   // 违反 BE-ERR-01
```

## 7. 性能（PERF）

PROBLEM.md 的追问：「历史记录有 10 万条时，推荐接口如何在 100ms 内返回？」以下规则就是答案的落地，测试中有对应的性能用例。

| ID | 级别 | 检查 | 规则 |
|---|---|---|---|
| BE-PERF-01 | MUST | 人检 | 评分在写入时预计算：`/api/sync` 和规则变更之后增量更新受影响页面的 score，读接口不重新计算全量评分。依赖「当前时间」的部分（recency）按小时分桶缓存，或在读取时只对 Top-K 候选做修正。 |
| BE-PERF-02 | MUST | 人检 | 维护索引：`byUrl`（存储主键）、`byNormalizedUrl`（判重 / merge）、`byDomain`、`byRepo`（GitHub `owner/repo`）。每个桶按 score 有序，或只保留 Top-K。 |
| BE-PERF-03 | MUST | 人检 | `POST /api/recommendations/next` 禁止全量扫描页面：只从「同 repo / 同域名 / 全局 Top-K」等索引桶中取候选，候选数有上限（例如 200）。 |
| BE-PERF-04 | SHOULD | 人检 | 推荐结果按「当前 URL + 打开 tab 集合摘要 + 数据版本号」缓存；`/api/sync`、保存 / 删除规则时版本号加 1，缓存自动失效。 |
| BE-PERF-05 | SHOULD | 人检 | 同步按 URL 批量 upsert，单次请求的总处理量是 O(n)，不能出现 O(n²) 的嵌套去重。 |

## 8. 运行与可测试性（RUN）

| ID | 级别 | 检查 | 规则 |
|---|---|---|---|
| BE-RUN-01 | MUST | 人检 | 环境变量：`PORT`（默认值写在契约的 `defaultPort`）、`HOST`（默认 `127.0.0.1`）、`ENABLE_TEST_API`、`LOG_FILE`、`LOG_LEVEL`，统一在 `config.js` 中读取，其他文件不直接读 `process.env`。 |
| BE-RUN-02 | MUST | 机检 | 只有 `ENABLE_TEST_API=1` 时才注册 `POST /api/__test__/reset`（清空页面、规则和缓存，恢复初始配置），否则该路径返回 404。 |
| BE-RUN-03 | MUST | 机检 | 收到 `SIGTERM` / `SIGINT` 时调用 `server.close()`，然后 `process.exit(0)`（加一个兜底超时，例如 3 秒后强制退出）。原因：Playwright 用 SIGTERM 停止 webServer，**V8 覆盖率只有在进程正常退出时才会落盘**，质量报告的后端行覆盖率依赖这一点。 |
| BE-RUN-04 | SHOULD | 机检 | `scripts/start.sh` 用 `exec node server/src/index.js` 启动（`exec` 让信号直接到达 node 进程），并允许通过环境变量覆盖 PORT。 |
| BE-RUN-05 | MUST | 机检 | 禁止针对测试环境做特判：源码中不得读取 `TEST_PORT`、`PLAYWRIGHT*`、`process.env.CI`，不得出现 Case ID 字样，也不得根据 `x-request-id` 改变行为。`ENABLE_TEST_API` 只能用来决定是否注册 reset 接口。 |
| BE-RUN-06 | MUST | 机检 | 禁止硬编码样例数据：源码中不得出现 resource.json 的具体 URL（`org/repo`、`issues/123`、`pull/456` 等）或时间戳。样例数据只能通过 `resources/sample-history.json` 和导入脚本，经由真实的 `POST /api/sync` 导入。 |
| BE-RUN-07 | MUST | 人检 | 测试状态接口 `GET /api/__test__/state` 只在 `ENABLE_TEST_API=1` 时注册（否则 404），**严格只读**：只读取仓储，不得写入数据、改变版本号或触发缓存重建（因此不返回排序服务派生的 score）；返回内容中命中隐私关键词的 URL 必须打码（只保留 host）。测试夹具在每个用例前后各取一次，生成 `evidence/<CaseID>/state-{before,after,diff}.json`。 |

```js
// ✅ server/src/index.js
// @code C-BE-CORE-01
const server = createApp(config).listen(config.port, config.host, () =>
  log('info', 'server started', { port: config.port, host: config.host }));
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    log('info', 'shutting down', { signal: sig });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref(); // 有长连接时兜底退出
  });
}
```

```sh
# ✅ scripts/start.sh
#!/usr/bin/env sh
cd "$(dirname "$0")/.." && exec node server/src/index.js
```

## 9. 安全与隐私（SEC）

| ID | 级别 | 检查 | 规则 |
|---|---|---|---|
| BE-SEC-01 | MUST | 机检 | 禁止 `eval`、`new Function`、`child_process`。 |
| BE-SEC-02 | MUST | 人检 | 只接受 `http:` / `https:` 的 URL，用 `new URL()` 解析，解析失败或协议不符的记录跳过并计入 `filtered`，不能让整个请求失败（除非契约另有规定）。 |
| BE-SEC-03 | MUST | 人检 | 限制输入规模：`openTabs`、`history` 数组长度，`title` / `rawText` 字符串长度都有上限（写在 config 中，与契约一致），超出时截断或返回 400，二者择一并写进契约。 |
| BE-SEC-04 | MUST | 人检 | 用白名单字段构造新对象（`{ url, title, lastVisitTime }`），不把请求体对象直接 `Object.assign` 或展开到存储对象上，防止 `__proto__` / `constructor` 原型污染和多余字段落库。 |
| BE-SEC-05 | MUST | 人检 | 后端兜底隐私过滤：即使插件端已经过滤，`/api/sync` 仍然要按 `privacySensitiveKeywords` 再过滤一次（不区分大小写，匹配 URL），命中的记录不入库，只计入过滤数量，不记录 URL。 |

```js
// ✅ 白名单构造
const item = { url: String(raw.url), title: String(raw.title ?? '').slice(0, MAX_TITLE), lastVisitTime: Number(raw.lastVisitTime) || 0 };
// ❌ 反例
const page = { ...existing, ...req.body.activeTab };   // 违反 BE-SEC-04
```

## 10. 追溯（TRACE）

| ID | 级别 | 检查 | 规则 |
|---|---|---|---|
| BE-TRACE-01 | MUST | validator | 每个 C-BE 代码点在实现处（函数或模块上方）写 `// @code C-BE-<MOD>-<NN>`；一段代码实现多个点时可以写多个。不得出现未登记的 ID（`node .workflow/validators/validate.mjs code`）。 |
| BE-TRACE-02 | SHOULD | 机检 | `server/src` 下每个源码文件至少有一个 `@code` 标注；纯工具文件也要挂到它服务的代码点上，便于覆盖率按代码点归因。 |
| BE-TRACE-03 | MUST | validator | 实现位置与 `code-points-be.json` 中的 `files` / `symbols` 不一致时，更新这两个字段（不得修改 ID 和 `features`）。 |

## 11. 代码风格（STYLE）

| ID | 级别 | 检查 | 规则 |
|---|---|---|---|
| BE-STYLE-01 | MUST | 人检 | 2 空格缩进、单引号、语句末尾加分号、多行对象和数组保留尾逗号。 |
| BE-STYLE-02 | SHOULD | 机检 | 只用具名导出，不用 `export default`（便于检索和追溯 symbols）。 |
| BE-STYLE-03 | SHOULD | 机检 | 用 `const`，必要时用 `let`，不用 `var`。 |
| BE-STYLE-04 | SHOULD | 机检（文件行数） | 单个函数不超过 60 行，单个文件不超过 300 行；超出时按职责拆分。 |
| BE-STYLE-05 | MUST | 人检 | 导出函数写 JSDoc：说明参数和返回值的类型，以及业务口径（例如「score 取值 0–1」「inactiveDays 为严格大于」）。 |
| BE-STYLE-06 | SHOULD | 人检 | 不写魔法数字：阈值、权重、上限放在 `config.js`，每个常量都加注释说明含义和取值理由（评分权重要能在面试中讲清楚）。 |
| BE-STYLE-07 | SHOULD | 人检 | 注释用中文解释「为什么这样做」，不复述代码在做什么。代码保持简单直白：这是面试项目，候选人需要能逐行讲解。 |

## 12. 完成定义（DoD）

后端任务交付前，以下各项必须全部满足：

1. `TEST_PORT=4101 npx playwright test --project=api --project=e2e` 全部通过（单个用例用 `node .agents/skills/nav-case-to-script/scripts/run-cases.mjs <CaseID>`）。
2. `node .workflow/validators/validate.mjs code` 中没有后端相关的 error（`@code` 标注、语法检查）。
3. `node specs/tools/check-spec.mjs --side=be` 没有 error；warning 要么修复，要么在交付说明中写明理由。
4. `scripts/start.sh` 能在本地启动，`curl http://127.0.0.1:<port>/api/health` 返回 `status: "ok"`。
5. 没有修改 `tests/**`、`playwright.config.mjs`（已锁定）；认为测试有错时提交 `testDisputes`。
