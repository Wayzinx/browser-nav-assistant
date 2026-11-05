# 技能与规范索引（按角色 / 工作流阶段）

所有技能都与具体 agent 无关，命令统一用 shell 表述：
- codex 读取 `.agents/skills/`；
- Claude Code 系的 agent（包括 worker / claude-relay）通过 `.claude/skills` 软链接读取同一份内容；
- trae 等其他 agent 直接按下表打开对应的 SKILL.md。

| 阶段（.workflow v3） | 角色 | 技能 / 规范 | 产物 | 自检命令 |
|---|---|---|---|---|
| 1 需求与 PRD | 产品（PM） | [nav-req-analysis](nav-req-analysis/SKILL.md) | `docs/01`、`docs/02-PRD.md`、`docs/trace/requirements.json`、`docs/trace/features.json` | `validate.mjs prd` |
| 2 技术方案 | 后端 / 前端架构 | [backend.spec](../../specs/backend.spec.md)、[frontend.spec](../../specs/frontend.spec.md) | `docs/03`–`05`、`api-contract`、`ui-contract`、`code-points-*`、`modules.json` | `validate.mjs design`、`validate.mjs modules` |
| 3 用例设计 | 测试设计 | [nav-test-case-design](nav-test-case-design/SKILL.md) | `docs/trace/cases/*.json`（合并为 cases-api / cases-ui）、`docs/06`、`docs/07` | `validate.mjs cases` |
| 4 对齐与冻结 | 全部角色 | CONVENTIONS §10、§11；可执行性预检见 [nav-case-to-script §11](nav-case-to-script/SKILL.md) | `docs/trace/board/*.json`、`.workflow/context/feasibility/`、`.workflow/baseline/aligned.json` | `validate.mjs align`、`board --freeze=align`、`baseline` |
| 5 脚本与开发 | 测试基建 / 自动化 / 开发 | [nav-case-to-script](nav-case-to-script/SKILL.md)、两份 spec | `tests/<api\|e2e\|ui>/<CaseID>.spec.mjs`、`tests/smoke/smoke-plan.json`、`server/`、`extension/` | `run-cases.mjs --lint-only`、`validate.mjs scripts / code` |
| 6 TDD 闭环 | 开发 / 测试执行 | nav-case-to-script §5–§10 | `evidence/<CaseID>/`（含 state-diff）、`evidence/_smoke/` | `validate.mjs gate / mutation / explore / smoke` |
| 7 交付验收 | 测试负责人 / 验收人 | [nav-quality-report](nav-quality-report/SKILL.md)、CONVENTIONS §12、§13 | `docs/08-测试报告.md`、`evidence/_manual/checklist.md`、`bundles/` | `validate.mjs final / manual / freeze / submission / release` |

跨角色沟通一律走看板 `docs/trace/board/`（CONVENTIONS §10）：需要别的角色澄清或修改的，就新建一条记录；分配给自己的记录，处理完回填结果。不要只写在 journal 或 openQuestions 里。

## 贯穿全流程的追溯链

```
PROBLEM.md 原文 ──REQ-NNN──▶ Feature F-<MOD>-<NN>（AC1..n）──▶ Code C-<FE|BE>-<MOD>-<NN>（源码中的 @code 注释）
                                      │                                  │
                                      └──▶ Case TC-<API|E2E|UI>-<MOD>-<NNN>（acceptanceRefs、codePoints）
                                                 │
                                                 └──▶ tests/<type>/<CaseID>.spec.mjs（[En] 断言）──▶ evidence/<CaseID>/ ──▶ 质量报告
```

## 测试留痕目录（AGENTS.md 约定 3）

`evidence/<CaseID>/`：`result.json`、`api/NN-*.json`（请求和响应）、`server.log`（后端日志切片）、`state-before.json` / `state-after.json` / `state-diff.json`（后端状态修改前后对比）、`screenshots/`、`flow.gif`、`extension.log`、`explore.json` + `explore/`（UI 探索）。真实安装冒烟的证据在 `evidence/_smoke/`，人工验收的证据在 `evidence/_manual/`。
`evidence/_runs/` 保存每次流水线运行的汇总和变异检查结果，`evidence/index.json` 是证据索引。
