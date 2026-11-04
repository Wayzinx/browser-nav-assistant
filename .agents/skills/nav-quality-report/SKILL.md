---
name: nav-quality-report
description: 浏览器导航助手项目的「需求准出质量报告」编写流程。在需求开发和测试完成后，用客观数据评估能否准出，并产出 docs/08-测试报告.md。数据包括：需求点 / Feature ID / AC / Code ID 的覆盖率和验证率、用例执行结果、前后端代码行覆盖率、断言有效性（[En] 标签和变异杀死率）、真实安装冒烟结果、证据完整率（以提交包为准）与后端状态快照覆盖率、TDD 过程和缺陷、规范符合度。触发场景：写质量报告、准出报告、测试报告、提测 / 准出评估、覆盖率统计、需求覆盖度、追溯覆盖率、阶段 6 交付验收。
---

# 需求准出质量报告（nav-quality-report）

目标：用**可复算的客观数据**回答「这个需求能不能准出」。报告中的每一个数字都来自脚本生成的 `docs/quality/metrics.json`，agent 只负责解读和分析，不手算、不估算、不美化。

先读：`AGENTS.md`、`.workflow/CONVENTIONS.md`（ID 体系、产物路径），以及 `references/metrics.md`（指标口径和准出阈值）。

## 产物

| 产物 | 生成方式 |
|---|---|
| `coverage/summary.json`、`coverage/be/`、`coverage/fe/` | `scripts/collect-coverage.mjs` |
| `evidence/_runs/mutation-latest.json` | `nav-case-to-script` 的 `run-cases.mjs --mutation` |
| `evidence/_smoke/summary.json` | `nav-case-to-script` 的 `smoke-install.mjs`（真实 action popup、首次安装、空 storage） |
| 提交包 staging + `bundles/MANIFEST.json` | `.workflow/tools/pack-submission.mjs`（dry run，不改项目） |
| `docs/quality/metrics.json`、`docs/quality/metrics.md` | `scripts/collect-metrics.mjs` |
| `docs/08-测试报告.md` | agent 按 `references/report-template.md` 编写；其中的指标区块由 `--inject` 自动写入 |

只写上面这些文件。不改业务代码、测试脚本、`docs/trace/*.json` 和 `.workflow/**`。报告里发现的问题写进「遗留问题与风险」，由流程分派给对应的负责人。

## 流程

下面的命令都在项目根目录执行。`$Q` = `.agents/skills/nav-quality-report/scripts`，`$C` = `.agents/skills/nav-case-to-script/scripts`。

### 1. 前置检查（不满足就停下来报告，不要硬写报告）

- `docs/trace/` 下有 features.json、code-points-be/fe.json、cases-api/ui.json；最好还有 requirements.json（没有的话，REQ 指标会是「未采集」）。
- 已经执行过全量测试：`.workflow/reports/case-status.json`（validator `run` / `gate` / `final` 生成），或者 `evidence/_runs/latest.json`（run-cases 生成）。都没有时，先执行 `node .workflow/validators/validate.mjs run`。
- 依赖：`npm ls c8 istanbul-lib-instrument istanbul-lib-coverage istanbul-lib-report istanbul-reports`。缺少的话执行 `npm i -D c8 istanbul-lib-instrument istanbul-lib-coverage istanbul-lib-report istanbul-reports`。
- 规范检查结果：`node specs/tools/check-spec.mjs --side=all`（如果存在），它会生成 `docs/quality/spec-check-*.json`。
- 真实安装冒烟：`node $C/smoke-install.mjs --browser=chromium`，生成 `evidence/_smoke/summary.json`。没有它，H8 记为「未采集」，结论只能是「不准出」。

### 2. 采集代码行覆盖率

```bash
node $Q/collect-coverage.mjs --port=4130
```

- 全量执行一遍 api / e2e / ui。后端通过 `NODE_V8_COVERAGE` + c8 采集；前端先插桩 `extension/`，再让 UI 测试加载插桩后的副本采集。这次执行的证据写到 `coverage/.evidence/`，不会污染正式证据。
- 后端覆盖率为空：通常是后端收到 SIGTERM 后没有退出（见 `specs/backend.spec.md` BE-RUN-03），或者 playwright.config 没配置 `gracefulShutdown`。这时如实记为「未采集」，并写进风险，**不要编造数字**。
- 前端覆盖率只统计 service worker 和插件页面中执行过的代码；content script 等没有导出的目标会算作 0%。

### 3. 断言有效性（变异检查）

```bash
node $C/run-cases.mjs --all --mutation --port=4133
```

一次跑完全部用例（每次运行都会覆盖 `evidence/_runs/mutation-latest.json`，所以不要按类型分多次运行）。只对执行通过的 API / E2E 用例做变异，UI 用例会自动排除。夹具会对用例自己发起的调用的响应做变异（setup 调用不受影响），然后看用例能否发现：

- `survived` 中列出的算子，说明断言没有约束住对应的属性；
- 脚本中用 `// mutation-ignore: <op> —— <理由>` 声明过的算子记为「已豁免」，不计入分母。报告中要列出豁免项，评审时检查理由是否成立。

### 4. 提交包预检（证据完整率以提交包为准）

```bash
node .workflow/tools/pack-submission.mjs --json --check-upload > /tmp/pack.json   # dry run：在临时目录生成 staging 并解包复核
```

评审者拿到的是提交包，不是你的开发目录：平台限制最多 200 个文件、单个文件不超过 1MB、总计不超过 10MB，截图会被去重并转成 JPEG，超出预算时还会逐级裁剪（每一级都记在 MANIFEST 的 `levelsApplied` / `dropped` 中）。所以证据完整率、文档里的证据链接，都必须按**提交包解包后**的结果来算。记下输出中的 `manifestPath`。

### 5. 汇总指标

```bash
node $Q/collect-metrics.mjs --manifest=<上一步的 manifestPath>
```

不传 `--manifest` 时，脚本依次查找 `bundles/MANIFEST.json`、`.workflow/reports/validate-submission.json` 中记录的路径；都找不到时，证据完整率退回开发环境口径，并在报告中标明「尚未打包」。

产出 `docs/quality/metrics.json`（完整数据）和 `docs/quality/metrics.md`（报告用的表格），并按准出标准给出 `exit.verdict`：

- **不准出**：任意一项硬性条件（H1–H8）未达标。H7 证据完整率采用提交包口径；H8 要求真实安装冒烟的 chromium 必需场景全部通过；
- **有条件准出**：硬性条件全部达标，但有目标条件（T1–T7）未达标。T7 是后端状态快照覆盖率（`state-before/after/diff.json`）。报告中必须逐条写明准出条件（谁负责、什么时候补齐）；
- **准出**：全部达标。

「未采集」的指标一律不算达标。阈值的调整只能通过 `docs/quality/exit-criteria.json`（`{ "thresholds": { "H4": 0.98 } }`），并且要在报告中说明理由和批准人。

### 6. 编写报告

1. 第一次编写时，把 `references/report-template.md` 复制为 `docs/08-测试报告.md`。之后在原文件上更新，保留 `<!-- METRICS:BEGIN -->` / `<!-- METRICS:END -->` 标记。
2. `node $Q/collect-metrics.mjs --inject`：把 metrics.md 写进自动区块。
3. 在自动区块**之外**撰写分析：结论与依据、风险、遗留问题、改进建议。写作要求：
   - 引用的数字必须与自动区块中的写法完全一致（例如 `92.3%`、`12/13`），不能四舍五入改写，也不能自己计算新的百分比；
   - 每个未达标项都要写清楚：根因（结合 evidence/<CaseID>/ 中的证据）、影响范围（受影响的 Feature ID / REQ）、处理意见；
   - 未通过的用例逐条给出证据链接 `evidence/<CaseID>/`（result.json、api/、screenshots/、flow.gif、server.log、state-diff.json）；
   - 「代表性证据」一节由自动区块生成（冒烟截图、验收流程记录、P0 UI 用例的首末截图），正文只做解读，不要手写指向不存在文件的链接——提交包自检会把无法解析的证据引用判为错误；
   - 第 1 节的「准出结论：**<结论>**」必须与 `metrics.exit.verdict` 一致。
4. 分析时重点关注这些信号（只有数据支持时才写）：
   - Feature 已覆盖但未验证 → 列出失败用例和它们的证据；
   - Code ID 没有被用例引用 → 说明这部分实现没有被测到，属于风险；
   - P0 用例的类别只有 positive → 说明反例 / 边界覆盖不足；
   - 存活变异集中在 `reverse` → 排序没有被断言；集中在 `status` → 没有断言状态码；
   - 某个文件的行覆盖率低于 50% → 结合 Code ID 判断是死代码还是缺少用例；
   - TDD 轮次中失败数一直不下降 → 说明需求或契约有分歧。

### 7. 自检

```bash
node $Q/collect-metrics.mjs --inject --check-report
```

`--check-report` 检查三件事：自动区块是最新的；正文中的结论与 verdict 一致；正文中出现的每个百分比和「a/b」形式的数字都能在 metrics.md 中找到。退出码非 0 时修正报告后重跑，直到通过。

另外，自己逐条确认：

- [ ] 报告中出现的所有 ID（F- / C- / TC- / REQ-）都真实存在；
- [ ] 每个 ❌ 项都有根因、影响和处理意见，有条件准出时还列出了准出条件；
- [ ] 「如何复现」一节中的命令可以直接复制执行；
- [ ] 再跑一次 `node .workflow/tools/pack-submission.mjs`：报告中的链接和证据引用在提交包中都能解析，证据完整率与报告一致；
- [ ] 没有修改报告以外的任何文件（`docs/quality/`、`coverage/`、`evidence/_runs/` 中由脚本生成的文件除外）。

## 结构化输出（被工作流调用时）

`summary`（结论 + 关键指标，数字来自 metrics.json）、`files`（docs/08-测试报告.md、docs/quality/metrics.json、docs/quality/metrics.md、coverage/summary.json）、`openQuestions`（需要人工决策的事项，例如阈值豁免）。

## 常见问题

| 现象 | 处理 |
|---|---|
| REQ 指标为「未采集」 | 缺少 docs/trace/requirements.json，属于需求阶段（nav-req-analysis）的遗漏，在风险中写明 |
| AC 覆盖率为「未采集」 | 用例没有填写 acceptanceRefs，属于用例设计阶段（nav-test-case-design）的遗漏 |
| 用例状态来源是 evidence | 没有全量执行的记录，结论只代表部分执行；先执行 `validate.mjs run` 再生成报告 |
| 证据不完整 | 看 metrics.evidence.incomplete：缺 server.log → 后端没实现 LOG_FILE；缺 flow.gif → 没装 pngjs / gifenc；只在提交包口径下不完整 → 看 MANIFEST 的 dropped 与预算占用，调整 `.workflow/submission.json` 或减少冗余证据，不要手工删文件 |
| H8 未采集 / 未通过 | 运行 smoke-install.mjs；尺寸断言失败（例如 popup 只有 25×25）说明真实弹窗塌缩，属于产品缺陷（见 specs/frontend.spec.md 中 popup 尺寸规则） |
| T7 状态快照覆盖率低 | 后端没有提供 GET /api/__test__/state（BE-RUN-07），或者夹具版本过旧 |
| 覆盖率采集中有测试失败 | 覆盖率会偏低；先修复失败，或者在报告中注明 |
