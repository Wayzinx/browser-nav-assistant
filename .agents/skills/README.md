# 技能与规范索引（按角色 / 工作流阶段）

所有技能都与具体 agent 无关，命令统一用 shell 表述：
- codex 读取 `.agents/skills/`；
- Claude Code 系的 agent（包括 claude -p 无头 worker）通过 `.claude/skills` 软链接读取同一份内容；
- trae 等其他 agent 直接按下表打开对应的 SKILL.md。

| 阶段（.workflow） | 角色 | 技能 / 规范 | 产物 | 自检命令 |
|---|---|---|---|---|
| 1 需求与 PRD | 产品（PM） | [nav-req-analysis](nav-req-analysis/SKILL.md) | `docs/01-需求理解.md`、`docs/02-PRD.md`、`docs/trace/requirements.json`、`docs/trace/features.json` | `node .workflow/validators/validate.mjs prd`<br>`node .agents/skills/nav-req-analysis/scripts/check-requirements.mjs` |
| 2 技术方案 / 5 开发 | 后端开发 | [specs/backend.spec.md](../../specs/backend.spec.md) | `server/**`、`scripts/**`、`resources/**` | `node .workflow/validators/validate.mjs code`<br>`node specs/tools/check-spec.mjs --side=be` |
| 2 技术方案 / 5 开发 | 前端（插件）开发 | [specs/frontend.spec.md](../../specs/frontend.spec.md) | `extension/**` | `node .workflow/validators/validate.mjs code`<br>`node specs/tools/check-spec.mjs --side=fe` |
| 3 测试用例 | 测试设计 | [nav-test-case-design](nav-test-case-design/SKILL.md) | `docs/06-*.md`、`docs/07-*.md`、`docs/trace/cases-api.json`、`docs/trace/cases-ui.json` | `node .workflow/validators/validate.mjs cases`<br>`node .agents/skills/nav-test-case-design/scripts/check-cases.mjs` |
| 4 自动化脚本 | 测试基建 / 自动化 | [nav-case-to-script](nav-case-to-script/SKILL.md)（大 workflow 第 4 阶段自动调用 [小 workflow](nav-case-to-script/workflow/case-to-script.workflow.js) 的 draft 模式） | `playwright.config.mjs`、`tests/fixtures/*`、`tests/<api\|e2e\|ui>/<CaseID>.spec.mjs` | `node .agents/skills/nav-case-to-script/scripts/run-cases.mjs --all --lint-only` |
| 5 开发闭环 / UI 探索 / 断言有效性 | 测试执行 | nav-case-to-script §5–§6（全绿后大 workflow 自动调用小 workflow 的 verify 模式） | `evidence/<CaseID>/`（执行证据和探索记录） | `node .agents/skills/nav-case-to-script/scripts/run-cases.mjs <CaseID…> [--mutation]` |
| 6 执行与验收 | 测试负责人 | [nav-quality-report](nav-quality-report/SKILL.md) | `docs/08-测试报告.md`、`docs/quality/metrics.json`、`coverage/` | 见该技能的自检一节 |

## 贯穿全流程的追溯链

```
PROBLEM.md 原文 ──REQ-NNN──▶ Feature F-<MOD>-<NN>（AC1..n）──▶ Code C-<FE|BE>-<MOD>-<NN>（源码中的 @code 注释）
                                      │                                  │
                                      └──▶ Case TC-<API|E2E|UI>-<MOD>-<NNN>（acceptanceRefs、codePoints）
                                                 │
                                                 └──▶ tests/<type>/<CaseID>.spec.mjs（[En] 断言）──▶ evidence/<CaseID>/ ──▶ 质量报告
```

## 测试留痕目录（AGENTS.md 约定 3）

`evidence/<CaseID>/`：`result.json`、`api/NN-*.json`（请求和响应）、`server.log`（后端日志切片）、`screenshots/`、`flow.gif`、`extension.log`、`explore.json` + `explore/`（UI 探索）。
`evidence/_runs/` 保存每次流水线运行的汇总和变异检查结果，`evidence/index.json` 是证据索引。
