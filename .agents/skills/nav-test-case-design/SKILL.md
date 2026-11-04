---
name: nav-test-case-design
description: 浏览器导航助手项目的测试用例设计技能。基于 PRD、Feature 注册表、前后端技术方案和契约，生成可追溯（Feature / AC / Code / Case ID）、可独立执行、覆盖正例 / 反例 / 边界 / 异常等类别的接口、E2E 和 UI 用例（docs/06、docs/07、cases-api.json、cases-ui.json），并用 check-cases.mjs 自检。适用于「设计测试用例 / 生成用例 / 补充反例和边界 / 补齐 AC 覆盖 / 用例评审 / 用例返工」等场景。
---

# 测试用例设计（nav-test-case-design）

把每一条验收标准（AC）变成可以直接转成脚本的用例：每条用例独立可执行、期望值具体可断言、追溯关系完整，并且每个 Feature 的正例、反例、边界、异常都有覆盖。

## 1. 输入与产出

| 类别 | 文件 |
|---|---|
| 必读 | `AGENTS.md`、`.workflow/CONVENTIONS.md`（§1 ID、§2 追溯规则、§4 JSON 结构、§5 测试配方） |
| 需求 | `PROBLEM.md`（验收流程第 1–10 步）、`docs/02-PRD.md`（第 5 节交互、第 6 节算法口径、第 13 节样例推演）、`docs/trace/features.json` |
| 设计 | `docs/03-技术方案-后端.md`、`docs/04-技术方案-前端.md`、`docs/trace/api-contract.json`、`docs/trace/ui-contract.json`、`docs/trace/code-points-be.json`、`docs/trace/code-points-fe.json` |
| 数据 | `resource.json`（只读）；需要核对数值时运行 `node docs/prototype/engine.js` |
| 产出：API / E2E | `docs/06-测试用例-接口与E2E.md`、`docs/trace/cases-api.json` |
| 产出：UI | `docs/07-测试用例-UI.md`、`docs/trace/cases-ui.json` |

只写自己负责的产出文件，不修改 PRD、契约、代码点和 `.workflow/` 下的任何文件。上游文档有问题时，写进结构化输出的 openQuestions，不要自行改上游。

## 2. 硬性约束

1. **ID 与追溯**（validator `cases` 阶段会检查）：
   - Case ID 为 `TC-<API|E2E|UI>-<MOD>-<NNN>`，MOD 与 `module` 一致；一经发布不得改作他用。
   - 每条用例至少关联 1 个 Feature 和 1 个 Code ID；用例引用的每个代码点，其 `features` 必须与用例的 `features` 有交集。
   - API / E2E 只能引用 C-BE；UI 至少引用 1 个 C-FE。
   - 每个 inScope Feature：`layers` 含 BE 时至少有 1 条 API 或 E2E 用例；含 FE 时至少有 1 条 UI 用例。每个代码点至少被 1 条用例引用。
   - E2E 用例：validator 要求至少 3 条，本技能要求**至少 5 条**；每条至少 3 步，引用的代码点至少跨 2 个模块。
   - md 文档中必须出现 JSON 里的全部 Case ID，也不能出现 JSON 中不存在的 ID。
2. **一个 Case ID 对应一个测试脚本**（AGENTS.md）：每条用例会被转成 `tests/<api|e2e|ui>/<CaseID>.spec.mjs`。因此每条用例必须**独立**：自己构造数据（通过真实的 `POST /api/sync` 导入），依靠 `/api/__test__/reset` 与其他用例隔离；preconditions 和 steps 中**不得引用其他 Case ID**，也不能依赖执行顺序。
3. **本技能新增的字段**（check-cases 会检查，详见 `references/case-schema.md`）：
   - `category`：主类别，取值 `positive` / `negative` / `boundary` / `exception` / `security` / `performance` / `compatibility` / `state`；
   - `technique`：主设计技术，取值 `equivalence` / `boundary` / `decision-table` / `state-transition` / `error-guessing` / `scenario` / `pairwise`；
   - `acceptanceRefs`：覆盖的验收标准，例如 `["F-SYNC-01#AC1"]`；
   - `steps` 每条以 `S1：` 开头，`expected` 每条以 `E1：` 开头，都从 1 开始连续编号。脚本会用 `expect(x, '[E1] …')` 对应 expected 第 1 条，所以**每条 expected 必须能落成至少一个断言**；
   - 根节点可选 `waivers: [{ feature, category, reason }]`，用于说明某个必需类别为什么不适用。
4. **可执行性**（CONVENTIONS §5）：
   - API / E2E 走真实 HTTP，禁止 mock 后端；
   - UI 的旧页面只能通过后端导入构造（`chrome.history.addUrl` 无法设置访问时间和次数）；popup 以 tab 方式打开；外部站点用 route 离线化；后端不可达用不存在服务的端口模拟（例如 `http://127.0.0.1:9`），不能 route 后端；元素只引用 ui-contract 中登记的 testId。
5. **时间边界**：「恰好 N 天」必须通过契约中的时间基准覆盖参数（例如 `?now=`）固定时间；契约中没有该参数时，拆成「N 天 - 1 分钟 / N 天 + 1 分钟」两条用例，并在 testData 中写明原因（服务端处理请求的毫秒级偏移会让「恰好 N 天」不稳定）。样例数据统一按 PRD 决策 D-01 平移：最新一条 lastVisitTime = 导入时刻 − 5 分钟（夹具 `samplePayload` 已经实现）。读接口支持 `?now=` 覆盖当前时间。
6. **证据**：执行证据会落在 `evidence/<CaseID>/`（result.json、api/、server.log、screenshots/、flow.gif、extension.log、explore.json）。用例的 `evidence` 字段可以写明需要重点留存的内容。

## 3. 工作流程

### 第 1 步：建立「AC × 类别」矩阵

逐个读取 inScope Feature，把每条 acceptance 编号为 `F-XXX-NN#ACn`（取自「AC<n>：」前缀），然后按下表确定这个 Feature **必须**覆盖的类别：

| 条件 | 必需类别 |
|---|---|
| 所有 inScope Feature | positive ≥ 1（nfr 可以用 performance / security 代替） |
| kind 为 action / api / rule | negative ≥ 1（security 也算） |
| kind 为 action / api / rule，且描述或 AC 中有数值、阈值或长度 | boundary ≥ 1 |
| layers 含 FE，或依赖后端、浏览器 API、storage 等外部资源 | exception ≥ 1 |
| kind 为 display | 加载 / 空 / 错误 / 离线状态 ≥ 1（category 为 state、exception 或 boundary） |
| kind 为 nfr | performance 或 security ≥ 1 |

确实不适用的必需类别写 waiver（`positive` 不能豁免），理由要具体，例如「该接口没有入参，无法构造非法输入」。

### 第 2 步：为每个 Feature 选择设计技术

参考 `references/dimensions.md`：

- 有输入的接口：先做**等价类**（有效类、无效类各 1 个代表），再在数值或长度处做**边界值**；
- 多条件决定一个结果（例如整理建议的优先级）：用**判定表**，每种组合一列，每列一条用例；
- 有生命周期的对象（规则、同步状态、缓存）：用**状态迁移**，覆盖每条迁移，再加 1 条非法迁移；
- 已知的易错点（否定词被解析成肯定、带 query 的重复 URL、visitCount 重复累加）：用**错误推测**；
- 参数组合多：用**成对组合**控制数量。

### 第 3 步：写用例（先正例，再反例 / 边界 / 异常）

- 测试点从 `references/module-test-points.md` 中挑选，并结合本项目 PRD 的实际口径修正。
- **期望值要具体**：写字段名、具体值、数量、顺序、testId 和可见文本。能用 resource.json 推演出具体值的，一律写具体值，并在 testData 中写明推算依据（以 PRD 第 13 节为准）。
  - ✗ `E1：同步成功` / `E2：数据正确` / `E3：接口返回正常`
  - ✓ `E1：返回 200，body.created=10、body.updated=4`
  - ✓ `E2：pages[0].url="https://github.com/org/repo/issues/123"，且 0 ≤ score ≤ 1`
  - ✓ `E3：sync-status 文本包含「同步成功」`
- 一条 expected 只表达一个可以独立判断的事实；一个事实需要多个断言时，这些断言共用同一个 `[En]` 标签。
- 反例要断言**错误格式**（状态码 + `error.code` + message 非空），并断言**没有副作用**（例如 health.pageCount 不变）。
- 后端生成的值（规则 id、page id）不要写死在用例里，写成「S3 返回的 id」。
- 标题写成「条件 + 期望」，例如「重复同步同一批数据：页面数不变、visitCount 不累加」；同一 Feature 下标题不得重复。

### 第 4 步：设计 E2E 链路（至少 5 条）

E2E 要串联多个接口，并在步骤之间**传递状态**（后一步使用前一步响应中的值，并断言它的变化）。建议覆盖：

1. 验收主链路：reset → 导入样例 → ranked → 推荐 → health.pageCount；
2. 规则闭环：parse → 用 parse 返回的规则 save → cleanup 体现规则 → 用 save 返回的 id 删除 → cleanup 恢复 → health.ruleCount；
3. 规则影响排序：保存 never_archive 前后对比 ranked 中受保护页面的 score 和 reason；
4. 重复同步与 isOpen 刷新：两次同步不同的 openTabs，对比 ranked 和 cleanup；
5. 隐私兜底链路：直接同步含敏感词的 URL → ranked / cleanup / health 中都不出现；
6. （可选）性能链路：导入 1 万条数据 → 推荐 p95。

UI 用例按 PROBLEM.md 验收流程组织，覆盖第 3–9 步（第 1、2、10 步只覆盖可以自动化的部分）。

### 第 5 步：确定优先级与数量

- 优先级：P0 = P0 Feature 的正例、验收流程直接依赖的路径、隐私不上传、E2E 主链路；P1 = P0 Feature 的反例 / 边界 / 异常，以及 P1 Feature 的正例；P2 = 兼容性、UI 细节状态、P1 Feature 的反例 / 边界；P3 = 已知局限的记录性用例。
- 数量参考：每个 inScope Feature 2–4 条；全项目 API 约 60–90 条、UI 约 30–50 条、E2E ≥ 5 条。数量明显偏少，通常说明漏了类别；明显偏多，通常说明把同一个等价类拆成了多条。

### 第 6 步：写 md 文档

按模块分节，每条用例列出 Case ID、标题、优先级、类别、技术、关联 Feature（含 AC）、关联 Code、前置条件、测试数据、步骤、预期、证据。文末附「Feature → Case 覆盖表」和「类别分布统计」，统计数字取自 `check-cases.mjs --json` 的 stats，不要手算。模板见 `references/case-schema.md` 第 3 节。

### 第 7 步：自检（全部通过才能结束）

```bash
node .workflow/validators/validate.mjs cases                    # 追溯关系、ID、E2E 规则（只修复自己负责的那部分错误）
node .agents/skills/nav-test-case-design/scripts/check-cases.mjs  # 新增字段、编号、AC 覆盖、类别矩阵、expected 具体性、独立性
```

check-cases 的检查项：

| 检查 | 级别 |
|---|---|
| category / technique / priority 取值合法；acceptanceRefs 非空且格式为 `F-XXX-NN#ACn` | error |
| steps / expected 以 S1 / E1 开头并连续编号 | error |
| acceptanceRefs 引用的 Feature 和 AC 存在，并且 Feature 在用例的 features 中 | error |
| 每个 inScope Feature 的每条 AC 至少被 1 条用例引用 | error |
| Feature × 类别覆盖矩阵（第 1 步的规则，waiver 除外）；waiver 理由缺失、豁免 positive | error |
| expected 过短或含糊（只有「成功 / 正常 / 正确」，没有字段、数值、文本或 testId） | error |
| E2E 少于 5 条，或某条少于 3 步 | error |
| 同一 Feature 下标题重复；preconditions / steps 引用其他 Case ID | error |
| expected 没有任何可断言的锚点；features 中的某个 Feature 没有 acceptanceRefs；waiver 已过时 | warning |

`--json` 输出的 `stats`（类型 / 类别 / 优先级分布、AC 覆盖率、类别缺口）和 `matrix` 会被质量报告直接引用。

## 4. 评审时重点看什么

- 每条 AC 是否真的被 expected 证明了，而不只是被 acceptanceRefs「挂上」：对照 AC 原文和 expected 逐条核对。
- 期望值与 PRD 第 13 节、resource.json 是否一致；PRD 的口径与原型不同时，以 PRD 为准。
- 反例是否同时断言了错误格式和「没有副作用」。
- 时间相关用例是否固定了时间，是否依赖真实日期或外网。
- E2E 是否真正传递了状态（使用前一步的返回值），而不是几个互不相关的调用拼在一起。
- UI 用例的每一步能否用夹具实现（testId 是否已登记、数据能否构造）。

## 5. 常见错误

| 错误 | 改法 |
|---|---|
| 用例 B 的前置条件写「先执行 TC-API-SYNC-001」 | 在 B 自己的步骤里导入数据 |
| `expected: ["返回成功"]` | 写出状态码、字段和具体值 |
| 恰好 14 天的用例直接用当前时间构造 | 用 `?now=` 固定时间，或改成 14 天 ± 1 分钟 |
| 用 `chrome.history.addUrl` 构造 30 天前的页面 | 改为通过 `POST /api/sync` 导入旧页面 |
| UI 用例引用了 ui-contract 中没有登记的 testId | 写进 openQuestions，请前端补充契约，不要自己编造 testId |
| 删除规则的用例写死 `DELETE /api/rules/rule_1` | 写成「用保存接口返回的 id 删除」 |
| 只有正例 | 按第 1 步的矩阵补齐类别，或写 waiver 说明理由 |

## 6. 参考文件

- `references/dimensions.md`：类别、设计技术、横切维度检查清单、时间边界与可执行性约束
- `references/module-test-points.md`：按模块整理的测试点库，附 resource.json 推演出的具体数据
- `references/case-schema.md`：字段说明、好坏用例对照、md 模板、优先级判定
- `scripts/check-cases.mjs`：自检脚本，导出 `checkCases({ root })` 供质量报告复用
