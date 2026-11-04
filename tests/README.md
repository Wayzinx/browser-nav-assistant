# 测试工程说明

测试框架：`@playwright/test@1.64.1`，配置文件为根目录 `playwright.config.mjs`（从 `.agents/skills/nav-case-to-script/assets/` 原样复制，入口固定为 `server/src/index.js`）。

## 分层

| 目录 | Playwright project | 内容 | 用例来源 |
|---|---|---|---|
| `tests/api/` | `api` | 单接口测试（请求 → 响应 / 状态码 / 错误码） | `docs/trace/cases-api.json`（type=API） |
| `tests/e2e/` | `e2e` | 多接口编排的端到端业务流程 | `docs/trace/cases-api.json`（type=E2E） |
| `tests/ui/` | `ui` | 加载 Chrome 扩展、操作 popup 的 UI 测试（超时 60s） | `docs/trace/cases-ui.json` |
| `tests/fixtures/` | — | 共享夹具：`api.mjs`、`evidence.mjs`、`extension.mjs`、`mutation.mjs`、`sample.mjs` | 技能模板，勿在脚本中重复造轮子 |

约定：

- 一个 Case ID 对应一个脚本文件：`tests/<层>/<CaseID>.spec.mjs`，测试标题以 Case ID 开头。
- 禁止 `only / skip / fixme / fail`，禁止 mock 后端（不得对 `/api`、localhost 做 route 拦截）。
- `retries=0`、`workers=1`：后端是共享的内存状态，必须串行，不允许靠重试掩盖不稳定。
- 每个测试开始前夹具自动调用 `api.reset()`（依赖后端 `ENABLE_TEST_API=1` 的测试接口）。
- 测试证据写入 `evidence/<CaseID>/`；后端日志写入 `evidence/_runtime/server-<端口>.log`。

## 端口约定（.workflow/CONVENTIONS.md §9）

端口通过环境变量 `TEST_PORT` 指定，默认 4100。Playwright 会自己用该端口拉起后端（`reuseExistingServer: false`），因此并行运行的多个 agent 必须使用不同端口：

| 用途 | 端口 |
|---|---|
| 门禁 / 终检 | 4100 |
| 后端 lead / 前端 lead | 4101 / 4102 |
| API 仲裁 | 4103 |
| 变异检查 | 4105 |
| 骨架检查 | 4198；`--list` 4199 |
| 模块组 g 的后端开发 / 前端开发 | 4200+g / 4220+g |
| 模块组 g 的后端修复 / 前端修复 | 4240+g / 4260+g |
| UI 探索 i | 4180+i |

## 运行方法

```bash
npm test                          # 全部
npm run test:api                  # 只跑接口层
npm run test:e2e                  # 只跑 E2E 层
npm run test:ui                   # 只跑 UI 层
scripts/test.sh tests/api/TC-XXX.spec.mjs          # 单独运行一个用例脚本（参数透传给 playwright test）
TEST_PORT=4201 scripts/test.sh --project=api -g TC-XXX   # 指定端口 + 按标题过滤
npx playwright test --list        # 只列出用例，检查配置能否加载
npm run test:case                 # 技能流水线：静态检查 → 执行 → 失败分类 → 证据完整性 → 变异检查
```

自检：`node .workflow/validators/validate.mjs infra --brief`。
