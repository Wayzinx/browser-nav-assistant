# 跨角色看板（docs/trace/board/）

任何角色在工作中发现**需要别的角色澄清或修改**的问题，都在这里新建一条记录，不要只写在自己的 journal、openQuestions 或代码注释里。例如：

- 用例设计发现接口错误码不明确、契约内部互相矛盾；
- 自动化发现某条 expected 无法断言（缺 testId、时间无法固定）；
- 前端发现需要的后端字段不存在；
- 开发发现上游模块未就绪、需要改契约。

workflow 会运行 `node .workflow/validators/validate.mjs board`，按 `to` 把未关闭的记录路由给负责人。负责人修订文档或代码后回填结果。对齐评审和基线冻结之前，所有阻塞项（`blocking=true`）都必须关闭（`board --freeze=<stage>`）。

## 文件与 ID

- 一条记录一个文件：`docs/trace/board/<ID>.json`，ID 就是文件名，格式为 `B-[A-Z0-9-]+`。
- 建议格式：`B-<阶段>-<提出方>-<序号>`，例如 `B-CASES-TEST-RULE-01`。并行的 agent 各写各的文件，互不冲突。
- 不要修改别人提出的记录的问题描述；负责人只回填 `status / resolution / changedFiles / resolvedBy`。

## 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 与文件名一致 |
| `stage` | 是 | 提出时所处的阶段：`prd` / `design` / `cases` / `align` / `scripts` / `dev` / `final` |
| `from` / `to` | 是 | 角色：`PM` / `BE` / `FE` / `ARCH` / `TEST` / `AUTO` / `DEV-BE` / `DEV-FE` / `HUMAN` |
| `type` | 是 | `clarify`（澄清）/ `change`（变更请求）/ `conflict`（文档冲突）/ `blocker`（阻塞） |
| `blocking` | 是 | 布尔值；不解决就无法继续时为 `true` |
| `target` | 是 | `文件#锚点` 或 ID，例如 `docs/trace/api-contract.json#POST /api/rules`、`F-RULE-03#AC2` |
| `refs` | 否 | 相关 ID 数组，只能是 `F-` / `C-` / `TC-` / `REQ-` / `F-XXX-NN#ACn`，必须真实存在 |
| `question` | 是 | 问题描述：现状、矛盾点、影响（原文引用） |
| `proposal` | 否 | 提出方的建议 |
| `status` | 是 | `open` / `answered` / `accepted` / `rejected` / `wontfix` |
| `resolution` | 非 open 时必填 | 负责人的结论 |
| `changedFiles` | 否 | 负责人修改过的文件，必须存在 |
| `createdBy` | 是 | 提出方的任务键，例如 `case-API-RULE#1` |
| `resolvedBy` | 非 open 时必填 | 负责人的任务键，例如 `arch-BE#2` |
| `createdAt` | 否 | ISO 时间 |

## 示例

```json
{
  "id": "B-CASES-TEST-CLEAN-01",
  "stage": "cases",
  "from": "TEST",
  "to": "BE",
  "type": "conflict",
  "blocking": true,
  "target": "docs/trace/api-contract.json#POST /api/sync",
  "refs": ["F-SYNC-05#AC2", "TC-API-SYNC-012"],
  "question": "数组超过 500 条：通用错误表写 413 PAYLOAD_TOO_LARGE，POST /api/sync 的 errors 写 400 VALIDATION_FAILED，用例无法确定期望。",
  "proposal": "统一为 413 PAYLOAD_TOO_LARGE，并同步更新 docs/03 第 5 章。",
  "status": "accepted",
  "resolution": "统一为 413，契约 v1.1.1 已修改。",
  "changedFiles": ["docs/trace/api-contract.json", "docs/03-技术方案-后端.md"],
  "createdBy": "case-API-CLEAN+PERSIST#1",
  "resolvedBy": "arch-BE#3",
  "createdAt": "2026-11-04T10:00:00+08:00"
}
```

## 与基线冻结的关系

对齐评审通过后，workflow 用 `baseline --record=<name>` 冻结上游产物：PRD、需求点、Feature、契约、代码点、模块依赖、用例。

之后对这些文件的任何修改，都必须有一条 `type=change`、`status=accepted` 的记录覆盖，覆盖方式是 `refs` 包含被改的 ID，或者 `target` 指向被改的文件或锚点。否则 `baseline --check` 会报「未经变更请求的基线修改」，并列出受影响的用例和脚本。
