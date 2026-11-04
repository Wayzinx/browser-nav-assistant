# 代码规范索引（specs/）

本目录定义「浏览器导航助手」项目**写代码时**必须遵守的规范，供开发 agent（trae / codex 中的 gpt）编码时遵循，同时作为代码评审、测试失败分诊和 UI 探索判定的依据。

| 文件 | 适用对象 | 作用范围 | 规则数（机检） |
|---|---|---|---|
| [backend.spec.md](backend.spec.md) | 后端开发 agent | `server/**`、`scripts/**`、`resources/**` | 54（21） |
| [frontend.spec.md](frontend.spec.md) | 插件前端开发 agent | `extension/**` | 53（27） |
| [tools/check-spec.mjs](tools/check-spec.mjs) | 开发 agent 自检、门禁、质量报告 | 上面两份规范中标注为「机检」的规则 | — |

## 1. 与工作流其他部分的关系

```
PROBLEM.md / resource.json            需求真相源（只读）
        │
.workflow/CONVENTIONS.md              流程约定：ID 体系、产物路径、追溯规则、测试配方、TDD 纪律
        │
docs/03、docs/04、api-contract.json、ui-contract.json   技术方案与契约：接口和界面「长什么样」
        │
specs/*.spec.md（本目录）               代码规范：代码「怎么写」
        │
.agents/skills/                        各角色的执行技能
  ├─ nav-req-analysis                  需求理解与 PRD（Feature ID）
  ├─ nav-test-case-design              测试用例设计（Case ID）
  ├─ nav-case-to-script                用例转自动化脚本（依赖 BE-LOG-02 / BE-RUN-03 / FE-TEST-02 等约定）
  └─ nav-quality-report                准出质量报告（引用 check-spec 结果和覆盖率）
```

- **冲突时的优先级**：`PROBLEM.md` > `.workflow/CONVENTIONS.md` > 技术方案与契约 > 本规范。接口路径、字段、错误码以契约为准；本规范只约束实现方式。规范与契约冲突时，按契约实现，并在交付说明中指出冲突，由架构师修订其中一方。
- **与 validator 的分工**：`node .workflow/validators/validate.mjs code` 负责流程层面的硬性检查（`@code` 追溯、manifest 必备权限、MV3 CSP、语法、testId 落地、测试锁）；`check-spec.mjs` 负责代码规范层面的检查（分层、依赖、日志、时间、安全、XSS、消息协议等）。两者都必须通过。规范中标注为「validator」的规则由前者检查。
- **与测试的关系**：测试夹具依赖以下约定，违反会直接导致用例失败或证据缺失：
  - BE-LOG-02：后端支持 `LOG_FILE`，并同步写入日志 → 留痕中的 `evidence/<CaseID>/server.log`
  - BE-LOG-03：回传 `x-request-id` → 每次请求都能和后端日志对上号
  - BE-RUN-02：只有 `ENABLE_TEST_API=1` 时才提供 reset 接口 → 用例之间互相隔离
  - BE-RUN-03：收到 SIGTERM 时正常退出 → 后端行覆盖率
  - FE-TEST-02：storage key `apiBaseUrl`、popup 路径 `popup/popup.html` → UI 夹具能把插件指向测试后端
  - FE-UI-07：popup 尺寸用固定 px，禁止视口单位 → 真实 action popup 不会塌成空白小框（2026-11-03 线上缺陷的根因）
  - FE-TEST-04：真实安装冒烟（validate smoke）→ 以 tab 打开 popup 的 UI 用例不能代替真实 popup

## 2. 规则 ID 体系

- 格式：`BE-<领域>-<两位序号>` / `FE-<领域>-<两位序号>`，例如 `BE-LOG-02`、`FE-UI-03`。
- 后端领域：`DIR` 目录与分层、`NAME` 命名、`API` 接口约定、`TIME` 时间、`LOG` 日志、`ERR` 错误处理、`PERF` 性能、`RUN` 运行与可测试性、`SEC` 安全与隐私、`TRACE` 追溯、`STYLE` 代码风格。
- 前端领域：`DIR`、`MV3`、`MSG` 职责边界与消息、`API` 后端调用、`PRIV` 隐私、`CTX` 浏览器上下文、`UI` 界面、`CACHE` 缓存与离线、`DIAG` 诊断、`LOG`、`TRACE`、`TEST` 可测试性、`STYLE`。
- 级别：**MUST** 必须遵守；**SHOULD** 无充分理由不得违反，违反时在交付说明中写明理由。
- 检查方式：「机检」由 `check-spec.mjs` 检查，MUST 报 error、SHOULD 报 warning；「机检（启发式，warning）」表示只能做近似判断，统一报 warning；「人检」由代码评审、自动化用例或 UI 探索把关；「validator」由 `.workflow/validators/validate.mjs` 检查。
- ID 发布后不改作他用；废弃的规则保留编号，并标注「已废弃」。
- 评审意见、测试分诊、testDisputes 引用规范时写规则 ID，例如「违反 FE-UI-03：ranked-item-title 使用了 innerHTML」。

## 3. 如何自检

```bash
# 在项目根目录执行
node specs/tools/check-spec.mjs                 # 前后端都检查
node specs/tools/check-spec.mjs --side=be       # 只检查后端
node specs/tools/check-spec.mjs --side=fe --json
```

- 结果写入 `docs/quality/spec-check-be.json`、`spec-check-fe.json`（同时检查两侧时还会写 `spec-check-all.json`），结构为 `{ side, status, pass, errors: [{ rule, file, line, message }], warnings, stats }`，质量报告会读取这些文件。
- 退出码 0 表示没有 error；warning 不影响退出码，但要么修复，要么在交付说明中写明理由。
- `server/` 或 `extension/` 还不存在时（开发开始之前），对应一侧记为「尚未实现」，视为通过。
- 每个开发任务的完成定义（DoD）见各规范最后一节：自测用例全部通过 + `validate.mjs code` 没有本侧的 error + `check-spec.mjs` 没有 error。

## 4. 机检的局限

`check-spec.mjs` 基于正则和简单的注释剥离实现，没有完整的语法分析，因此只做误报率低的检查：

- 不识别正则字面量里的 `//`，可能把该行剩余部分当作注释，导致漏报（不会误报）。
- 消息 type 和 storage key 只检查字面量写法，以及 `shared/messages.js`、`shared/storage-keys.js` 中 `KEY: 'value'` 形式的常量；通过变量间接传入的值不检查。
- 动态拼接的 testId（模板字符串中含 `${}`）不检查。
- 函数长度（≤ 60 行）、JSDoc、分层是否合理、性能设计、隐私过滤逻辑是否正确等，只能靠人检和自动化用例。
