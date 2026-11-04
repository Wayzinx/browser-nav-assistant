---
name: nav-req-analysis
description: 浏览器导航助手项目的「需求理解 + PRD」技能（产品 / PM agent 使用）。从 PROBLEM.md 和 resource.json 出发，产出 docs/01-需求理解.md、docs/02-PRD.md、docs/trace/requirements.json（REQ 原始需求点）和 docs/trace/features.json（Feature ID 注册表），严格遵守 .workflow/CONVENTIONS.md 的 Feature ID 与追溯规则，并通过 validator 和 check-requirements 两道自检。适用场景：需求理解、需求分析、需求拆解、写 PRD / 修订 PRD、拆 Feature ID、摘录需求点、编写验收标准、需求评审意见修订、工作流阶段 1（需求与 PRD）。
---

# 需求理解与 PRD（nav-req-analysis）

把 PROBLEM.md 变成一组**可追溯、可测试**的需求资产：每一句原始需求都有 REQ 编号，每个 REQ 都被 Feature 承接，每个 Feature 的验收标准都能直接写成自动化断言。下游的技术方案（Code ID）、测试用例（Case ID）和质量报告（需求覆盖率）全部以本技能的产物为起点。

## 产物

| 产物 | 路径 | 说明 |
|---|---|---|
| 需求理解 | `docs/01-需求理解.md` | 【明确】/【推断】/【待确认】、约束清单、Q 列表及建议默认值、样例数据推演 |
| 需求点注册表 | `docs/trace/requirements.json` | **本技能新增**：PROBLEM.md 逐字摘录的 REQ-NNN，以及 REQ → Feature 映射 |
| Feature 注册表 | `docs/trace/features.json` | F-MOD-NN、验收标准 AC、决策 D-NN（结构见 CONVENTIONS §4） |
| PRD | `docs/02-PRD.md` | 13 章 + 附录（REQ 追溯、修订记录） |

## 硬约束（违反任何一条都算未完成）

1. **只读真相源**：`PROBLEM.md`、`resource.json` 禁止修改；与参考资料（01 文档、`docs/prototype/engine.js`）冲突时以 PROBLEM.md 为准，并写进决策记录。
2. **不修改 `.workflow/`**：只运行其中的 validator。也不要写 `docs/03` 及之后的文档、代码和测试。
3. **ID 规则**（详见 `references/id-and-schema.md`）：
   - Feature `F-<MOD>-<NN>`，`module` 字段与 ID 中的 MOD 一致；8 个必备模块 `CTX` `SYNC` `RANK` `REC` `CLEAN` `RULE` `DIAG` `PRIV` 都要有 inScope Feature；
   - `kind` ∈ action / display / system / api / rule / nfr；`layers` ∈ ["FE"] / ["BE"] / ["FE","BE"]；`priority` ∈ P0–P3；`inScope` 为布尔值；
   - ID 一经发布不得改作他用、不删除、不重排；不做的功能置 `inScope=false`；新功能追加下一个编号；
   - REQ `REQ-NNN` 按 PROBLEM.md 出现顺序从 001 起连续；决策 `D-NN`；验收标准 `AC1`、`AC2`… 在 Feature 内连续，**发布后只能追加**（用例通过 `F-SYNC-01#AC2` 引用）。
4. **PRD 中必须出现全部 Feature ID**，不能出现未登记的 F / C / TC ID；不要预先编造 Code ID、Case ID 或 testId。
5. 文档用中文，字段名、接口路径和代码标识符保持英文原文（沿用 PROBLEM.md 的 camelCase）。

## 输入与开工检查

```bash
cd <项目根目录>
cat AGENTS.md .workflow/CONVENTIONS.md            # 工作流约定（ID、路径、追溯规则）
cat PROBLEM.md resource.json                      # 真相源
ls docs/ docs/trace/ 2>/dev/null                  # 判断是首轮还是增量修订
node .agents/skills/nav-req-analysis/scripts/check-requirements.mjs --dump-items   # 需要被 REQ 覆盖的条目清单
node docs/prototype/engine.js                     # 原型算法（演示数据比 resource.json 多，只用于核对口径）
```

- `docs/01-需求理解.md` 已存在：在它的基础上修订（保留 Q 编号，追加修订记录），不要推倒重写。
- `docs/trace/features.json` 已存在：只能追加 Feature、追加 AC、把不做的功能改为 `inScope=false`，不能改动已有 ID 的含义。
- 收到评审或 validator 反馈时：逐条修复，已通过部分的 ID 不动。

## 流程

### 第一段：需求理解

**步骤 1　通读与标注。** 逐节阅读 PROBLEM.md，每个要点标为【明确】/【推断】/【待确认】。重点留意：总体约束（MV3、敏感 URL 不上传、本地可演示）、「重要考察点」（诊断）、提示和面试追问（性能、降级、边界、隐身模式）。

**步骤 2　摘录需求点。** 按 `--dump-items` 的顺序写 `docs/trace/requirements.json`：一个列表项 / 表格行 / 接口声明行 / 公式行 / 数据模型标题 = 一条 REQ；quote 逐字复制（可以去掉 `**` 和反引号，不能改写）；段落句中有实质要求的也要摘。`features` 先留空数组。然后执行：

```bash
node .agents/skills/nav-req-analysis/scripts/check-requirements.mjs --stage=understand
```

直到「必须项覆盖 100%」且没有 error。

**步骤 3　写 01 文档。** 按 `references/prd-template.md` §A 的 13 章模板编写或修订：约束清单、模块职责、数据模型歧义、必做 1–7 拆解、API 清单、进阶优先级、验收映射、交付物、Q 列表（每个 Q 都附选项和建议默认值）、追问预判、风险点。

**步骤 4　样例数据推演。** 基于 resource.json 手算或用 engine.js 的函数复算：去重后的页面数、source 合并、未访问天数、推荐首条、整理建议（archive / merge / keep）、规则解析结果。特别检查**时间基准**问题（样例是 2024 年数据，直接用当前时间会让所有页面都「超过 965 天未访问」）。这些数值后面要写进 AC 和 PRD 第 13 章。

### 第二段：PRD 与 Feature 注册

**步骤 5　定案。** 每个 Q 默认采用建议值（与 PROBLEM.md 冲突时以原文为准），写成 `D-NN`：同时写进 `features.json.decisions` 和 PRD 第 12 章，并在 01 文档对应的 Q 后标注「→ 已定案 D-NN」。

**步骤 6　拆 Feature。** 按 `references/writing-guide.md` §1–§2：
- 粒度：每个用户动作、操作、可观察的系统行为一个 ID（诊断 7 项各自独立；规则的解析 / 保存 / 列表 / 删除各自独立；隐私过滤拆成插件端 FE 和后端兜底 BE）。本项目 inScope 预计 40–70 个；
- 范围：必做 1–7、总体约束、验收流程全部 inScope；进阶 P0 / P1（隐私关键词可配置、本地缓存与离线降级、增量同步、推荐缓存与预计算评分）inScope；P2 / P3（后端持久化实现、右键菜单、向量相似度、页面高亮）照常登记，置 `inScope=false`；
- `layers` 只标「需要写代码才能让 AC 成立」的那一端：展示后端数据的 Feature 一般只标 FE，接口能力由 BE 的 api / rule Feature 承担；
- `source` 写成 `REQ-011、REQ-012；PROBLEM.md 必做功能 2`，并回填对应 REQ 的 `features`（双向一致）。

**步骤 7　写验收标准。** 按 `references/writing-guide.md` §4：
- 格式 `AC<n>：Given … When … Then …`，n 从 1 起连续；
- 每条都有可观察锚点：接口状态码 / 字段 / 值 / 顺序、popup 区块中引号括起的可见文本或数量、本地存储状态、后端数据核对、日志；
- 能写具体值的地方用 resource.json 推演出的值（例如「去重后 10 个页面」「第 1 条推荐为 https://github.com/org/repo/actions」）；时间写相对天数；
- 不用含糊词（正常、正确、合理、体验良好、符合预期……，完整清单见指南 §4.3）；
- action / api / rule 类 Feature 除正常场景外，至少再写 1 条异常或边界 AC。

**步骤 8　写 PRD。** 按 `references/prd-template.md` §B 的 13 章编写 `docs/02-PRD.md`：第 4 章的表格列为 Feature ID | 名称 | 类型 | 优先级 | 端(FE/BE) | 描述 | 验收标准，AC 与 JSON 逐字一致；第 6 章写清全部算法口径（具体阈值、权重、优先级）；第 9 章覆盖 7 个诊断项及排查建议；第 11 章把验收第 1–10 步映射到 Feature ID；第 13 章写可复算的样例推演；附录 A 列出全部 inScope 的 REQ → Feature。

**步骤 9　自检（两道都必须通过）。**

```bash
node .workflow/validators/validate.mjs prd                              # CONVENTIONS 硬性规则
node .agents/skills/nav-req-analysis/scripts/check-requirements.mjs     # 需求点完整性、映射、AC 可测性
```

修复全部 error；warning 逐条确认（例如「Feature 没有被任何 REQ 引用」要么补映射，要么在 source 中写明「推断：<理由>」）。

## 自查清单（交付前逐项确认）

- [ ] requirements.json：PROBLEM.md 必须项覆盖 100%，quote 全部能在原文中找到，必做 REQ 都映射到 inScope Feature
- [ ] features.json：8 个必备模块齐全；inScope 40–70 个；每个 Feature 都有 source（引用 REQ）、description、至少 1 条 AC；decisions 非空
- [ ] 每条 AC 都是 Given / When / Then 格式，有具体可观察结果，没有含糊词
- [ ] 诊断 7 项、规则 4 个动作、隐私 FE / BE 各自是独立 Feature
- [ ] PRD 13 章齐全，出现全部 Feature ID，第 4 章 AC 与 JSON 一致，第 13 章数值可复算
- [ ] 01 文档的每个 Q 都已定案并引用 D-NN；修订记录已更新
- [ ] 两道自检命令退出码都为 0

## 常见错误

| 错误 | 后果 | 正确做法 |
|---|---|---|
| 一个模块只有 1–2 个大 Feature | 用例无法定位、validator 报粒度过粗 | 按「独立做对 / 做错」拆分，见指南 §1.1 |
| 展示类 Feature 标了 BE | 阶段 2 / 3 被迫补 C-BE 和 API 用例 | 只标需要写代码的那一端 |
| 隐私过滤只写后端 | 违反「不应上传到后端」 | 拆成插件端过滤（FE）+ 后端兜底（BE） |
| AC 写「显示正常」「推荐合理」 | 无法写断言，测试阶段被退回 | 写具体文本、数量、字段值 |
| quote 改写或概括原文 | check-requirements 报「找不到原文」 | 逐字复制，长句可以拆成几段分别摘录 |
| 重排 AC 编号或复用废弃 ID | 下游 acceptanceRefs、Code / Case 追溯失效 | 只追加；废弃的置 inScope=false |
| 照抄 engine.js 的演示输出 | 演示数据比 resource.json 多，数值对不上 | 用决策后的口径对 resource.json 复算 |
| PRD 里提前写 testId、Code ID | validator 报未登记 ID；与阶段 2 设计冲突 | 用区块名和可见文本描述 UI |

## 交付说明（结束时输出）

- summary：本轮做了什么；REQ 总数和必做数；Feature 总数、inScope 数和模块分布；AC 总数；决策数；两道自检的结果
- files：改动过的文件列表
- openQuestions：仍需用户拍板的问题（没有就写空）

## 参考文件

- `references/id-and-schema.md`：ID 总表、分配与变更规则、requirements.json / features.json 字段规则、校验分工
- `references/writing-guide.md`：拆分粒度清单、kind / layers / priority 判定、REQ 摘录要点、AC 写法（锚点、含糊词、样例具体值、正反例）、决策记录
- `references/prd-template.md`：01 和 02 的章节模板，以及 validator 对 PRD 的检查点
- `scripts/check-requirements.mjs`：补充校验（`--stage=understand` / `--dump-items` / `--json` / `--root=`）
