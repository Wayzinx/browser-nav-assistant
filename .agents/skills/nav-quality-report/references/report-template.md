# 浏览器导航助手 · 需求准出质量报告

> 模板来源：`.agents/skills/nav-quality-report/references/report-template.md`。第一次编写时复制为 `docs/08-测试报告.md`。
> 规则：`<!-- METRICS:BEGIN -->` 与 `<!-- METRICS:END -->` 之间的内容由 `collect-metrics.mjs --inject` 自动生成，不要手改。正文中引用的数字必须与自动区块中的写法完全一致。尖括号 `<…>` 中的内容按实际情况替换，替换完删掉本段说明。

## 1. 结论

准出结论：**<准出 / 有条件准出 / 不准出>**

- 依据：<一两句话，引用自动区块中「准出结论」表格的关键行，例如「H1–H8 全部达标；T1 后端行覆盖率 72.4%（…/…）未达到 ≥ 80%」>
- 准出条件（结论为有条件准出时必填，每条写明负责人和完成时间）：
  1. <条件> — 负责人：<BE / FE / QA> — 截止：<时间>
- 阻塞项（结论为不准出时必填）：<未达标的硬性条件，以及对应的 Feature / Case>

## 2. 范围与版本

| 项 | 内容 |
|---|---|
| 需求来源 | PROBLEM.md、resource.json |
| 需求文档 | docs/02-PRD.md、docs/trace/features.json、docs/trace/requirements.json |
| 技术方案 | docs/03-技术方案-后端.md、docs/04-技术方案-前端.md、docs/05-系统架构.md |
| 用例 | docs/06-测试用例-接口与E2E.md、docs/07-测试用例-UI.md |
| 测试锁摘要 | <.workflow/locks/tests.lock.json 中的 digest 前 12 位> |
| 执行环境 | Node <版本>、@playwright/test 1.64.1、Chromium（Playwright 自带）、macOS |
| 数据生成时间 | <metrics.json 的 generatedAt> |
| 提交包 | <MANIFEST 的 generatedAt、打包级别（levelsApplied）、文件数 / 总大小、裁剪条目数；评审者解包后看到的证据以它为准> |
| 不在范围内 | <inScope=false 的 Feature 及原因（引用 PRD 决策记录）> |

## 3. 质量指标（自动生成）

<!-- METRICS:BEGIN -->
<!-- METRICS:END -->

## 4. 需求覆盖分析

- <未覆盖 / 未验证的 REQ 和 Feature：逐条列出 ID、原因、影响>
- <AC 覆盖缺口：哪些 AC 没有被用例引用，补充用例的建议>
- <P0 Feature 的验证情况>

## 5. 代码追溯与覆盖率分析

- <没有被用例引用 / 没有 @code 标注的 Code ID 及其风险>
- <行覆盖率低于 50% 的文件：结合 Code ID 判断是缺少用例还是死代码>
- <后端 / 前端覆盖率与目标的差距，以及补充用例的建议>

## 6. 测试执行与断言有效性

- <失败 / 未执行的用例：逐条写出根因和证据链接 `evidence/<CaseID>/`>
- <用例类别分布：P0 Feature 是否都有反例 / 边界 / 异常用例>
- <存活变异：按算子归类，说明哪些断言需要补强（例如 reverse 存活 → 排序没有被断言）>
- <弱断言、lint 警告>

## 7. 缺陷与过程

- TDD 过程：<门禁轮次、失败数的变化趋势、主要缺陷类型>
- UI 探索：<结论分布、product_bug 列表、script_stale 的固化情况>
- 遗留缺陷：

| 缺陷 | 关联 Case / Feature | 严重度 | 现象（附证据链接） | 处理意见 |
|---|---|---|---|---|
| <…> | <TC-… / F-…> | <blocker / major / minor> | <…> | <修复 / 延期 / 豁免（附理由）> |

## 8. 非功能验证

| 项 | 结论 | 依据 |
|---|---|---|
| 推荐接口性能（PROBLEM.md：10 万条数据下 100ms） | <…> | <性能指标表中的数值、性能用例的 Case ID> |
| 隐私过滤（敏感 URL 不上传） | <…> | <PRIV 模块用例 + 证据> |
| 后端不可用时的降级 | <…> | <离线 / 缓存相关用例 + 截图> |
| 启动诊断（7 项） | <…> | <DIAG 模块用例 + 截图> |
| 真实安装（首次安装、空 storage、点击图标打开真实 popup） | <…> | <自动区块「代表性证据」中的冒烟结果与截图（evidence/_smoke/）；H8> |
| MV3 约束 / 规范符合度 | <…> | <规范符合度表、validator code 阶段的结果> |

## 9. 证据索引

- 总索引：`evidence/index.json`；最近一次执行：`evidence/_runs/latest.json`；变异检查：`evidence/_runs/mutation-latest.json`
- 覆盖率汇总：`coverage/summary.json`（覆盖率 HTML 报告体积大，不随提交包提供，需要时按「如何复现」重新生成）
- 追溯矩阵：`docs/trace/matrix.md`；提交包清单：`bundles/MANIFEST.json`（打包级别、被去重 / 裁剪的证据逐条列出）
- 真实安装冒烟：`evidence/_smoke/summary.json`；验收流程：`evidence/ACCEPTANCE-FLOW/`
- 关键证据：自动区块「代表性证据」已列出冒烟、验收流程和 P0 UI 用例的截图链接；正文只补充解读。手写链接前先确认文件在提交包中存在（截图在提交包中是 .jpg）

## 10. 风险与建议

1. <风险：现象 → 影响 → 建议>

## 11. 如何复现

```bash
npm install
node .workflow/validators/validate.mjs final --expect-digest=<digest>      # 终检：全量执行 + 追溯校验
node .agents/skills/nav-case-to-script/scripts/run-cases.mjs --all --mutation
node .agents/skills/nav-quality-report/scripts/collect-coverage.mjs --port=4130
node .agents/skills/nav-case-to-script/scripts/smoke-install.mjs --browser=chromium   # 真实安装冒烟（真实 action popup）
node .workflow/tools/pack-submission.mjs --json                                       # 提交包预检，记下 manifestPath
node .agents/skills/nav-quality-report/scripts/collect-metrics.mjs --manifest=<manifestPath> --inject --check-report
# 从提交包还原完整目录：sh scripts/unpack-bundles.sh
```
