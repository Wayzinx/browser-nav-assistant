# 文档模板：01-需求理解.md 与 02-PRD.md

两份文档都用中文，代码标识符、字段名和接口路径用英文原文。`【明确】` = PROBLEM.md 原文要求；`【推断】` = 原文没写，但要满足明确要求就必须做到；`【待确认】` = 有歧义，需要定案（附建议默认值）。

---

## A. docs/01-需求理解.md（只做理解，不做设计）

已有该文件时**按轮次增量修订**：保留原有章节和 Q 编号，在文末「修订记录」追加本轮改动；已定案的 Q 标注「→ 已定案 D-NN」，不要删除。

```markdown
# 浏览器导航助手 · 需求理解文档（第 N 轮）

> 依据：PROBLEM.md、resource.json。标记说明：【明确】/【推断】/【待确认】。

## 1. 一句话理解
（系统做什么、给谁用、核心闭环；再列出按 PROBLEM.md 侧重归纳的核心考察点）

## 2. 硬性约束清单
| # | 约束 | 来源 | 对实现的影响 |
（C1..Cn：MV3、权限、内存存储 + 持久化方案、不调 LLM、不用成熟推荐平台、敏感 URL 不上传、本地可演示、可讲解、popup 与 background 通过消息通信、字段名沿用 camelCase）

## 3. 系统边界与模块职责
（ASCII 架构图；表格：模块 | 职责【明确】| 补充理解【推断】）

## 4. 数据模型理解
（Page / Rule / Recommendation 逐字段说明语义和歧义；指出 ranked 返回的是 Page 的视图）

## 5. 必做功能拆解
### 必做 1 插件加载并读取浏览器上下文
- 【明确】…
- 【推断】…
- 【待确认】见 Qx
（必做 2–7 同样写法。章节编号用「必做 1」这类写法，不要使用 F-XXX-NN 格式，避免与 Feature ID 混淆）

## 6. API 清单
| 方法 | 路径 | 来源（【明确】/【推断】）| 用途 |

## 7. 进阶项与建议优先级
| 进阶项 | 与必做项 / 追问的关系 | 建议优先级 P0–P3 |

## 8. 样例数据推演（resource.json）
（去重后页面数、各页面距最新一条的天数 / visitCount / 来源；推荐首条、整理建议、排序大致顺序；关键发现，例如时间基准问题）

## 9. 验收流程映射
| 步骤 | 验收内容 | 依赖功能 | 风险 / 注意 |

## 10. 交付物清单
（- [ ] 逐项列出）

## 11. 歧义与待确认问题
| # | 问题 | 选项 / 说明 | 建议默认 |
（Q1..Qn；已定案的在「建议默认」后追加「→ 已定案 D-NN」）

## 12. 面试追问预判
（10 万条数据下 100ms、后端不可用时降级、规则解析边界、隐身模式下的 history）

## 13. 风险点

## 修订记录
| 轮次 | 日期 | 改动 |
```

---

## B. docs/02-PRD.md（13 章，与工作流 PM 阶段的要求一致）

validator（`node .workflow/validators/validate.mjs prd`）会检查以下内容，写的时候就要满足：
- 出现 features.json 中的全部 Feature ID，不能出现未登记的 Feature ID；
- 提及接口路径 `/api/sync`、`/api/pages/ranked`、`/api/recommendations/next`、`/api/pages/cleanup-suggestions`、`/api/rules/parse`、`/api/rules`、`/api/health`、`/api/config`；
- 覆盖 7 个诊断项的关键词：`/api/health`、`tabs`、`history`、`storage`、`API base URL`（或「后端地址」）、「最近一次同步」、「规则条数」（或「规则数」）；
- 引用 `resource.json`，并且有「决策记录」章节和「验收」相关章节。

```markdown
# 浏览器导航助手 · 产品需求文档（PRD）

> 版本：v1（第 N 轮）｜依据：PROBLEM.md、resource.json、docs/01-需求理解.md｜追溯：docs/trace/requirements.json、docs/trace/features.json

## 1 背景与目标
（问题、目标、成功标准；不追求算法复杂度，强调可解释、可演示、可排障）

## 2 用户与核心场景
（用户画像；3–5 个核心场景，每个场景串起涉及的 Feature ID）

## 3 范围（In / Out）
### 3.1 In Scope
（按模块列出 inScope 的 Feature ID）
### 3.2 Out of Scope
（inScope=false 的 Feature ID 及不做的理由；例如后端持久化只在方案中解释）

## 4 功能清单
### 4.1 CTX 插件加载与上下文读取
| Feature ID | 名称 | 类型 | 优先级 | 端(FE/BE) | 描述 | 验收标准 |
|---|---|---|---|---|---|---|
| F-CTX-01 | … | system | P0 | FE | … | AC1：Given … When … Then …<br>AC2：… |
（SYNC / RANK / REC / CLEAN / RULE / DIAG / PRIV / 可选模块依次分节。验收标准与 features.json 逐字一致）

## 5 页面与交互
### 5.1 popup 信息架构（区块布局草图）
### 5.2 区块与可操作元素
| 区块 | 元素 | 交互 | 关联 Feature |
### 5.3 状态
（每个区块的加载 / 空 / 错误 / 离线状态分别展示什么、文案是什么）

## 6 业务规则与算法口径
### 6.1 URL 归一化与去重（存储主键、判重 key，引用决策）
### 6.2 隐私过滤（关键词来源、匹配范围、在插件端的执行时机、后端兜底、已知误伤）
### 6.3 评分公式与 reason 生成（各分量的计算方式、权重、取值范围、reason 模板）
### 6.4 推荐规则与兜底（规则顺序、排除条件、兜底策略、返回条数）
### 6.5 整理规则与优先级（archive / merge / keep 的判定、规则覆盖、优先级、阈值边界）
### 6.6 规则解析（支持的句式与示例、否定、多子句、不支持的句式及告知方式）
### 6.7 时间基准（样例平移、now 覆盖方式）

## 7 数据模型
（Page / Rule / Recommendation / 同步状态：字段 | 类型 | 说明 | 示例；只增不减）

## 8 接口需求概览
| 方法 | 路径 | 用途 | 关联 Feature |
（PROBLEM.md 中的全部接口，加上 GET /api/rules、DELETE /api/rules/:id；详细契约在阶段 2 的 api-contract 中定稿）

## 9 诊断项
| 检查项 | 判定方式 | 失败提示 | 排查建议 | 关联 Feature |
（7 项：后端连通性 /api/health、tabs 权限、history 权限、storage 可用性、API base URL、最近一次同步、当前规则条数）

## 10 非功能需求
（性能：推荐接口 100ms 内及 10 万条数据下的思路；降级；隐私；MV3 约束；可演示性；可讲解性）

## 11 验收流程映射
| 验收步骤（PROBLEM.md 第 1–10 步）| 演示动作 | 可观察结果 | Feature IDs |

## 12 决策记录
| 决策 ID | 问题 | 决定 | 理由 | 影响的 Feature |
（与 features.json.decisions 内容一致）

## 13 样例数据推演（resource.json）
（去重后页面数；排序大致顺序；推荐首条及理由；整理建议 archive / merge / keep；规则解析结果。数值要能复算，写明时间基准和复算方法）

## 附录 A 需求点追溯（REQ → Feature）
| REQ ID | 章节 | 原文摘录 | 类型 | 必做 | Feature IDs |
（列出全部 inScope 的 REQ；check-requirements 会核对）

## 附录 B 修订记录
| 轮次 | 改动 | 涉及的 ID |
```

### 写作注意

1. 第 4 章的验收标准与 features.json 逐字一致：先改 JSON，再同步到文档。
2. 第 6 章的口径是阶段 2 设计和阶段 3 测试的依据，阈值、权重、优先级都要写成具体数字或明确的规则，不能写「视情况而定」。
3. 第 11 章：验收第 4 步使用真实浏览器数据，第 9 步需要旧页面（依赖样例导入和时间基准决策），要写明演示时如何保证有区分度。
4. 第 13 章的数值必须能复算；与 docs/01 §8 不同的地方，说明是哪个决策导致的。
