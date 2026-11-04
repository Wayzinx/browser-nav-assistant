# 工作流约定（所有 agent 开工前必读）

本文件与 `.workflow/validators/` 由工作流编排方维护。**任何 agent 不得修改 `.workflow/` 下的任何文件**，只能运行 validator 自检。

## 0. 输入与边界

| 类别 | 文件 | 说明 |
|---|---|---|
| 真相源（只读） | `PROBLEM.md`、`resource.json` | 需求与样例数据，禁止修改 |
| 参考资料 | `docs/01-需求理解.md`、`docs/prototype/engine.js` | 已有的第 1 轮需求理解（含 Q1–Q18 及建议默认值）和原型算法。可借鉴；与 PROBLEM.md 冲突时以 PROBLEM.md 为准，并把取舍写进 PRD 的「决策记录」 |
| 技能（各角色必读） | `.agents/skills/**`（索引：`.agents/skills/README.md`；Claude 系 agent 通过 `.claude/skills` 软链读取） | 各阶段的操作方法、模板、夹具和自检脚本。agent 只读，不修改 |
| 代码规范（开发必读） | `specs/backend.spec.md`、`specs/frontend.spec.md`、`specs/tools/check-spec.mjs` | 后端 / 插件代码怎么写，规则 ID 为 `BE-*` / `FE-*`。agent 只读，不修改 |
| 流程控制（禁止修改） | `.workflow/**` | validators、locks、reports、workflow 脚本 |

各角色开工前，除本文件外还必须读对应的技能或规范：

| 阶段 | 角色 | 必读 |
|---|---|---|
| 1 需求与 PRD | PM | `.agents/skills/nav-req-analysis/SKILL.md` |
| 2 技术方案、5–6 开发 | 后端 | `specs/backend.spec.md` |
| 2 技术方案、5–6 开发 | 前端 | `specs/frontend.spec.md`（特别是 FE-UI-07、FE-TEST-04） |
| 3 用例设计 | 测试设计 | `.agents/skills/nav-test-case-design/SKILL.md` |
| 4 对齐与冻结 | 全部角色 | 本文件 §10、§11 |
| 5 脚本、6 UI 探索 / 仲裁 / 补强 | 测试基建、自动化、探索 | `.agents/skills/nav-case-to-script/SKILL.md`、`references/real-popup-smoke.md`（真实 popup） |
| 7 交付验收 | 测试负责人 | `.agents/skills/nav-quality-report/SKILL.md`、本文件 §12、§13 |

流程编排：`.workflow/browser-nav-sdlc.workflow.js`（v3），阶段为 1 需求与PRD → 2 技术方案 → 3 用例设计 → 4 对齐与冻结 → 5 脚本与开发 → 6 TDD闭环 → 7 交付验收。v2 存档在 `.workflow/archive/`。

自检命令（在项目根目录执行）：

```
node .workflow/validators/validate.mjs <stage> [--brief|--json]
stage: prd | design | modules | cases | board | align | baseline | scripts | skeleton | code | run | gate | mutation | explore
       | smoke | final | manual | freeze | submission | release | toolchain | trace | pack | q | lock | digest | restore
```

结果写入 `.workflow/reports/validate-<stage>.json`，退出码 0 为通过。

## 1. ID 规范

| 类型 | 格式 | 示例 | 归属文档 |
|---|---|---|---|
| 需求点 ID | `REQ-<NNN>` | `REQ-012` | `docs/trace/requirements.json`：PROBLEM.md 中逐字摘录的原始需求点，按出现顺序编号 |
| Feature ID | `F-<MOD>-<NN>` | `F-SYNC-01` | PRD：每个用户动作 / 操作 / 可观察的系统行为一个 ID |
| 验收标准引用 | `F-<MOD>-<NN>#AC<n>` | `F-SYNC-01#AC2` | features.json 中 acceptance 的「AC<n>：」前缀，供用例的 `acceptanceRefs` 引用 |
| 决策 ID | `D-<NN>` | `D-03` | features.json.decisions 与 PRD「决策记录」 |
| Code ID | `C-FE-<MOD>-<NN>` / `C-BE-<MOD>-<NN>` | `C-BE-SYNC-02` | 前 / 后端技术方案：每个可独立实现、可独立测试的技术点一个 ID |
| Case ID | `TC-<API\|E2E\|UI>-<MOD>-<NNN>` | `TC-API-SYNC-001` | 测试用例 |
| 规范规则 ID | `BE-<领域>-<NN>` / `FE-<领域>-<NN>` | `BE-LOG-02` | `specs/*.spec.md`，评审、分诊、争议中引用 |

- `MOD` 为 2–10 位大写字母。**必备模块**：`CTX`（插件加载与上下文读取）、`SYNC`、`RANK`、`REC`、`CLEAN`、`RULE`、`DIAG`、`PRIV`。可选模块示例：`CACHE`（本地缓存 / 离线降级）、`INCR`（增量同步）、`PERF`、`MENU`、`DEMO`（样例数据、启动脚本）、`CFG`。
- ID 中的 `MOD` 必须与对象的 `module` 字段一致。
- ID 一经发布不得改作他用。不做的功能把 `inScope` 置为 `false`，不要重新编号。验收标准 AC 编号同理：发布后只能追加，不能重排。

## 2. 追溯关系（多对多）与硬性规则

```
REQ     ──< requirements[].features >── Feature
Feature ──< code-points[].features >── Code
Feature ──< cases[].features / acceptanceRefs >── Case
Code    ──< cases[].codePoints     >── Case
Code    ──< 源码注释 @code <ID>      >── 实现
Case    ──< tests/<type>/<CaseID>.spec.mjs，标题以 Case ID 开头 >── 自动化脚本 ──> evidence/<CaseID>/ 执行证据
```

以下规则由 validator 强制检查：

1. 每个 `inScope=true` 的 Feature：`layers` 含 `BE` 时，至少有 1 个 C-BE 代码点和 1 个 API/E2E 用例；`layers` 含 `FE` 时，至少有 1 个 C-FE 代码点和 1 个 UI 用例。
2. 每个代码点至少关联 1 个 Feature，并至少被 1 个用例引用。
3. 每个用例至少关联 1 个 Feature 和 1 个代码点；用例引用的每个代码点，其 `features` 必须与该用例的 `features` 有交集。
4. API / E2E 用例只能引用 C-BE 代码点；UI 用例至少引用 1 个 C-FE 代码点。
5. E2E 用例至少 3 个（nav-test-case-design 要求至少 5 个，由门禁中的 check-cases 检查）。每个 E2E 用例至少 3 步，引用的代码点至少跨 2 个模块（真实的端到端链路）。
6. 源码中每个 Code ID 都要在实现处以注释标注：`// @code C-BE-SYNC-02`（写在函数或模块上方；一段代码实现多个点时可写多个 `@code`）。源码中不得出现未登记的 `@code` ID。
7. **一个 Case ID 对应一个测试脚本**（AGENTS.md 约定 2）：脚本路径为 `tests/api/<CaseID>.spec.mjs`、`tests/e2e/<CaseID>.spec.mjs` 或 `tests/ui/<CaseID>.spec.mjs`。文件中每个 test 的标题都以该 Case ID 开头，例如 `test('TC-API-SYNC-001 同步后按 URL 去重', ...)`；参数化变体可以有多个 test，但不能出现其他 Case ID。没有 Case ID 的 test 视为错误。
8. 文档（md）中必须出现其 JSON 里的全部 ID，也不能出现 JSON 中不存在的 ID。
9. 用例 `expected` 第 n 条（以 `En：` 开头）在脚本中至少对应一个断言，断言消息以 `[En]` 开头，例如 `expect(r.status, '[E1] 返回 200').toBe(200)`；用例 `steps` 第 n 条对应 `test.step('Sn：…')`。
10. 每条 mandatory 且 inScope 的 REQ 至少映射到 1 个 inScope Feature；每个 inScope Feature 的每条 AC 至少被 1 个用例的 `acceptanceRefs` 引用。
11. 测试留痕（AGENTS.md 约定 3）统一写入 `evidence/<CaseID>/`，由测试夹具自动生成，见 §3 和 §5。

第 9–10 条以及各技能的补充规则，由 validator 调用技能自带的检查脚本执行（见 §5 末尾的「门禁中的技能检查」）。

## 3. 产物路径

| 阶段 | 产物 | 负责人 |
|---|---|---|
| 1 需求 | `docs/01-需求理解.md`（增量修订）、`docs/02-PRD.md`、`docs/trace/requirements.json`、`docs/trace/features.json` | PM |
| 2 技术方案 | `docs/03-技术方案-后端.md`、`docs/trace/code-points-be.json`、`docs/trace/api-contract.json` | 后端架构师 |
| 2 技术方案 | `docs/04-技术方案-前端.md`、`docs/trace/code-points-fe.json`、`docs/trace/ui-contract.json` | 前端架构师 |
| 2 技术方案 | `docs/05-系统架构.md` | 架构整合 |
| 3 测试用例 | `docs/06-测试用例-接口与E2E.md`、`docs/trace/cases-api.json`（type 为 API / E2E） | API 测试设计 |
| 3 测试用例 | `docs/07-测试用例-UI.md`、`docs/trace/cases-ui.json`（type 为 UI） | UI 测试设计 |
| 4 自动化 | `package.json`、`playwright.config.mjs`、`tests/fixtures/**`（从 `.agents/skills/nav-case-to-script/assets/` 复制）、`scripts/test.sh` | 测试基建 |
| 4 自动化 | `tests/api/<CaseID>.spec.mjs`、`tests/e2e/<CaseID>.spec.mjs`（一个 Case ID 一个文件） | API 自动化 |
| 4 自动化 | `tests/ui/<CaseID>.spec.mjs`（一个 Case ID 一个文件，例如 `tests/ui/TC-UI-SYNC-001.spec.mjs`） | UI 自动化 |
| 5 开发 | `server/**`、`scripts/start.sh`、`resources/sample-history.json` | 后端开发 |
| 5 开发 | `extension/**`（`manifest.json`、`popup/`、`background/`、`content/`） | 前端开发 |
| 5 探索 | `evidence/<CaseID>/explore.json`、`evidence/<CaseID>/explore/*.png`；临时探索脚本放在 `tests/explore/tmp/**` | UI 探索 |
| 4–6 留痕 | `evidence/<CaseID>/`（`result.json`、`api/`、`server.log`、`screenshots/`、`flow.gif`、`extension.log`，由测试夹具自动写入）、`evidence/_runs/`（流水线汇总、变异检查结果）、`evidence/index.json` | 测试夹具 / run-cases.mjs |
| 6 交付 | `README.md`、`docs/08-测试报告.md`、`docs/quality/**`（metrics.json、metrics.md、spec-check-*.json）、`coverage/**`、`docs/trace/matrix.md`（由 validator 生成） | 交付 / 测试负责人 |
| 全程 | `docs/trace/board/<ID>.json`（跨角色看板，§10） | 提出方新建，负责方回填 |
| 2 技术方案 | `docs/trace/modules.json`（模块依赖与开发顺序，§4） | 后端架构师（前端补充需求走看板） |
| 4 对齐 | `.workflow/context/feasibility/<模块组>.md`（可执行性预检）、`.workflow/baseline/<名称>.json`（基线，由 validator 生成） | 自动化 / validator |
| 6 冒烟 | `tests/smoke/smoke-plan.json`（冒烟计划）、`evidence/_smoke/<browser>/<scenario>/`、`evidence/_smoke/summary.json` | 自动化 / smoke-install.mjs |
| 留痕 | `evidence/<CaseID>/state-before.json`、`state-after.json`、`state-diff.json`（后端状态快照与对比，夹具自动生成） | 测试夹具 |
| 7 人工验收 | `evidence/_manual/checklist.md`、`evidence/_manual/step-NN.png` | 人（验收人） |
| 7 冻结与提交 | `.workflow/reports/freeze.json`、`.workflow/submission.json`（预算）、`bundles/`（含 MANIFEST.json） | validator / pack-submission.mjs |

## 4. JSON 结构

### docs/trace/requirements.json（PM 负责，规则见 nav-req-analysis 技能）
```json
{
  "requirements": [{
    "id": "REQ-012", "section": "必做功能 2. 浏览器数据同步到后端",
    "quote": "后端保存页面记录，按 URL 去重",   // PROBLEM.md 原文逐字摘录（只允许去掉 ** 和反引号）
    "kind": "functional",                     // functional | constraint | nfr | acceptance | deliverable | advanced | hint | interview
    "mandatory": true, "inScope": true,
    "features": ["F-SYNC-03"], "note": ""
  }]
}
```

### docs/trace/features.json
```json
{
  "features": [{
    "id": "F-SYNC-01", "module": "SYNC", "name": "点击「同步浏览器上下文」按钮",
    "kind": "action",                 // action | display | system | api | rule | nfr
    "layers": ["FE", "BE"],           // 需要哪一端实现
    "priority": "P0",                 // P0 | P1 | P2 | P3
    "inScope": true,
    "source": "REQ-011、REQ-012；PROBLEM.md 必做功能 2",
    "description": "……",
    "acceptance": ["AC1：Given ……When ……Then ……（可观察的输入 / 输出，尽量写具体值）", "AC2：……"]
  }],
  "decisions": [{ "id": "D-01", "question": "……", "decision": "……", "reason": "……" }]
}
```

### docs/trace/code-points-be.json / code-points-fe.json
```json
{
  "codePoints": [{
    "id": "C-BE-SYNC-01", "side": "BE", "module": "SYNC", "name": "……", "description": "……",
    "files": ["server/src/services/sync.js"],   // BE：server/ scripts/ resources/；FE：extension/
    "symbols": ["upsertPages"],
    "features": ["F-SYNC-01", "F-SYNC-03"],
    "interfaces": ["POST /api/sync"]             // 可选
  }]
}
```

### docs/trace/api-contract.json（后端负责）
```json
{
  "defaultPort": 3000,
  "endpoints": [{
    "method": "POST", "path": "/api/sync",
    "codePoints": ["C-BE-SYNC-01"], "features": ["F-SYNC-01"],
    "request": { "...": "字段 → 类型 / 说明" },
    "response": { "...": "字段 → 类型 / 说明" },
    "errors": [{ "status": 400, "when": "……", "body": { "error": { "code": "…", "message": "…" } } }]
  }]
}
```
路径参数统一写作 `:id`。必须包含：`POST /api/sync`、`GET /api/pages/ranked`、`POST /api/recommendations/next`、`GET /api/pages/cleanup-suggestions`、`POST /api/rules/parse`、`POST /api/rules`、`GET /api/rules`、`DELETE /api/rules/:id`、`GET /api/health`、`GET /api/config`。

### docs/trace/ui-contract.json（前端负责）
```json
{
  "pages": [{ "name": "popup", "path": "extension/popup/popup.html",
    "elements": [{ "testId": "sync-button", "description": "……", "codePoints": ["C-FE-SYNC-01"], "features": ["F-SYNC-01"] }] }],
  "messages": [{ "type": "SYNC_NOW", "request": {}, "response": {}, "codePoints": ["C-FE-SYNC-02"] }],
  "storageKeys": [{ "key": "apiBaseUrl", "description": "……" }]
}
```
`testId` 采用 kebab-case，全局唯一。开发阶段只允许**新增** element / message，不能删除或改名。

### docs/trace/cases-api.json / cases-ui.json（规则见 nav-test-case-design 技能）
```json
{
  "cases": [{
    "id": "TC-API-SYNC-001", "type": "API", "module": "SYNC", "title": "……", "priority": "P0",
    "category": "positive",           // positive | negative | boundary | exception | security | performance | compatibility | state
    "technique": "equivalence",       // equivalence | boundary | decision-table | state-transition | error-guessing | scenario | pairwise
    "features": ["F-SYNC-01"], "acceptanceRefs": ["F-SYNC-01#AC1"], "codePoints": ["C-BE-SYNC-01"],
    "preconditions": ["……（不得引用其他 Case ID）"], "steps": ["S1：……"], "expected": ["E1：……（具体值）"], "testData": "……"
  }],
  "waivers": [{ "feature": "F-DIAG-03", "category": "negative", "reason": "……" }]   // 可选：说明某个必需类别为什么不适用
}
```

### evidence/<CaseID>/explore.json（UI 探索记录）
```json
{ "caseId": "TC-UI-SYNC-001", "verdict": "pass", "observed": "实际观察到的现象",
  "steps": ["实际执行的步骤"], "screenshots": ["evidence/TC-UI-SYNC-001/explore/1.png"],
  "spec": "tests/ui/TC-UI-SYNC-001.spec.mjs", "solidified": true }
```
`verdict` 取值：`pass`（行为符合预期）、`product_bug`（产品缺陷）、`script_stale`（产品正确，但脚本过时，已按固化规则修正）。

### docs/trace/board/<ID>.json（跨角色看板，一条记录一个文件，详见 docs/trace/board/README.md）
```json
{ "id": "B-case-API-RULE-01", "stage": "cases", "from": "TEST", "to": "BE",
  "type": "clarify", "blocking": true,
  "target": "docs/trace/api-contract.json#POST /api/rules", "refs": ["TC-API-RULE-010", "F-RULE-04#AC2"],
  "question": "规则文本超长时契约写 400，错误表写 413，以哪个为准？", "proposal": "统一为 400 VALIDATION_FAILED",
  "status": "open", "resolution": "", "resolvedBy": "", "changedFiles": [], "createdBy": "case-API-RULE#1" }
```
`from` / `to` 取值：`PM`、`BE`、`FE`、`ARCH`、`TEST`、`AUTO`、`DEV-BE`、`DEV-FE`、`HUMAN`；`type`：`clarify`、`change`、`conflict`、`blocker`；`status`：`open`、`answered`、`accepted`、`rejected`、`wontfix`。

### docs/trace/modules.json（模块依赖，后端架构师负责）
```json
{ "modules": [ { "id": "SYNC", "sides": ["BE", "FE"], "dependsOn": [], "reason": "数据入口，其他模块都依赖它写入的页面" },
               { "id": "RANK", "sides": ["BE", "FE"], "dependsOn": ["SYNC"], "reason": "排序读取同步写入的页面" } ] }
```
`validate modules` 检查无环、覆盖全部 inScope 模块，并输出拓扑分层；workflow 按层开发（上游层开发完成后，下游层才开工）。

## 5. 技术栈与已验证的测试配方

- Node v24。后端使用 Node.js ESM，推荐用原生 `http` 零依赖实现（易讲解、免安装）。插件使用 MV3 + 原生 JS，没有构建步骤，`extension/` 目录可以直接「加载已解压的扩展程序」。
- 测试统一使用 `@playwright/test@1.64.1`，分三个 project：`api`（tests/api）、`e2e`（tests/e2e）、`ui`（tests/ui）。`retries: 0`，`workers: 1`，`webServer` 自动启动后端：`PORT=$TEST_PORT ENABLE_TEST_API=1 LOG_FILE=evidence/_runtime/server-<port>.log`，以 `/api/health` 作为就绪检查，并用 `gracefulShutdown: SIGTERM` 停止后端（后端覆盖率依赖正常退出，见 specs BE-RUN-03）。
- **配置和夹具不要从零写**：`playwright.config.mjs` 和 `tests/fixtures/{api,extension,evidence,mutation,sample}.mjs` 从 `.agents/skills/nav-case-to-script/assets/` 复制，这套模板已在本机验证过。脚本从夹具导入 `test` / `expect`（API / E2E 用 `../fixtures/api.mjs`，UI 用 `../fixtures/extension.mjs`），不直接从 `@playwright/test` 导入。
- **端口**：测试后端端口取环境变量 `TEST_PORT`（默认 4100）。并行运行的 agent 必须各用各的端口：gate 用 4100，后端开发 4101，前端开发 4102，API 仲裁 4103，UI 探索 4110 + i。
- **API / E2E 测试**：用 Playwright 的 `request` fixture 对 webServer 启动的真实后端发起真实 HTTP 请求，**禁止 mock / route 后端**。E2E 用例串联多个接口（同步 → 排序 → 推荐 → 规则解析 → 保存 → 整理建议 → 删除规则 → 健康检查等），并在步骤之间断言状态传递。
- **状态隔离**：后端在 `ENABLE_TEST_API=1` 时提供 `POST /api/__test__/reset`，清空内存数据；夹具 `api` 在每个测试开始前自动调用它。样例数据通过真实接口 `POST /api/sync` 导入（`api.loadSample()`），时间戳按 PRD 决策平移，或通过时间基准覆盖参数固定。
- **UI 测试**（本机已验证可行）：
  ```js
  import { chromium } from '@playwright/test';
  const ctx = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = sw.url().split('/')[2];
  await sw.evaluate((u) => chrome.storage.local.set({ apiBaseUrl: u }), `http://127.0.0.1:${PORT}`); // 指向测试后端
  await sw.evaluate(() => chrome.history.addUrl({ url: 'https://github.com/org/repo/pull/456' }));     // 造历史（时间为当前时间）
  await ctx.route('https://github.com/**', r => r.fulfill({ contentType: 'text/html', body: '<title>Mock</title>' })); // 外部站点离线化
  const page = await ctx.newPage(); await page.goto(`chrome-extension://${extId}/popup/popup.html`);   // 以 tab 方式打开 popup
  ```
  - 必须使用 `channel: 'chromium'`（Playwright 自带的 Chromium）。品牌版 Chrome 已不再支持 `--load-extension`。
  - 以 tab 方式打开 popup 时，插件判断「当前页面」必须排除插件自身的页面（前端方案中要给出具体策略）。
  - 只允许 route 外部站点（github.com、developer.mozilla.org 等）；**禁止 route 后端 `/api`、localhost 或 127.0.0.1**。
  - 选择器只用 `getByTestId('<ui-contract 中登记的 testId>')`。
- **测试数据**：`chrome.history.addUrl` 无法指定 visitCount 和访问时间。「旧页面」通过后端样例导入构造（`resource.json` 时间平移，或使用时间基准覆盖参数）。
- **测试留痕**（AGENTS.md 约定 3）：夹具会自动把每个 Case 的证据写入 `evidence/<CaseID>/`，包括：
  - `result.json`（执行结果、失败的 `[En]`）；
  - `api/NN-*.json`（请求和响应，请求头带 `x-request-id: <CaseID>-NN`）；
  - `server.log`（按偏移截取的后端日志）；
  - `screenshots/`（UI 步骤截图）和 `flow.gif`；
  - `extension.log`（service worker 和 popup 的 console 输出）。
  
  脚本只需要在关键步骤调用 `ext.snap(page, '步骤名')`。排查失败时先看证据。
- **后端状态快照**：后端在 `ENABLE_TEST_API=1` 时提供只读的 `GET /api/__test__/state`（BE-RUN-07）。夹具在 reset 之后和用例结束时各取一次，生成 `state-before.json`、`state-after.json`、`state-diff.json`，作为「数据修改前后」的证据。
- **真实安装冒烟**（FE-TEST-04）：以 tab 方式打开 popup 的 UI 用例**不能**代替真实使用。真实的 action popup 视口由内容撑开，焦点和生命周期也不同，Playwright 拿不到这个页面。冒烟用 `.agents/skills/nav-case-to-script/scripts/smoke-install.mjs`（原理见 `references/real-popup-smoke.md`）：
  - 原生 CDP 加 `chrome.action.openPopup()` 打开真实 popup；
  - 全新 profile、storage 为空，不预写任何配置；
  - 冒烟脚本自带生产模式后端（空闲端口、临时数据目录）和转发代理，模拟插件默认的后端地址，不会触碰开发者正在运行的后端；
  - 场景（`tests/smoke/smoke-plan.json`）至少包括：首次安装且后端未启动、首次安装且后端已启动并走完主流程、修改 API 地址；
  - Chromium 必跑；品牌版 Chrome 通过 `--enable-unsafe-extension-debugging` 加 CDP `Extensions.loadUnpacked` 加载，作为可选项（`--browser=all`）。
  
  UI 探索和验收流程探索也要 import `scripts/lib/real-popup.mjs` 打开真实 popup。
- **并行隔离**：并行的开发 / 修复任务各用自己的端口，并设置 `EVIDENCE_DIR=.workflow/context/evidence/<任务键>` 和 `PW_OUTPUT_DIR=.workflow/context/test-results/<任务键>`。只有门禁写正式的 `evidence/` 和 `test-results/`。
- **门禁中的技能检查**：validator 在对应阶段会调用技能自带的检查脚本，它们报出的 error 与 validator 自身的 error 同等对待：

  | 阶段 | 检查脚本 |
  |---|---|
  | `prd` | `nav-req-analysis/scripts/check-requirements.mjs` |
  | `cases` | `nav-test-case-design/scripts/check-cases.mjs` |
  | `scripts` | `nav-case-to-script/scripts/lint-scripts.mjs` |
  | `code` | `specs/tools/check-spec.mjs --side=all` |

  后续阶段会连带执行前面阶段的检查。单个用例的执行、证据检查和断言变异检查用 `node .agents/skills/nav-case-to-script/scripts/run-cases.mjs`。

## 6. TDD 纪律

1. 测试脚本完成评审后会被**锁定**（`.workflow/locks/`）。开发 agent 不得修改 `tests/{api,e2e,ui,fixtures}/**` 和 `playwright.config.mjs`，流程会校验锁的摘要，篡改会被自动还原。如果认为测试本身有错，请在结构化输出的 `testDisputes` 中提交：用例文档或契约原文 vs 断言内容，由仲裁 agent 裁决。
2. 禁止针对测试做特判：例如检测测试环境后返回固定值、硬编码测试数据、吞掉异常。
3. 开发时可以补充代码点的 `files` / `symbols` 字段，但不得修改 ID、`features` 或文档中的追溯关系。
4. **UI 探索与固化**：探索 agent 用临时脚本（`tests/explore/tmp/`）驱动真实插件，逐步执行 UI 用例，截图保存到 `evidence/<CaseID>/explore/`，阅读截图和 DOM 来判断结果，结论写入 `evidence/<CaseID>/explore.json`。
   - 行为符合用例预期但脚本失败（选择器、等待、流程过时）→ 判定为 `script_stale`，修正 `tests/ui/<CaseID>.spec.mjs`（固化）。只允许修改选择器（必须是 ui-contract 中的 testId）、等待策略、前置步骤和流程顺序；**不得删除或放宽**对应用例 `expected` 的 `[En]` 断言，可以新增断言。修改后脚本必须能通过。
   - 行为不符合预期 → 判定为 `product_bug`，附截图和复现步骤，退回前端开发。
   - 脚本通过但探索发现缺陷（说明脚本过弱）→ 判定为 `product_bug`，同时补强脚本断言，使它能捕获该缺陷。
6. **工具链只读**：运行开始时 validator 会锁定 `.agents/skills/**`、`specs/**`、CONVENTIONS、validators、workflow 脚本、`tests/smoke/**`（`toolchain --record`）。每轮门禁前都会检查（`toolchain --check`），发现改动就还原并记为违规。对技能或规范有意见时，提看板记录给 `HUMAN`。
7. **基线之后只走变更请求**：对齐阶段冻结基线以后，PRD、features、requirements、契约、代码点、modules、用例的每一处修改，都必须有一条 `type=change` 且 `status=accepted` 的看板记录覆盖（`baseline --check`），并且要为受影响的角色新建 change 记录。
8. **不猜、不绕**：上游信息不清楚、上游模块没实现时，提看板记录给负责人，不要自己推断，也不要用桩绕开。分诊时，根因在上游的失败分派给上游模块。
5. **断言有效性**：API / E2E 用例通过之后，用 `run-cases.mjs --mutation` 做响应变异检查，默认要求杀死率 ≥ 80%。处理存活变异时：
   - 优先补强对应 `[En]` 的断言；
   - 只有当该属性不在本用例任何一条 expected 的范围内时，才允许写 `// mutation-ignore: <算子> —— 理由`。
   
   补强属于「新增断言」，同样要经过测试完整性审查。

## 7. 会话与上下文管理（v2 编排）

| 层级 | 内容 | 怎么用 |
|---|---|---|
| L0 常驻 | `AGENTS.md`、本文件、角色对应的 SKILL.md / spec | 每个节点开工先读 |
| L1 角色记忆 | `.workflow/context/journal/<任务键>.md` | 同一角色 × 模块组的跨轮记忆（当前状态 / 关键决策 / 坑 / 待办，≤ 60 行，每次结束时**覆盖重写**） |
| L2 任务切片 | `.workflow/context/packs/<MOD>.md`（`validate.mjs pack` 生成） | 本模块的 Feature + AC、代码点、文件所有权、契约摘录、用例、文档行号定位、当前失败。**先读切片，不要整篇读 PRD / 方案** |
| L3 按需检索 | `node .workflow/validators/validate.mjs q <F-/C-/TC- ID 或模块名>`、`sed -n '起,止p'`、`evidence/<CaseID>/` | 只在需要原文时读取 |

- 降噪：测试输出只看摘要（`validate.mjs run --module=M --brief`，或 `run-cases.mjs` 的人类可读摘要），细节去 `evidence/<CaseID>/` 看；大文件按行号区间读；截图只在需要判断时读。
- `.workflow/` 中只有 `.workflow/context/**`（briefs、journal、sessions、handoff、logs）允许 agent 写入，其余仍然禁止修改。
- 用例分片（并行设计时）：每个设计 agent 只写 `docs/trace/cases/<API|UI>-<MOD>.json` 与 `docs/cases/<API|UI>-<MOD>.md`（E2E 写 `docs/trace/cases/E2E.json`、`docs/cases/E2E.md`，模块名用 `FLOW`）。`cases-api.json`、`cases-ui.json`、docs/06、docs/07 由 `validate.mjs merge-cases`（`cases` 阶段会自动执行）生成，不要直接编辑。
- 文件所有权：`validate.mjs pack` 生成 `.workflow/context/packs/ownership.json`。多个模块共用的文件归 `CORE`（由 lead 维护）；模块开发只改本模块文件，需要改共享文件时写进 `blockedBy`。

## 8. 执行引擎（AGENTS.md）

| 任务类型 | 首选引擎 | 备选 |
|---|---|---|
| 开发（lead、模块开发、缺陷修复） | `codex exec -m gpt-6.1-sol -c model_reasoning_effort='"max"'`（续聊：`codex exec resume <session>`） | `traecli exec`（GPT-6.1-Sol）→ Claude 自己完成 |
| 测试（用例设计、脚本编写 / 修复 / 补强、质量报告） | worker：`claude -p --output-format json`（续聊：`--resume <session_id>`） | Claude 自己完成 |
| 评审、分诊、仲裁、完整性审查、UI 探索（需要看截图）、校验执行 | Claude | — |

外部引擎由 Claude「调度与验收者」调用：写简报（`.workflow/context/briefs/<任务键>.md`）→ 派发 → 按完成定义亲自验收 → 不达标就续聊同一会话 → 会话信息写入 `.workflow/context/sessions/<任务键>.json`。

## 9. 端口分配（v2）

| 用途 | 端口 |
|---|---|
| 门禁 / 终检 | 4100 |
| 后端 lead / 前端 lead | 4101 / 4102 |
| API 仲裁 | 4103 |
| 变异检查 | 4105 |
| 骨架检查 | 4198；`--list` 4199 |
| 模块组 g 的后端开发 / 前端开发 | 4200 + g / 4220 + g |
| 模块组 g 的后端修复 / 前端修复 | 4240 + g / 4260 + g |
| UI 探索 i | 4180 + i |
| 全量回归（人工 / 调试） | 4300 |
| 打包自检中的样例执行 | 4320 段 |
| 真实安装冒烟 | 自动选择空闲端口（后端、代理、静态页），永远不用 3000 |

## 10. 跨角色看板（agent 之间的沟通通道）

v2 的教训：技术方案写给测试的提醒只存在于架构师自己的 journal 里；用例设计遇到契约冲突只能自己绕开；争议拖到开发阶段才暴露。v3 规定，**任何需要其他角色澄清或修改的事项都必须进看板**。

- 一条记录一个文件 `docs/trace/board/<ID>.json`，ID 建议为 `B-<提出方任务键>-<两位序号>`。并行 agent 各写各的文件，互不冲突。结构见 §4。
- 提出方：写清 to、target、refs、question，能给建议时写 proposal；会卡住自己工作的标 `blocking: true`。
- 负责方：workflow 会把 open 状态的记录路由给对应角色（PM / BE / FE / ARCH / TEST / AUTO / DEV-BE / DEV-FE）。负责方按权威顺序 PROBLEM.md > PRD > 契约 > 用例 > 脚本 裁决，修改自己负责的文件，回填 status、resolution、resolvedBy、changedFiles。修改会影响其他角色时，要为受影响的角色新建 change 记录（例如契约改了 → TEST 和 AUTO）。
- `to=HUMAN` 的记录由人处理（workflow 汇总在 needsHuman 里）。阻塞的 HUMAN 记录会让对应阶段停下来。
- journal 和 openQuestions 只记录自己的状态，不能代替看板。
- 校验：`validate board`（格式、refs 是否存在）；`validate board --freeze=<阶段>`（该阶段及之前不能有 blocking 且 open 的记录）。

## 11. 对齐与基线冻结（写脚本和开发之前）

PRD、技术方案、用例三方的信息对齐之后，才进入「脚本 → 开发 → TDD」：

1. **可执行性预检**：自动化工程师按模块组逐条检查用例能否写成具体断言（接口、字段、错误码、testId、数据构造、时间固定），结论写到 `.workflow/context/feasibility/`，缺口一律提 blocking 看板。
2. **对齐评审**：产品、后端、前端、测试四个视角并行评审，阻塞问题直接提看板。
3. **确定性对齐**（`validate align`）：
   - 用例中的接口、错误码必须在契约中存在；
   - 用例中的 testId、消息、storage key 必须在 ui-contract 中存在；
   - 前端方案和代码点调用的接口必须在契约中存在；
   - 契约内部不能有冲突（同一错误码对应多个状态码等）；
   - AC 全部被用例覆盖。
4. **收敛**：workflow 把看板和对齐错误路由给负责人修订，直到 `align` 通过且没有阻塞的看板记录，然后执行 `validate baseline --record=aligned` 冻结基线。不收敛就停下来，交给人决定。
5. **冻结之后**：见 §6 第 7 条。workflow 每轮门禁前会执行 `baseline --check`。

## 12. 真实安装冒烟与人工验收

- **冒烟**：TDD 门禁全绿、UI 探索和变异检查通过之后，执行 `validate smoke`，见 §5。失败按插件端 / 后端退回开发。
- **人工验收关卡**：终检和交付验收都通过后，workflow 生成 `evidence/_manual/checklist.md`（`validate manual --init`），然后以 `awaiting_manual_acceptance` 状态暂停。验收人在**自己的浏览器**里：
  1. 在 chrome://extensions 加载 extension/，按 README 启动后端；
  2. 点击工具栏图标，走完 PROBLEM.md 验收第 1–10 步；
  3. 每一步截图到 `evidence/_manual/step-NN.png`，勾选结论并签字。
  
  然后用 `args: { from: 'final', manualAccepted: true, digest }` 续跑，workflow 用 `validate manual --check` 核对。

## 13. 代码冻结与提交

- 人工验收通过后执行 `validate freeze --record`，记录 extension/、server/、scripts/、resources/ 的摘要。之后任何代码改动，都要重跑门禁、冒烟和人工验收（`freeze --check` 会拦住）。
- **提交预检**（`validate submission`，内部调用 `.workflow/tools/pack-submission.mjs --json`）：
  - 按平台预算打包到临时 staging 目录。预算写在 `.workflow/submission.json`：最多 200 个文件、单个文件不超过 1MB、总计不超过 10MB；
  - 截图去重并转成 JPEG，压缩证据；
  - 在临时目录解包后重算证据完整率，检查报告链接，核对冻结摘要；
  - 加 `--check-upload` 时，同时检查平台的上传日志里有没有失败。
  
  `validate release` = `freeze --check` + `manual --check` + `submission`，是交付前的最后一关。
- **真正替换项目目录**（`pack-submission.mjs --apply --yes`）会删除被打包的原目录，属于不可逆操作：只能由人确认后执行，而且必须先把完整的开发状态备份到上传根目录之外（`--backup=`）。
