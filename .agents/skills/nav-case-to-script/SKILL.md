---
name: nav-case-to-script
description: 浏览器导航助手项目的「用例转可执行脚本」技能：把 docs/trace/cases-api.json / cases-ui.json 中的测试用例转成 Playwright 脚本（一个 Case ID 对应一个脚本文件），然后用确定性流水线（静态检查 → 加载 → 执行 → 失败分类 → 证据完整性 → 断言变异检查）验证脚本是否真的有效，测试证据写入 evidence/<CaseID>/。适用于：用例转脚本、写自动化测试、生成或修复测试脚本、搭测试基建（playwright.config / fixtures）、E2E 接口编排、断言怎么写、脚本有效性检查、批量转脚本（附带小 workflow）。
---

# 用例转可执行脚本（nav-case-to-script）

目标：脚本**一次就能跑通**，并且**真的能发现缺陷**。做法是：固定的夹具和模板 + 「expected ↔ 断言」一一对应 + 确定性的检查流水线，而不是靠每个 agent 自由发挥。

开工前必读：`AGENTS.md`、`.workflow/CONVENTIONS.md`（§2 追溯规则、§5 测试配方、§6 TDD 纪律）、`docs/trace/api-contract.json`、`docs/trace/ui-contract.json`。

## 1. 硬性规则（lint-scripts.mjs 会逐条检查）

| # | 规则 | lint |
|---|---|---|
| 1 | **一个 Case ID 对应一个脚本**：`tests/api/<CaseID>.spec.mjs`、`tests/e2e/<CaseID>.spec.mjs`、`tests/ui/<CaseID>.spec.mjs`。文件里所有 test 的标题都以这个 Case ID 开头，不能出现其他 Case ID | L01–L04 |
| 2 | 只从夹具导入：API / E2E 用 `import { test, expect } from '../fixtures/api.mjs'`，UI 用 `'../fixtures/extension.mjs'`。禁止直接从 `@playwright/test` 导入（否则不会自动 reset，也不会留痕） | L05 |
| 3 | 用例 `expected` 第 n 条 ↔ 至少一个断言，断言消息以 `[En]` 开头：`expect(r.status, '[E1] 返回 200').toBe(200)` | L06 |
| 4 | 用例 `steps` 第 n 步 ↔ `test.step('Sn：…', …)`。E2E 至少 3 个 step | L07 |
| 5 | 禁止 `only / skip / fixme / fail`、`waitForTimeout`、`try/catch` 吞掉失败、`if (…) return` 条件跳过、对常量做断言 | L08 L10 L16 L18 |
| 6 | UI 只用 `getByTestId('<ui-contract 中登记的 testId>')`；不用 css、xpath、getByText / getByRole | L08 L09 |
| 7 | 只发真实请求：不 route 后端 / localhost / 127.0.0.1，不 import `server/`、`extension/` 的源码，不直接用 `request` / `fetch`（统一走 `api` 夹具） | L11–L13 |
| 8 | 后端生成的值（规则 id 等）从上一步响应中取，不要硬编码 | L14 |
| 9 | 豁免变异要写理由：`// mutation-ignore: reverse —— 理由` | L19 |

lint 的 warning 也要尽量清零：L15 弱断言、L17 UI 没截图、L21 只断言了状态码。

## 2. 第 0 步：测试基建（每个项目做一次，由测试基建 agent 负责）

```bash
cp .agents/skills/nav-case-to-script/assets/playwright.config.mjs ./playwright.config.mjs
mkdir -p tests/fixtures tests/api tests/e2e tests/ui
cp .agents/skills/nav-case-to-script/assets/fixtures/*.mjs tests/fixtures/
npm i -D @playwright/test@1.64.1 pngjs@7 gifenc@1.0.3          # pngjs / gifenc 用来把截图合成 flow.gif
npm i -D c8 istanbul-lib-instrument istanbul-lib-coverage istanbul-lib-report istanbul-reports   # 质量报告统计覆盖率时用
npx playwright test --list                                      # 能列出用例，就说明配置加载正常（后端还没写时 webServer 起不来属于正常）
```

- `package.json` 的 scripts 至少包含：`test`、`test:api`、`test:e2e`、`test:ui`、`test:case`（`node .agents/skills/nav-case-to-script/scripts/run-cases.mjs`）。
- 只有当后端入口不是 `server/src/index.js` 时，才修改配置中的 `webServer.command`；只有当 ui-contract 中的 storage key 或 popup 路径与夹具里的默认值（`apiBaseUrl`、`popup/popup.html`）不同时，才修改 `tests/fixtures/extension.mjs` 顶部的常量。
- 夹具提供的能力（不要在脚本里重复造轮子）：

| 夹具 | 能力 |
|---|---|
| `api` | `get / post / put / patch / del / raw`，返回 `{ status, ok, headers, body, ms, reqId }`，**非 2xx 不抛错**；`reset()`（每个测试开始前自动调用）、`seed(payload)`、`loadSample({ now, transform })` |
| `evidence` | 自动启用。`evidence.metric(name, value, unit)` 记录性能等指标；`evidence.note(text)` 记录备注 |
| `ext`（UI） | `openPopup / reopenPopup / mockSites / openTabs / seedHistory / setApiBase / useUnreachableBackend / getStorage / setStorage / swEval / snap` |
| 数据工具 | `samplePayload({ now })`（resource.json 时间平移）、`shiftedTime(url, now)`、`historyItem()`、`bulkHistory(n)`、`daysAgo()`、`DAY` |

## 3. 第 1 步：先做「用例 → 脚本」映射，再写代码

对每条用例，先在脑子里（或草稿中）填出下面这张表，**填不出来就说明用例本身有问题**，不要硬写，按第 6 节提交争议：

| 用例字段 | 落到脚本里的形式 |
|---|---|
| `preconditions` | 数据准备：`api.loadSample()` / `api.seed(...)` / `ext.mockSites` / `ext.openTabs`（setup 调用不参与变异检查） |
| `testData` | 文件顶部的常量，或者 `samplePayload({ transform })` |
| `steps[n]` | `await test.step('Sn：…', async () => { …; return 下一步要用的值 })` |
| `expected[n]` | 一个或多个 `expect(实际值, '[En] …').<强匹配器>(期望值)` |
| 期望中的具体值 | 从 resource.json 推算（`shiftedTime`），或者取上一步的响应；不手写时间戳，不手写后端生成的 ID |
| 时间边界（恰好 N 天） | 使用 api-contract 中的时间基准覆盖参数（例如 `?now=`）固定时间；没有的话用 N 天 ± 1 分钟 |

## 4. 第 2 步：按模板写脚本

| 类型 | 模板 | 详细写法 |
|---|---|---|
| API | `assets/templates/api.spec.mjs` | `references/api-e2e-patterns.md` §1–§4 |
| E2E | `assets/templates/e2e.spec.mjs` | `references/api-e2e-patterns.md` §5（编排、传参、状态传递） |
| UI | `assets/templates/ui.spec.mjs` | `references/ui-patterns.md` |
| 断言 | — | `references/assertion-cookbook.md`（expected 句式 → 匹配器速查、强弱对照） |

要点：
- 字段名、状态码、错误码**以 api-contract.json 为准**；契约和用例冲突时，不要自己挑一个，提交争议。
- 被测调用用 `api.get / post / del`；只是为了准备数据的调用用 `api.seed / loadSample`（这样变异检查只变异被测调用）。
- 反例（非法 JSON、错误 Content-Type）用 `api.raw(method, url, '原始字符串')`。夹具会按 Buffer 原样发送；如果直接把字符串放进 `data`，Playwright 会再做一次 JSON 编码，非法 JSON 就变成了合法的 JSON 字符串。
- 数组不关心顺序时，用 `expect.arrayContaining` 或者先 `sort()`；关心顺序时，直接断言整段顺序。
- UI 断言一律用会自动重试的 `await expect(locator).toHaveText / toContainText / toHaveCount / toBeVisible`；需要等待后端状态时用 `await expect.poll(() => api.get(...).then(r => r.body.x)).toBe(…)`。

## 5. 第 3 步：流水线自检（必须全部执行，不能只看自己写的代码）

```bash
S=.agents/skills/nav-case-to-script/scripts
node $S/lint-scripts.mjs TC-API-SYNC-001 TC-API-SYNC-002          # ① 静态检查（不需要产品代码）
node $S/run-cases.mjs --module=SYNC --lint-only                     # ② 静态检查 + Playwright 加载检查（TDD 红灯阶段做到这一步）
node $S/run-cases.mjs TC-API-SYNC-001 --port=4101                   # ③ 执行 + 失败分类 + 证据完整性（产品实现之后）
node $S/run-cases.mjs --type=API --mutation --port=4101             # ④ 断言有效性：变异杀死率（API / E2E，用例全部通过之后）
node $S/run-cases.mjs --type=UI --repeat=3 --port=4102              # ⑤ 稳定性：同一用例重复执行 3 次
```

- 结果：`evidence/_runs/<runId>/summary.json`（同时复制为 `evidence/_runs/latest.json`）；变异结果在 `mutation.json`；`evidence/index.json` 是证据索引。
- 端口按 CONVENTIONS §5 分配，并行运行的 agent 不要共用端口。
- **变异检查的原理**：把被测调用的响应改掉（状态码互换、删数组元素、数组倒序、数字 +1、字符串置空、删字段），用例理应失败；仍然通过就说明断言没约束住这个属性。处理存活变异：优先补强断言（挂到对应的 `[En]` 上）；只有当这个属性确实不在本用例的 expected 范围内时，才写 `// mutation-ignore: <算子> —— 理由`。阈值默认 80%。
- 证据目录 `evidence/<CaseID>/`：`result.json`、`api/NN-*.json`、`server.log`、`screenshots/`、`flow.gif`、`extension.log`；UI 探索 agent 另外写 `explore.json` 和 `explore/`。

## 6. 第 4 步：失败处理

run-cases 会给每个失败打上分类，按 `references/failure-triage.md` 处理：

| 分类 | 含义 | 动作 |
|---|---|---|
| ENV | 后端没起来、端口被占用、浏览器启动失败 | 先修环境，不改脚本 |
| SETUP | reset 接口或数据导入失败 | 后端缺陷或尚未实现（TDD 红灯阶段正常） |
| SCRIPT | 语法、导入错误，getByTestId 匹配到多个元素 | 改脚本 |
| CONTRACT | 取值路径不存在 | 先看 `evidence/<id>/api/` 中的实际响应：不符合契约 → 产品缺陷；符合契约 → 改脚本的取值路径 |
| ASSERTION | `[En]` 断言失败 | 对照用例、契约和证据判断：产品不符合 → 报缺陷；用例或脚本写错 → 提交 testDisputes。**绝不放宽断言** |
| TIMEOUT | UI 一直没出现预期状态 | 看截图判断：产品没渲染 → 缺陷；testId 或流程不对 → 改脚本 |

允许对脚本做的修改：选择器（只能换成 ui-contract 中登记的 testId）、等待方式、前置步骤、流程顺序、补充断言。不允许：删除或放宽 `[En]` 断言、改期望值去迎合实现、加 skip。
脚本被锁定之后（`.workflow/locks/`），任何修改都要经过完整性审查（大 workflow 的 guardTestChanges，或者小 workflow 的第 4 阶段）。

## 7. 批量转换：小 workflow

`workflow/case-to-script.workflow.js`（Claude Code Workflow 格式，与 `.workflow/browser-nav-sdlc.workflow.js` 同一种写法）把第 3–6 节自动化：

- `mode: 'draft'`（默认，产品代码不存在时）：检查基建 → 按 type + module 分批，并行编写脚本 → 每批 lint，加载检查不通过就修，最多 N 轮 → 汇总。
- `mode: 'verify'`（产品代码已经实现时）：在 draft 的基础上，再执行 → 按分类分派修复（只修脚本问题，产品缺陷单独列出）→ 变异检查 → 补强断言 → 测试已锁定时做完整性审查并重新锁定。

调用示例（Workflow 工具）：`{ scriptPath: '.agents/skills/nav-case-to-script/workflow/case-to-script.workflow.js', args: { mode: 'draft', type: 'API' } }`。参数：`cases`、`module`、`type`、`mode`、`batchSize`（默认 6）、`maxFixRounds`（默认 3）、`port`（默认 4160）、`minKill`（默认 0.8）。
不能运行 Workflow 的 agent（trae / codex / worker）按第 3–6 节手动执行同样的循环即可，命令完全相同。

## 8. 完成标准（DoD）

- [ ] 每条目标用例都有 `tests/<type>/<CaseID>.spec.mjs`，lint 0 error，warning 都已处理或说明理由
- [ ] `run-cases.mjs --lint-only` 通过（加载检查通过）
- [ ] 产品已实现时：执行通过，证据完整，API / E2E 变异杀死率 ≥ 80%（被豁免的算子都写了理由），UI 重复执行 3 次稳定
- [ ] 没有修改 `.workflow/`、`server/`、`extension/`；没有删除或放宽任何 `[En]` 断言

## 9. 与大 workflow（`.workflow/browser-nav-sdlc.workflow.js`）的关系

- **阶段 4**：测试基建 agent 复制本技能的资产，第 1 轮调用本技能的小 workflow（`mode: 'draft'`）按用例并行编写脚本；之后按 validator 和评审反馈修订，通过后锁定。
- **阶段 5**：TDD 门禁全绿、UI 探索完成后，调用小 workflow（`mode: 'verify'`）做断言变异检查和补强。改动的测试会经过完整性审查并重新锁定，新的 digest 会回传给大 workflow。补强后暴露出的产品缺陷，会带回 TDD 循环修复（传入 `args.assertionCheck: false` 可以关闭这一步）。
- **门禁**：validator 的 `scripts` 阶段会调用 `lint-scripts.mjs`，并检查「一个 Case ID 一个文件」；`explore` 阶段读取 `evidence/<CaseID>/explore.json`。
