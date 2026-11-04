# Feature 拆分与验收标准写作指南

本指南回答四个问题：一个 Feature 拆多细、kind / layers / priority 怎么判、验收标准怎么写才能直接变成断言、需求点如何映射。示例都取自本项目。

## 1. 拆分粒度

**一条原则**：每个「用户动作 / 操作」和每个「可观察的系统行为」各一个 Feature ID。
- 太粗：「F-RULE-01 规则配置」一个 ID 包下解析、预览、保存、列表、删除。后果是测试只能写一条大用例，失败时定位不到具体行为，追溯矩阵也看不出哪一步没做。
- 太细：「F-SYNC-07 visitCount 字段」「F-SYNC-08 lastVisitedAt 字段」一个字段一个 ID。字段级要求应该写成同一个 Feature 的多条 AC。
- 判断方法：如果两件事可以**独立地做对或做错**、需要**不同的前置条件**来验证，就拆开；如果总是一起成立，就合并成同一个 Feature 的多条 AC。

### 1.1 各模块必须独立成 Feature 的点（检查清单，不是现成的编号）

| 模块 | 必须独立的点 |
|---|---|
| CTX | manifest 合法且声明 4 个权限；开发者模式可加载；popup 展示当前 active tab（URL + title）；展示当前窗口 tabs 列表；展示最近 N 条历史（N 取决策值）；系统页面（`chrome://` 等）降级展示；「当前页面」判定排除插件自身页面 |
| SYNC | 点击同步按钮（发起上报）；后端按 URL 去重入库；visitCount / lastVisitedAt 更新口径；source 区分与合并（`active_tab` / `open_tab` / `history`）；isOpen 按最近一次快照刷新；同步状态展示（进行中 / 成功 / 失败及原因）；最近一次同步结果持久化（供诊断使用）；`/api/sync` 入参校验与错误返回；非 http(s) URL 不上传 |
| RANK | `GET /api/pages/ranked` 返回结构与降序；评分公式及各分量口径；reason 生成；规则对排序的影响；popup 历史排序概览（分数和理由可见）；无数据时的空状态 |
| REC | `POST /api/recommendations/next` 返回结构；GitHub PR → 同 repo issue / actions；文档页 → 同域名高频页；同域名 → 高分页面；排除当前页、已打开页和重复 URL；兜底保证至少 1 条；popup 推荐展示（至少 1 条且有 reason）；性能（推荐接口 100ms 内） |
| CLEAN | `GET /api/pages/cleanup-suggestions` 返回结构；archive 判定（超过 X 天且不在打开的 tab 中）；merge 判定（去掉 query / hash 后相同）；keep 判定（never_archive 保护）；archive_candidate 规则覆盖默认阈值；判定优先级；popup 整理建议摘要展示 |
| RULE | 输入自然语言并解析预览；解析器支持的句式（N 天、域名、产品名 → 域名、动作词）；否定识别（「永远不要归档」）；多子句拆分（「，但」）；无法识别时告知用户、不保存；确认保存；查看规则列表；删除规则；规则生效于排序和整理 |
| DIAG | 7 个检查项**各自一个 Feature**：后端连通性（`/api/health`）、`tabs` 权限、`history` 权限、`storage` 可用性、API base URL 展示 / 配置、最近一次同步结果、当前规则数量；`GET /api/health` 字段；`GET /api/config` 字段；失败项的提示与排查建议；诊断入口 |
| PRIV | 插件端在发送前过滤敏感 URL；敏感关键词的来源（`/api/config` + 内置默认值）；后端兜底过滤；隐身窗口的 tab 不上传；关键词可配置（进阶） |
| 进阶（inScope） | CACHE：缓存排序 / 推荐结果、离线时展示缓存并标注；INCR：记录同步游标、只上传增量；PERF：预计算评分、推荐结果缓存 |
| 进阶（inScope=false） | 后端持久化实现（只在方案中解释）、右键菜单、向量相似度、页面高亮：照常登记 Feature，`inScope=false`，description 中写明不做的理由 |
| DEMO | 一条命令启动后端（`scripts/start.sh`）；样例数据导入（`resource.json` 时间平移后走真实 `/api/sync`） |

### 1.2 「讲解类」和「交付物类」需求点怎么映射

PROBLEM.md 中的「候选人能解释数据模型、评分策略……」「架构说明」「评分策略说明」这类需求不对应独立代码，**不要**为它们单独建只有文档的 Feature（CONVENTIONS 要求每个 inScope Feature 都有对应端的代码点和用例）。做法：
- REQ 映射到它所解释的功能性 Feature：评分策略说明 → RANK 评分公式 Feature；规则解析说明 → RULE 解析器句式 Feature；诊断说明 → DIAG 提示与排查建议 Feature；启动说明 → DEMO 启动脚本 Feature；
- 在该 Feature 的 description 中注明「交付文档 README 需包含对应章节」，并在 REQ 的 note 中写「文档由 validator final 阶段检查 README 章节」。

## 2. kind / layers / priority / inScope 判定

### 2.1 kind

| kind | 判定 | 例子 |
|---|---|---|
| `action` | 用户在 popup 中主动触发的操作 | 点击同步；输入规则并解析；确认保存规则；删除规则；修改 API base URL |
| `display` | popup 中展示的信息，不需要用户操作 | 当前 tab；tabs 列表；排序概览；推荐列表；诊断面板；同步状态；离线标记 |
| `system` | 没有用户直接操作、系统自动发生的行为 | 发送前隐私过滤；isOpen 快照刷新；写入本地缓存；增量游标推进；当前页面判定 |
| `api` | 后端对外接口能力（以接口为观察点） | `GET /api/health` 返回 5 个字段；`GET /api/config` 返回 4 个字段 |
| `rule` | 业务规则或算法口径 | URL 归一化与去重；评分公式；推荐规则与兜底；整理判定优先级；解析器句式 |
| `nfr` | 非功能要求 | 推荐接口 100ms；后端不可用时降级；MV3 约束；本地可完整演示 |

### 2.2 layers：「哪一端需要写代码才能让 AC 成立」

- `["FE"]`：只靠插件就能满足。例如展示当前 tab、tabs 列表、历史列表（只依赖浏览器 API，后端挂了也要能展示）；tabs / history / storage 权限诊断；API base URL 配置；离线时展示缓存。
- `["BE"]`：只靠后端就能满足。例如评分公式、URL 归一化、规则解析器句式、`/api/config` 字段、后端兜底隐私过滤。
- `["FE","BE"]`：用户动作需要两端配合才能闭环。例如点击同步（插件采集 + 后端入库）、输入规则并解析预览（插件输入 + 后端解析）、确认保存、删除规则、诊断后端连通性（插件调用 + 后端 health）。
- 「展示后端数据」的 Feature 一般只标 `FE`：接口能力由另一个 `BE` 的 api / rule Feature 承担。不要为了「数据来自后端」就给展示类 Feature 加 BE，否则下游就要为它补 C-BE 和 API 用例。
- 隐私过滤必须拆成「插件端发送前过滤（FE）」和「后端兜底（BE）」两个 Feature：PROBLEM.md 要求敏感 URL**不上传**，只有后端过滤不满足要求。
- 后果提示：layers 含 FE ⇒ 阶段 2 必须有 C-FE 代码点、阶段 3 必须有 UI 用例；含 BE ⇒ 必须有 C-BE 代码点和 API / E2E 用例。标错会让后面每个阶段都被 validator 卡住。

### 2.3 priority

| 优先级 | 判定 |
|---|---|
| P0 | 必做功能 1–7 的核心路径；PROBLEM.md 验收流程第 1–9 步直接依赖的行为；总体约束（MV3、敏感 URL 不上传、本地可演示） |
| P1 | 必做功能中的细节、异常和降级（入参校验、空状态、失败提示、排查建议、后端不可用时的展示）；选定 inScope 的进阶项：隐私关键词可配置、本地缓存与离线降级、增量同步、推荐缓存与预计算评分 |
| P2 | 进阶：后端持久化实现、右键菜单（`inScope=false`） |
| P3 | 进阶：向量相似度、页面高亮（`inScope=false`） |

### 2.4 inScope

- PROBLEM.md 必做功能 1–7、总体约束、验收流程涉及的全部 Feature：`inScope=true`。
- 进阶项按上表：P0 / P1 为 `true`，P2 / P3 为 `false`（照常登记，不要省略，以便将来启用时不必重新编号）。
- 对应的 REQ：必做类 `mandatory=true, inScope=true`；进阶类 `mandatory=false`，inScope 与其 Feature 一致。

## 3. 需求点（REQ）摘录要点

1. 先运行 `node .agents/skills/nav-req-analysis/scripts/check-requirements.mjs --dump-items`，按输出顺序逐条摘录：一般一个列表项 / 表格行 / 接口声明 / 模型标题对应一条 REQ。
2. quote 逐字复制原文，可以去掉 `**` 和反引号，不能改写。表格行写成 `后端服务是否可连接 | 调用 /api/health 检查`。
3. 段落句（「建议覆盖」）里有实质要求的也要摘，例如「不要求真实 LLM，可以用关键词规则解析器实现（识别：N 天没访问、域名、动作词等）」「插件需展示解析结果，用户确认后调用保存接口」。
4. 「题目目标」和「背景」不强制摘录，但背景里的 4 句自然语言示例是规则解析器的重要输入，建议作为 `hint` 类 REQ 摘录，并映射到 RULE 的句式 Feature。
5. 先写 requirements.json（`features` 先留空数组），用 `--stage=understand` 校验通过后，再在拆 Feature 时回填映射。

## 4. 验收标准（AC）写法

### 4.1 格式

```
AC<n>：Given <前置状态 / 数据> When <动作 / 调用> Then <可观察结果>[，且 <更多可观察结果>]
```

- n 从 1 起连续。发布后**只能追加**，不能重排或改作他用（用例通过 `F-XXX-NN#ACn` 引用）。
- 一条 AC 只验证一个场景；同一个 Feature 的正常、边界、异常场景分成多条 AC。
- 每个 action / api / rule 类 Feature 至少写 1 条正常场景，加 1 条异常或边界场景（非法入参、空数据、后端不可用、阈值边界），给测试设计留出反例和边界值的依据。

### 4.2 可观察锚点（至少一个，check-requirements 会检查）

| 观察通道 | 写法示例 |
|---|---|
| 接口响应 | `Then 响应 200，pages 按 score 降序，第 1 项的 url 为 https://github.com/org/repo/pull/456` |
| 接口错误 | `Then 响应 400，error.code 为「INVALID_JSON」`（错误码的具体取值可以在阶段 2 契约中定稿，PRD 先写清楚状态码和错误类别） |
| UI 可见文本 / 数量 | `Then 同步状态区显示「同步成功」和本次同步时间`、`Then 推荐区至少展示 1 条，每条都有非空的推荐理由` |
| 本地存储 | `Then 本地记录的最近一次同步结果为「失败」，并包含失败原因` |
| 后端数据核对 | `Then GET /api/pages/ranked 中不存在包含 token 的 URL` |
| 日志 | `Then 后端日志中不出现该敏感 URL 的原文` |

PRD 阶段还没有 testId（由前端架构师在阶段 2 的 ui-contract 中定义），UI 类 AC 用「popup 区块名 + 引号中的可见文本 / 数量」描述即可，不要自己编 testId。

### 4.3 禁用的含糊词

`正常`、`正确`、`合理`、`体验良好`、`符合预期`、`友好`、`适当`、`恰当`、`合适`、`等等`、`尽量`、`尽可能`、`较快`、`较好`、`较少`、`流畅`、`美观`、`清晰`、`完善`、`一定程度`、`基本可用`、`大致`、`若干`、`相关内容`、`及时`。

- 写在引号里的 UI 文案不算（例如 `显示「正常」`）；「不正确的 JSON」这类描述非法输入的说法也不算。
- 替换思路：「响应正常」→「响应 200 且包含 status、version、uptime、pageCount、ruleCount」；「推荐合理」→「第 1 条为 https://github.com/org/repo/actions，reason 包含「PR」」；「速度较快」→「1 万条页面下连续请求 20 次，p95 < 100ms」；「提示友好」→「提示文本包含失败原因和排查建议「确认后端已启动」」。

### 4.4 用 resource.json 推演的具体值

以下数值来自 `docs/01-需求理解.md` §8，写 AC 前请用决策后的口径复算一遍（`docs/prototype/engine.js` 的演示数据比 resource.json 多几条页面，**不要直接照抄它的输出**，只能用它的函数对 resource.json 复算）：

| 场景 | 具体值（时间基准 = 数据中最新一条） |
|---|---|
| 去重后页面数 | 10（activeTab 和 3 个 openTabs 都出现在 history 中） |
| source 合并 | pull/456 → `active_tab` + `history`；issues/123、Fetch_API、docs.internal → `open_tab` + `history`；其余只有 `history` |
| visitCount | issues/123 = 8，useState = 6，pull/456 = 5，Fetch_API = 4 |
| 未访问天数 | issues/100 = 24.31 天，Google 搜索页 = 35.88 天，docs.internal = 6.94 天 |
| 推荐（当前页 pull/456） | 第 1 条为 `https://github.com/org/repo/actions`；排除已打开的 issues/123，以及去掉 query 后与它相同的 `issues/123?tab=comments` |
| 整理（默认 14 天，无规则） | archive：issues/100、Google 搜索页；merge：issues/123 + issues/123?tab=comments |
| 整理（加规则「7 天 GitHub issue 归档 / docs.internal.com 永不归档」） | 在上面的基础上：issues/100 的 reason 注明命中 7 天规则；keep：docs.internal.com/ai-agent-design |
| 规则解析示例句 | 2 条：`archive_candidate`（github.com、`/issues/`、7 天、`suggest_archive`）和 `never_archive`（docs.internal.com、`keep`） |

时间相关的 AC 写**相对天数**，不要写绝对时间戳（样例导入时会整体平移）。阈值边界（恰好 14 天算不算「超过」）必须先在决策中定案，再写进 AC。

### 4.5 正例与反例对照

| kind | 反例（不可测） | 正例（可测） |
|---|---|---|
| action | AC1：用户点击同步后可以看到结果 | AC1：Given 后端已启动并已 reset，当前窗口打开 4 个页面 When 点击「同步浏览器上下文」按钮 Then 同步状态区显示「同步成功」，且 GET /api/health 的 pageCount 大于等于 4 |
| action（异常） | AC2：后端挂了要提示用户 | AC2：Given API base URL 指向一个没有服务的端口 When 点击同步 Then 同步状态区显示「同步失败」和失败原因，本地记录的最近一次同步结果为「失败」 |
| display | AC1：排序结果展示正确 | AC1：Given 已导入 resource.json 样例 When 打开 popup 的历史排序区 Then 展示 10 条，按分数从高到低排列，每条都显示分数（0–1，两位小数）和非空的排序理由 |
| system | AC1：敏感页面要过滤 | AC1：Given 当前窗口打开 `https://example.com/reset?token=abc` When 点击同步 Then POST /api/sync 的请求体中不包含该 URL，同步结果中的过滤条数为 1 |
| api | AC1：health 接口返回正常 | AC1：Given 后端已启动 When GET /api/health Then 响应 200，status 为「ok」，version 为「1.0.0」，uptime 为非负整数，pageCount、ruleCount 为整数 |
| rule | AC1：规则解析要准确 | AC1：Given 无 When POST /api/rules/parse 提交「把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档」 Then 返回 2 条规则：第 1 条 type=archive_candidate、domain=github.com、urlPattern=/issues/、inactiveDays=7；第 2 条 type=never_archive、domain=docs.internal.com、action=keep |
| rule（边界） | AC2：识别不了的要告诉用户 | AC2：Given 无 When POST /api/rules/parse 提交「帮我整理一下」 Then rules 为空数组，并返回 1 条未识别说明，原因包含「没有识别到动作」；GET /api/rules 的数量不变 |
| nfr | AC1：推荐接口要快 | AC1：Given 已导入 10000 条页面 When 连续调用 POST /api/recommendations/next 20 次 Then p95 耗时小于 100ms |

## 5. 决策记录

- 每个【待确认】问题（01 文档的 Q 列表）都要定案：默认采用「建议默认值」，与 PROBLEM.md 冲突时以 PROBLEM.md 为准。
- 同一决策同时写进 features.json 的 `decisions[]`（`D-NN`）和 PRD「决策记录」章节，内容一致；在受影响 Feature 的 description 或 AC 中引用决策 ID（例如「按 D-01 的时间基准」）。
- 已知需要定案的冲突点：时间基准（样例为 2024 年数据）、visitCount 口径、存储去重主键（原始 URL 还是 normalizedUrl；engine.js 与 01 文档的做法不同）、isOpen 是否按快照刷新、keep 的展示范围、搜索页判重是否保留 `q` 参数、恰好 N 天是否算「超过」、`/api/sync` 的返回格式和统一错误格式、parse 返回的临时 id、rawText 存整句还是子句、是否允许修改 API base URL、历史条数 N。
