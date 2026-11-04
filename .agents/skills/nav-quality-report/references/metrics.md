# 质量指标口径与准出标准

所有指标都由 `scripts/collect-metrics.mjs` 计算，写入 `docs/quality/metrics.json`。比率型指标的结构统一为 `{ num, den, value }`，其中 `value = num / den`（保留 4 位小数）；分母为 0 或数据缺失时，`value = null`，并带上 `na`（原因），报告中显示为「未采集」。

## 0. 公共口径

| 概念 | 口径 |
|---|---|
| inScope Feature | `features.json` 中 `inScope === true` 的 Feature |
| 相关代码点 | `features` 中至少关联了 1 个 inScope Feature 的代码点（与 validator 相同） |
| 用例状态 | 按用例逐个取值，优先级：`.workflow/reports/case-status.json`（validator） > `evidence/_runs/latest.json`（run-cases 最近一次运行） > `evidence/<CaseID>/result.json`。都没有时记为 `not_run`。各来源的命中数量见 `cases.statusSource` |
| 通过 | 状态为 `pass`。`flaky`、`fail`、`not_run` 都不算通过 |
| 已执行 | 状态为 `pass` / `fail` / `flaky` |

## 1. 需求覆盖

| 指标（metrics.json 字段） | 分子 / 分母 | 数据来源 |
|---|---|---|
| 需求点覆盖率 `requirements.coverage` | 至少关联 1 个 inScope Feature 的 REQ / inScope 的 REQ（`inScope !== false`） | requirements.json、features.json |
| mandatory 需求点覆盖率 `requirements.mandatoryCoverage` | 同上，只统计 `mandatory === true` 的 REQ | 同上 |
| 需求点验证率 `requirements.verified` | 已覆盖、且关联的 inScope Feature 全部「已验证」的 REQ / inScope 的 REQ | 同上 + 用例状态 |
| Feature 设计覆盖率 `features.designCoverage` | `layers` 中的每一层都至少有 1 个对应 side 的代码点的 Feature / inScope Feature | features.json、code-points-*.json |
| Feature 用例覆盖率 `features.caseCoverage` | 含 BE 层时至少有 1 条 API / E2E 用例、含 FE 层时至少有 1 条 UI 用例的 Feature / inScope Feature（与 validator 规则 1 相同） | features.json、cases-*.json |
| Feature 验证通过率 `features.verified` | 用例覆盖达标、且关联的用例全部通过的 Feature / inScope Feature | 同上 + 用例状态 |
| P0 Feature 验证率 `features.p0Verified` | 同上，只统计 `priority === 'P0'` | 同上 |
| 按优先级 / 按模块 `features.byPriority` / `byModule` | 每组的 total / designCovered / caseCovered / verified | 同上 |
| AC 覆盖率 `acceptance.coverage` | 被至少 1 条用例的 `acceptanceRefs` 引用的 AC / inScope Feature 的全部 AC。AC 编号取 acceptance 文本开头的 `AC<n>`，没有前缀时按顺序编号，键为 `F-XXX-NN#AC<n>` | features.json、cases-*.json |
| AC 验证率 `acceptance.verified` | 被至少 1 条已通过用例引用的 AC / 全部 AC | 同上 + 用例状态 |

所有用例都没有 `acceptanceRefs` 字段时，AC 指标为「未采集」。

## 2. 代码追溯（Code ID）

| 指标 | 分子 / 分母 | 数据来源 |
|---|---|---|
| Code ID 用例覆盖率 `codePoints.caseCoverage` | 被至少 1 条用例的 `codePoints` 引用的代码点 / 相关代码点 | code-points-*.json、cases-*.json |
| Code ID 验证通过率 `codePoints.verified` | 被引用、且引用它的用例全部通过的代码点 / 相关代码点 | 同上 + 用例状态 |
| @code 标注率 `codePoints.annotated` | 源码中有 `@code <ID>` 标注的代码点 / 相关代码点。扫描范围为 `server/`、`extension/`、`scripts/` 下的 js / mjs / cjs / html / css / sh 文件，正则与 validator 相同 | 源码 |
| 分端统计 `codePoints.be` / `codePoints.fe` | 同上，分别只统计 BE / FE | 同上 |
| 未登记的标注 `codePoints.unregisteredInSource` | 源码中出现、但 code-points 中没有登记的 ID（validator 会把它判为错误） | 源码 |

## 3. 测试执行

| 指标 | 口径 |
|---|---|
| `cases.passRate` | 通过的用例数 / 用例总数（以 Case 为单位：一个 Case 下的 test 全部通过才算通过） |
| `cases.p0PassRate` | 只统计 `priority === 'P0'` 的用例 |
| `cases.byType` / `byModule` / `byPriority` / `byCategory` | 每组的 total / pass / fail / flaky / not_run。`category` 来自用例设计（positive / negative / boundary / exception / security / performance / compatibility / state），没有填写时记为「未标注」 |
| `cases.open` | 所有没有通过的用例 |

## 4. 代码行覆盖率

来源：`coverage/summary.json`（由 `collect-coverage.mjs` 生成，基于一次 api + e2e + ui 的全量执行）。

| 指标 | 口径 |
|---|---|
| `coverage.be.lines / branches / functions / statements` | c8（V8 覆盖率）统计 `server/**` 的全部文件（`--all`：没有加载过的文件按 0 计入）。`pct` 为百分数（0–100） |
| `coverage.fe.*` | istanbul 统计 `extension/**` 的全部 JS 文件（没有执行过的文件按插桩时的初始覆盖率计入，即 0）。只采集 service worker 和插件页面（popup 等）；content script 没有导出途径，计为 0 |
| `coverage.*.lowFiles` | 行覆盖率低于 50% 的文件 |

## 5. 断言有效性

| 指标 | 口径 | 来源 |
|---|---|---|
| `[En]` 标签覆盖率 `assertions.tagCoverage` | 有对应 `[En]` 断言的 expected 条目数 / 全部用例的 expected 条目数 | lint-scripts.mjs |
| 弱断言数 `assertions.weakAssertions` | 只用了 toBeTruthy / toBeDefined / > 0 之类断言的 `[En]` 数量 | lint-scripts.mjs |
| 变异杀死率 `assertions.mutation.killRate` | 被用例发现（测试失败）的变异 / 实际生效的变异，只统计基线通过的 API / E2E 用例。算子：status、drop-item、reverse、num-shift、str-blank、drop-key（含义见 `nav-case-to-script/assets/fixtures/mutation.mjs`） | evidence/_runs/mutation-latest.json |
| `assertions.mutation.survived` | 每个用例存活的变异算子 | 同上 |

## 6. 证据完整性

`evidence.completeness` = 证据完整的已执行用例 / 已执行用例。「完整」的判定见 `run-cases.mjs` 中的 `evidenceStatus`：

- 所有用例：有 `result.json`、非空的 `server.log`；
- API / E2E：`api/` 中至少有 1 个被测调用（setup 以外的请求）；
- UI：`screenshots/` 中至少有 1 张截图（.png / .jpg），开发环境口径下还要求有 `flow.gif`。

**两个口径**：
- `evidence.completeness`：开发环境 `evidence/` 的完整率；
- `evidence.packaged.completeness`：提交包解包后的完整率，由 `.workflow/tools/pack-submission.mjs` 在临时目录解包复核后写入 MANIFEST 的 `evidence`。这个口径下截图已转成 JPEG，非验收用例的 flow.gif 可能按预算裁剪，裁剪记录在 MANIFEST 的 `dropped` 中，gif 不再是必需项。

**准出采用 `evidence.exitCompleteness`**：有提交包时取提交包口径，否则取开发环境口径，并标注「尚未打包」。原因是评审者拿到的是提交包。上一次交付时，截图在手工打包环节被整批删掉，开发环境里看到的 100% 在提交包里只剩 227/370。

**后端状态快照覆盖率** `evidence.stateCoverage`：分母是已执行用例，分子是同时具备 `state-before.json`、`state-after.json`、`state-diff.json` 的用例。这三个文件由夹具在用例前后调用 `GET /api/__test__/state`（BE-RUN-07）生成，用来证明「数据修改前后的查询结果」。

## 6b. 真实安装冒烟

`smoke.requiredPass` = chromium 必需场景中通过的数量 / chromium 必需场景总数，数据来自 `evidence/_smoke/summary.json`（`smoke-install.mjs` 生成）。冒烟用全新 profile、空 storage，通过 CDP 调用 `chrome.action.openPopup()` 打开真实的 action popup，断言 popup 尺寸、关键元素可见、零异常，并走完主流程。品牌版 Chrome 为可选项：结果为 skipped 时不影响判定，但报告中要写明原因。

这是测试形态补位：UI 用例以 tab 方式打开 popup，测不到真实弹窗按内容撑开的尺寸语义。上一次交付时，popup 在真实点击图标后塌缩成 25×25 的空白小块，389 个测试全部通过却都没有发现。

## 7. 缺陷与过程、规范、性能

| 指标 | 来源 |
|---|---|
| `process.gates`：TDD 每轮门禁的测试总数 / 通过 / 失败 / 校验错误数 | `.workflow/reports/gate-iter-*.json` |
| `process.explore`：UI 探索结论分布（pass / product_bug / script_stale / 无记录） | `evidence/<CaseID>/explore.json` |
| `process.openProductBugs` | 探索结论为 product_bug 的用例 |
| `process.validatorFinal` | `.workflow/reports/validate-final.json` |
| `spec.be` / `spec.fe`：规范检查的 error / warning 数 | `docs/quality/spec-check-be.json` / `spec-check-fe.json` |
| `performance` | `evidence/*/result.json` 中 `tests[].metrics`（用例通过 `evidence.metric(name, value, unit)` 记录） |

## 8. 准出标准

| 编号 | 类型 | 指标 | 默认阈值 |
|---|---|---|---|
| H1 | 硬性 | P0 Feature 验证率 `features.p0Verified` | = 100% |
| H2 | 硬性 | mandatory 需求点覆盖率 `requirements.mandatoryCoverage` | = 100% |
| H3 | 硬性 | P0 用例通过率 `cases.p0PassRate` | = 100% |
| H4 | 硬性 | 整体用例通过率 `cases.passRate` | ≥ 95% |
| H5 | 硬性 | Code ID 用例覆盖率 `codePoints.caseCoverage` | = 100% |
| H6 | 硬性 | @code 标注率 `codePoints.annotated` | = 100% |
| H7 | 硬性 | 证据完整率（提交包口径）`evidence.exitCompleteness` | = 100% |
| H8 | 硬性 | 真实安装冒烟（chromium 必需场景）`smoke.requiredPass`，并且 summary 的 pass=true | = 100% |
| T1 | 目标 | 后端行覆盖率 `coverage.be.lines` | ≥ 80% |
| T2 | 目标 | 后端分支覆盖率 `coverage.be.branches` | ≥ 65% |
| T3 | 目标 | 前端行覆盖率 `coverage.fe.lines` | ≥ 60% |
| T4 | 目标 | 变异杀死率 `assertions.mutation.killRate` | ≥ 80% |
| T5 | 目标 | `[En]` 标签覆盖率 `assertions.tagCoverage` | = 100% |
| T6 | 目标 | spec-check error 数（BE + FE） | ≤ 0 |
| T7 | 目标 | 后端状态快照覆盖率 `evidence.stateCoverage` | ≥ 90% |

判定：任意一项硬性条件未达标 → **不准出**；硬性条件全部达标、但有目标条件未达标 → **有条件准出**（报告中必须列出准出条件）；全部达标 → **准出**。「未采集」一律视为未达标。

阈值覆盖：`docs/quality/exit-criteria.json`，例如 `{ "thresholds": { "H4": 0.98, "T1": 0.85 } }`（比例用 0–1 的小数；T6 是 error 数的上限）。覆盖过的编号会显示在报告中，并且必须在报告正文中说明理由。

## 9. 取舍说明（面试 / 评审时可能被问到）

- **以 Case 为单位计算通过率**：AGENTS.md 规定一个 Case 对应一个脚本，Case 是需求追溯的最小单元。一个 Case 下有多个参数化 test 时，任意一个失败，整个 Case 就算失败。
- **Feature「已验证」要求所有关联用例都通过**：任何一条正例、反例或边界用例失败，都说明需求没有被完全满足。
- **变异检查只做 API / E2E**：UI 用例如果要做变异，就得拦截后端，这违反了「禁止 route 后端」的约定。UI 断言的有效性由 UI 探索 agent 的截图核对和 lint 规则来保证。
- **证据完整率以提交包为准、冒烟是硬性条件**：前者保证评审者真的能看到证据，后者保证用户真的能用上产品。两者都是上一次交付中实际发生过的漏洞，所以都设为硬性条件。
- **覆盖率是目标条件，不是硬性条件**：行覆盖率衡量的是「代码被执行过」，不代表「行为被验证过」。真正的硬性约束是需求和 Code ID 的追溯覆盖，以及用例全部通过。
