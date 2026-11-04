# ID 规范与数据结构（需求阶段）

> 权威来源：`.workflow/CONVENTIONS.md` §1（ID 规范）、§2（追溯规则）、§4（JSON 结构）。本文件摘录需求阶段要用的部分；标注「**本技能新增**」的内容是 CONVENTIONS 之外的补充约定，validator 不检查，由 `scripts/check-requirements.mjs` 检查。两者冲突时以 CONVENTIONS 为准。

## 1. ID 总表

| 类型 | 格式 | 示例 | 归属文件 | 谁分配 | 检查方 |
|---|---|---|---|---|---|
| 需求点 ID（**本技能新增**） | `REQ-<NNN>`（3 位，从 001 起连续） | `REQ-012` | `docs/trace/requirements.json` | PM（本技能） | check-requirements |
| Feature ID | `F-<MOD>-<NN>`（2 位） | `F-SYNC-01` | `docs/trace/features.json` | PM（本技能） | validator `prd` |
| 验收标准编号（**本技能新增**） | `AC<n>`，在 Feature 内从 1 起连续；跨文件引用写作 `F-SYNC-01#AC2` | `F-SYNC-01#AC2` | features.json `acceptance[]` | PM（本技能） | check-requirements |
| 决策 ID | `D-<NN>` | `D-03` | features.json `decisions[]` + PRD「决策记录」 | PM（本技能） | check-requirements |
| Code ID | `C-FE-<MOD>-<NN>` / `C-BE-<MOD>-<NN>` | `C-BE-SYNC-02` | code-points-*.json | 架构师（阶段 2） | validator `design` |
| Case ID | `TC-<API\|E2E\|UI>-<MOD>-<NNN>` | `TC-API-SYNC-001` | cases-*.json | 测试设计（阶段 3） | validator `cases` |

需求阶段**只分配 REQ / F / AC / D 四类 ID**，不要在 PRD 中预先编造 Code ID 或 Case ID（validator 规则 8：文档中不能出现 JSON 里不存在的 ID）。

### 1.1 MOD 模块码

- 2–10 位大写字母，ID 中的 MOD 必须与对象的 `module` 字段一致。
- **必备模块**（每个都至少要有 1 个 inScope Feature）：

| MOD | 含义 | PROBLEM.md 出处 |
|---|---|---|
| `CTX` | 插件加载与浏览器上下文读取（manifest、当前 tab、tabs 列表、历史） | 必做功能 1 |
| `SYNC` | 同步按钮、上报、去重入库、同步状态 | 必做功能 2 |
| `RANK` | 历史排序接口与展示、评分与理由 | 必做功能 3 |
| `REC` | 下一步推荐接口与展示 | 必做功能 4 |
| `CLEAN` | 旧页面 / 重复页面整理建议 | 必做功能 5 |
| `RULE` | 自然语言规则解析、预览、保存、列表、删除、规则生效 | 必做功能 6 |
| `DIAG` | 启动诊断（7 个检查项）、`/api/health`、`/api/config` | 必做功能 7 |
| `PRIV` | 隐私过滤（插件端过滤、后端兜底、关键词可配置） | 总体约束 + 进阶「隐私过滤」 |

- 可选模块：`CACHE`（本地缓存 / 离线降级）、`INCR`（增量同步）、`PERF`（性能）、`MENU`（右键菜单）、`DEMO`（样例数据、启动脚本）、`CFG`（配置）、`HL`（页面高亮）、`SIM`（相似度）、`PERSIST`（后端持久化）、`DOC`（交付文档）。新增模块码前先确认现有模块放不下。

### 1.2 分配与变更规则（全部 ID 通用）

1. **一经发布不得改作他用**：已经写进 JSON 的 ID，含义只能细化，不能换成另一个功能。
2. **不删除、不重排**：不做的功能把 `inScope` 置为 `false` 并在 `description` 中说明原因；需求点删除同样保留 ID，置 `inScope=false`。
3. **只追加**：新功能使用该模块下一个未用的编号（不回填空号）。验收标准同理：已发布的 `AC1..ACn` 不能重新编号，新标准追加为 `AC(n+1)`。原因是测试用例通过 `acceptanceRefs: ["F-SYNC-01#AC2"]` 引用它们。
4. PRD（`docs/02-PRD.md`）必须出现 features.json 中的**全部** Feature ID，并且不能出现未登记的 Feature ID（validator 检查）；PRD 附录要列出全部 inScope 的 REQ ID（check-requirements 检查，缺失时给 warning）。

## 2. docs/trace/requirements.json（**本技能新增**）

用途：把 PROBLEM.md 拆成可追溯的原始需求点，回答「题目里的每一句要求有没有被 Feature 承接」。质量报告用它计算**原始需求点覆盖率**。

```json
{
  "requirements": [
    {
      "id": "REQ-012",
      "section": "必做功能 > 2. 浏览器数据同步到后端",
      "quote": "后端保存页面记录，按 URL 去重",
      "kind": "functional",
      "mandatory": true,
      "inScope": true,
      "features": ["F-SYNC-03"],
      "note": ""
    }
  ]
}
```

| 字段 | 类型 | 规则 |
|---|---|---|
| `id` | string | `REQ-NNN`，按 PROBLEM.md 中**出现的先后顺序**编号，从 `REQ-001` 起连续、唯一 |
| `section` | string | PROBLEM.md 中的章节路径，建议直接用 `check-requirements.mjs --dump-items` 输出的路径（如 `必做功能 > 7. 启动诊断与配置检查 > 插件端需要展示诊断状态`） |
| `quote` | string | PROBLEM.md **逐字摘录**。去掉空白（以及 `**`、反引号）后必须能在 PROBLEM.md 中找到；不得改写、概括或拼接多处原文。表格行写成 `单元格1 \| 单元格2` |
| `kind` | enum | `functional`（功能）、`constraint`（总体约束）、`nfr`（性能 / 隐私 / 降级等非功能）、`acceptance`（验收流程步骤）、`deliverable`（交付物）、`advanced`（进阶加分项）、`hint`（提示）、`interview`（面试追问） |
| `mandatory` | boolean | PROBLEM.md 要求必须做到的为 `true`：总体约束、系统架构说明、核心数据模型、必做功能、验收要求、交付物。进阶、提示、面试追问一般为 `false`（提示中隐含硬约束的，例如「background 和 popup 需要消息通信」，可以标为 `true`） |
| `inScope` | boolean | 本次交付是否承接。`mandatory=true` 时必须为 `true` |
| `features` | string[] | 承接该需求点的 Feature ID（多对多）。`mandatory && inScope` 时至少 1 个 inScope Feature；纯讲解类需求（例如「候选人能解释数据模型」）映射到交付文档类 Feature |
| `note` | string（可选） | 推断、取舍或不承接的理由 |

**完整性要求**：`check-requirements.mjs --dump-items` 列出的「必须覆盖」条目（列表项、表格行、代码块中的接口声明行和公式行、核心数据模型的模型标题）每一条都要被某条 REQ 的 quote 覆盖；「建议覆盖」的段落句尽量覆盖，例如「不要求真实 LLM，可以用关键词规则解析器实现（识别：N 天没访问、域名、动作词等）」这类关键句。粒度一般是「一个列表项 = 一条 REQ」；很长的列表项可以拆成几段逐字摘录，合起来覆盖 80% 以上即可。

## 3. docs/trace/features.json（CONVENTIONS §4 + 本技能约定）

```json
{
  "features": [{
    "id": "F-SYNC-01",
    "module": "SYNC",
    "name": "点击「同步浏览器上下文」按钮",
    "kind": "action",
    "layers": ["FE", "BE"],
    "priority": "P0",
    "inScope": true,
    "source": "REQ-011、REQ-012；PROBLEM.md 必做功能 2",
    "description": "popup 中点击同步按钮后，background 读取当前 tab、当前窗口 tabs 和最近历史，经隐私过滤后 POST /api/sync",
    "acceptance": [
      "AC1：Given 后端已启动且已 reset，当前窗口打开 resource.json 中的 4 个页面 When 点击「同步浏览器上下文」按钮 Then 后端收到 1 次 POST /api/sync，请求体包含 activeTab、openTabs、history 三个字段",
      "AC2：Given 同一批数据 When 连续同步 2 次 Then GET /api/health 的 pageCount 两次都为 10"
    ]
  }],
  "decisions": [
    { "id": "D-01", "question": "Q1 时间基准：样例是 2024 年数据", "decision": "导入样例时整体平移到最新一条 = 导入时刻 − 5 分钟，读接口支持 ?now= 覆盖", "reason": "直接用当前时间会让所有页面都超过 965 天，排序和整理失去区分度" }
  ]
}
```

| 字段 | 规则（validator 强制 / 本技能约定） |
|---|---|
| `id` | `F-<MOD>-<NN>`，唯一（validator） |
| `module` | 与 ID 中的 MOD 一致（validator） |
| `name` | 一句话动作 / 行为，例如「诊断：history 权限检查」（validator：非空） |
| `kind` | `action`（用户动作）/ `display`（展示）/ `system`（系统自动行为）/ `api`（接口能力）/ `rule`（业务规则 / 算法口径）/ `nfr`（非功能）（validator） |
| `layers` | `["FE"]` / `["BE"]` / `["FE","BE"]`（validator）。决定了后续必须有哪一端的 Code 点和哪一类用例 |
| `priority` | `P0`–`P3`（validator） |
| `inScope` | 布尔值（validator）；inScope 数量至少 25 个（validator），本项目预期 40–70 个（check-requirements 给 warning） |
| `source` | 非空（validator）。**本技能约定**格式：`REQ-xxx[、REQ-yyy]；PROBLEM.md <章节>`；推断出的需求写 `推断：<理由>；REQ-xxx`。引用的 REQ 必须存在，并且该 REQ 的 `features` 中也要包含本 Feature（双向一致） |
| `description` | 非空（validator）：说明做什么、在哪一端做 |
| `acceptance` | 至少 1 条（validator）。**本技能约定**格式：`AC<n>：Given … When … Then …`，n 从 1 起连续；不得包含含糊词；必须有可观察锚点（详见 writing-guide.md §4） |
| `decisions[]` | **本技能要求非空**（validator 只给 warning）：`id`（`D-NN`）、`question`、`decision`、`reason` 都必填；同一决策要同步写进 PRD「决策记录」章节 |

## 4. 追溯关系（需求阶段视角）

```
PROBLEM.md 条目 ──quote──> REQ ──features[]──> Feature ──acceptance[]──> AC
                                               │
                                               ├──< code-points[].features（阶段 2）
                                               └──< cases[].features / acceptanceRefs（阶段 3）
```

- 下游所有覆盖率都从 Feature 出发计算，所以 Feature 的 `layers` 和 `inScope` 一旦写错，后面每个阶段都会被 validator 卡住（例如 layers 写了 FE，就必须有 C-FE 代码点和 UI 用例）。
- 质量报告中的「原始需求点覆盖率」= mandatory 且 inScope 的 REQ 中，映射到至少 1 个已验证 Feature 的比例。

## 5. 校验命令与职责划分

| 命令 | 检查内容 |
|---|---|
| `node .workflow/validators/validate.mjs prd` | Feature 字段与枚举、ID 格式与唯一性、inScope ≥ 25、8 个必备模块、PRD 中 Feature ID 齐全且无未登记 ID、PRD 提及必需接口、PRD 覆盖 7 个诊断项关键词、PRD 引用 resource.json、PRD 有「决策」和「验收」章节 |
| `node .agents/skills/nav-req-analysis/scripts/check-requirements.mjs --stage=understand` | 只检查 requirements.json：结构、ID 连续、quote 逐字存在、出现顺序、PROBLEM.md 条目覆盖完整性 |
| `node .agents/skills/nav-req-analysis/scripts/check-requirements.mjs` | 上面全部 + REQ → Feature 映射、Feature `source` 引用、AC 格式 / 编号 / 含糊词 / 可观察锚点、decisions、PRD 中的 REQ 追溯 |
| `node .agents/skills/nav-req-analysis/scripts/check-requirements.mjs --dump-items` | 列出 PROBLEM.md 中需要被 REQ 覆盖的条目（行号、章节路径、类型），作为摘录清单 |

所有命令在项目根目录执行，退出码 0 为通过；加 `--json` 输出机器可读结果。
