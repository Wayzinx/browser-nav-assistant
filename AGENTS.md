# AGENTS.md

> 开发 agent 优先使用 Codex / Trae（高推理强度）；测试 agent 优先使用 Claude Code 无头模式（`claude -p`）作为 worker。

## 项目开发约定

整个项目全流程严格遵守workflow：
1. 前后端代码开发有对应的目录
2. 测试有单独的目录，一个case id（测试用例）对应一个测试脚本（可以是API或者UI）
3. 测试记录和留痕单独一个目录，里面存放对应测试用例的验证结果（截图，gif，前后端的日志和返回值等证据信息）

## 约定落地（具体路径）

| 约定 | 本项目中的位置 | 由谁检查 |
|---|---|---|
| 1. 前后端代码各有目录 | 后端 `server/`（加上 `scripts/`、`resources/`），插件前端 `extension/` | `node .workflow/validators/validate.mjs code`、`node specs/tools/check-spec.mjs` |
| 2. 一个 Case ID 对应一个测试脚本 | `tests/api/<CaseID>.spec.mjs`、`tests/e2e/<CaseID>.spec.mjs`、`tests/ui/<CaseID>.spec.mjs`；公共夹具放在 `tests/fixtures/` | `node .workflow/validators/validate.mjs scripts` |
| 3. 测试记录和留痕单独一个目录 | `evidence/<CaseID>/`：result.json、api/（请求与返回值）、server.log（后端日志）、extension.log（前端日志）、screenshots/、flow.gif、explore.json（UI 探索结论） | `node .agents/skills/nav-case-to-script/scripts/run-cases.mjs`（证据完整性检查） |

## 工作流、技能与规范入口

- 工作流约定（ID 规则、产物路径、追溯规则、测试配方、TDD 纪律）：`.workflow/CONVENTIONS.md`；全流程编排：`.workflow/browser-nav-sdlc.workflow.js`
- 各角色技能（按阶段索引）：`.agents/skills/README.md`
  - 产品：`nav-req-analysis`
  - 测试：`nav-test-case-design`、`nav-case-to-script`、`nav-quality-report`
- 前后端代码规范：`specs/backend.spec.md`、`specs/frontend.spec.md`（索引见 `specs/README.md`）
- 追溯链：`REQ-NNN`（原始需求点）→ `F-<MOD>-<NN>`（Feature，含 AC）→ `C-<FE|BE>-<MOD>-<NN>`（Code，源码 `@code` 注释）→ `TC-<API|E2E|UI>-<MOD>-<NNN>`（Case）→ `evidence/<CaseID>/` → `docs/08-测试报告.md`
