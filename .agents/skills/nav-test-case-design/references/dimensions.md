# 测试维度与设计技术

设计用例时逐个过一遍下面的维度：每个维度先问「这个 Feature 涉及吗」，涉及就至少落地 1 条用例；不涉及的、但按 check-cases 规则属于必需类别的，写 waiver 并说明理由。

## 1. 类别（category，每条用例选 1 个主类别）

| category | 含义 | 本项目的典型落点 |
|---|---|---|
| positive | 合法输入、主流程，结果符合验收标准 | 样例同步后 10 个页面；ranked 首位为 issues/123；推荐首条为 actions；解析示例句得到 2 条规则 |
| negative | 非法输入、非法操作，系统应拒绝并给出明确错误 | 非法 JSON → 400；`openTabs` 不是数组；`text` 为空；删除不存在的规则 → 404；`chrome://` URL 不入库 |
| boundary | 取值边界：阈值、上限 / 下限、空集合、恰好等于 | 恰好 14 天 / 14 天 ± 1 分钟；history 0 / 100 / 101 条；规则 `inactiveDays` 为 1 / 365；文本长度上限 |
| exception | 外部依赖失败、运行时异常，系统应降级而不崩溃 | 后端不可达（apiBaseUrl 指向 `http://127.0.0.1:9`）；后端返回 500；service worker 被回收后重新唤醒；storage 读写失败 |
| security | 隐私与安全 | 含 password / token / bank / secret 的 URL 不上传、后端兜底过滤；规则文本里的 `<script>` 以纯文本展示；日志不打印敏感 URL |
| performance | 时延、吞吐、数据规模 | 1 万条数据下 `POST /api/recommendations/next` p95 < 100ms；1 万条同步耗时 |
| compatibility | 运行环境差异 | active tab 是 `chrome://`、新标签页、`file://`；隐身窗口的 tab（`incognito=true`）跳过；popup 以 tab 方式打开 |
| state | 状态迁移与 UI 状态 | 规则「解析 → 预览 → 保存 → 列表 → 删除」；同步「未同步 → 同步中 → 成功 / 失败」；加载 / 空 / 错误 / 离线四态；重复同步幂等 |

> 一条用例只能有一个主类别。例如「后端不可达时诊断提示排查建议」是 exception，而不是 positive。

## 2. 设计技术（technique，每条用例选 1 个主技术）

| technique | 怎么用 | 本项目的适用点 |
|---|---|---|
| equivalence 等价类 | 把输入划分为有效类和无效类，每类选 1 个代表值 | URL 协议（http / https 有效，chrome / file / javascript / about 无效）；规则句式（数字 / 中文数字 / 「两周」「一个月」）；当前页类型（PR / issue / 文档页 / 未知站点） |
| boundary 边界值 | 取 `min-1, min, min+1, max-1, max, max+1`，以及空值、0、1 | 未访问天数阈值（`cleanupThresholdDays=14`、规则 7 天）；`maxHistoryItems=100`；score 在 [0, 1] 内；请求体大小上限 |
| decision-table 判定表 | 多个条件组合决定一个结果时，列出条件组合表，每列一条用例 | 整理建议的优先级：是否打开 × 是否命中 never_archive × 是否命中 archive_candidate × 是否超过全局阈值 → archive / keep / 不出现 |
| state-transition 状态迁移 | 画出状态和迁移，覆盖每条迁移，再加 1 条非法迁移 | 规则生命周期（parse 不落库 → save → list → delete → 再 delete 返回 404）；`isOpen` 随快照刷新；同步状态和缓存的离线 / 在线切换 |
| error-guessing 错误推测 | 根据经验猜测容易出错的地方 | 「永远不要归档」被误解析成归档（否定词在动作词之前）；`issues/123?tab=comments` 和已打开的 `issues/123` 判重；同一 URL 大小写或尾部斜杠不同；visitCount 重复同步时被累加虚高 |
| scenario 场景法 | 按用户真实操作串成链路，验证跨模块的状态传递 | PROBLEM.md 验收第 3–9 步；E2E 链路 sync → ranked → recommend → parse → save → cleanup → delete → health |
| pairwise 成对组合 | 参数多、取值多时，用两两组合覆盖替代全组合 | 推荐请求的 currentPage 类型 × openTabs 是否为空 × recentHistory 是否为空；规则的 domain × urlPattern × inactiveDays 是否存在 |

## 3. 横切维度检查清单

逐项问一遍，能落到具体用例的就落地：

1. **功能正确性**：每条 acceptance 至少被 1 条用例的 expected 覆盖（`acceptanceRefs`），期望值尽量使用 resource.json 推演出的具体值。
2. **输入校验**：缺字段、类型错误、空字符串、超长、非法 JSON、错误的 Content-Type、未知字段（应忽略，而不是报错）。
3. **契约一致性**：字段名与 PROBLEM.md 一致（camelCase）、字段类型、错误格式 `{ error: { code, message } }`、状态码（以 api-contract 为准）。
4. **幂等与重复**：同一批数据同步两次；同一条规则保存两次；删除两次。
5. **跨接口一致性**：sync 之后 `health.pageCount`、ranked 的条数、cleanup 的结果互相吻合；保存规则后 `health.ruleCount` 加 1。
6. **规则联动**：规则保存后立刻影响 ranked 的 reason / score 和 cleanup 的 archive / keep；删除规则后结果恢复。
7. **时间相关**：时间基准平移；恰好 N 天的边界必须固定时间（见第 4 节）；不依赖真实日期。
8. **可解释性**：每条 ranked / recommendation / suggestion 的 `reason` 非空，并且包含能证明原因的关键信息（例如「7 天」「受保护域名」「同仓库」）。
9. **隐私与安全**：插件端先过滤，后端兜底；过滤只看 URL、不区分大小写；`tokenizer` 这类误伤是已知局限，用例里要写明期望行为。
10. **降级与容错**：后端不可达时 popup 仍然展示浏览器上下文（CTX 不依赖后端）和上次的缓存，并标注离线；诊断给出排查建议。
11. **MV3 约束**：service worker 被回收后状态从 `chrome.storage.local` 恢复；popup 关闭再打开，同步结果仍然可见；`chrome.history.search` 显式传 `startTime`。
12. **兼容性**：系统页面（`chrome://`、新标签页）不可同步但能展示；隐身 tab 跳过。
13. **性能**：推荐接口在 1 万条数据下的耗时；用 p95 而不是单次耗时，并通过 `evidence.metric` 留存数值。
14. **可观测性**：后端日志带 `x-request-id`；诊断面板 7 项都有状态和说明。

## 4. 时间边界的写法（必须遵守）

- 「恰好 N 天」类用例：优先使用 api-contract 中的时间基准覆盖参数（例如 `?now=<ms>`）固定「现在」，再构造 `lastVisitTime = now - N 天`。
- 契约中没有覆盖参数时，拆成两条用例：`N 天 - 1 分钟`（不触发）和 `N 天 + 1 分钟`（触发），并在 testData 中写明原因：服务端处理请求时存在毫秒级偏移，「恰好 N 天」无法稳定复现。
- 样例数据统一按 PRD 决策 D-01 平移：最新一条 lastVisitTime = 导入时刻 − 5 分钟；平移后各页面之间的相对天数保持不变。读接口支持 `?now=` 覆盖当前时间，边界用例用它固定时间。

## 5. 可执行性约束（写用例时就要满足）

- 一个 Case ID 对应一个脚本 `tests/<api|e2e|ui>/<CaseID>.spec.mjs`，所以每条用例必须**独立**：自己构造数据（通过 `POST /api/sync` 导入），用 `/api/__test__/reset` 隔离，preconditions 中不得引用其他 Case ID。
- API / E2E：真实 HTTP，禁止 mock 后端，禁止 import 服务端源码。
- UI：`chrome.history.addUrl` 无法设置访问时间和次数，旧页面只能通过后端导入构造；popup 以 tab 方式打开（`chrome-extension://<id>/popup/popup.html`），「当前页面」要排除插件自身页面；外部站点通过 route 离线化；后端不可达用不存在服务的端口模拟，不能 route 后端；元素只用 ui-contract 中登记的 testId。
- 每条用例写明要留存的关键证据（evidence/<CaseID>/ 下的 api 请求响应、截图、server.log 等），方便质量报告引用。
