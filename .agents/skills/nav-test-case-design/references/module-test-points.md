# 模块测试点库

按模块列出值得设计成用例的测试点，供挑选和组合，不要求逐条照搬。具体的 Feature ID、字段名、状态码、错误码、testId 以 `docs/trace/features.json`、`api-contract.json`、`ui-contract.json` 为准。

> **期望值口径**：下文数值是用 `resource.json` 加原型算法 `docs/prototype/engine.js` 推演得到的（时间基准按 PRD D-01：最新一条 lastVisitTime = 导入时刻 − 5 分钟；表中天数均相对最新一条），仅供参考，**最终以 PRD 第 13 节为准**。PRD 的权重、阈值或去重口径与原型不同时，以 PRD 为准重新推算，并在用例的 testData 中写明推算依据。

## 0. 样例数据速查（resource.json 平移后）

| URL（省略 https://） | 距最新一条（天） | visitCount | 来源 | 当前打开 |
|---|---|---|---|---|
| github.com/org/repo/pull/456 | 0.00 | 5 | active_tab, history | 是（当前页） |
| github.com/org/repo/issues/123 | 0.12 | 8 | open_tab, history | 是 |
| github.com/org/repo/issues/123?tab=comments | 0.14 | 3 | history | 否 |
| github.com/org/repo/actions | 0.23 | 3 | history | 否 |
| developer.mozilla.org/en-US/docs/Web/API/Fetch_API | 0.35 | 4 | open_tab, history | 是 |
| react.dev/reference/react/useState | 0.46 | 6 | history | 否 |
| react.dev/learn | 0.52 | 2 | history | 否 |
| docs.internal.com/ai-agent-design | 6.94 | 2 | open_tab, history | 是 |
| github.com/org/repo/issues/100 | 24.31 | 1 | history | 否 |
| www.google.com/search?q=chrome+extension+manifest+v3 | 35.88 | 1 | history | 否 |

- 一次同步共收到 14 项（1 个 activeTab + 3 个 openTabs + 10 条 history），去重后 **10 个页面**（原型口径：新建 10、更新 4）。`issues/123` 和 `issues/123?tab=comments` 按原始 URL 存为两条记录，判重（merge）时才视为同一页面。
- resource.json 中**没有**隐私敏感 URL，隐私用例需要自己构造，例如 `https://accounts.example.com/reset-password?token=8f2a91c`（同时命中 password 和 token）、`https://bank.example.com/account/overview`。
- resource.json 中没有处于 7–14 天之间的 GitHub issue。要证明「7 天规则」确实起作用，需要额外构造一条，例如 `https://github.com/org/repo/issues/87`，距今 10 天：没有规则时不归档，保存规则后归档。
- 要证明 never_archive 起作用，需要构造一条 docs.internal.com 下超过 14 天且未打开的页面：没有规则时归档，保存规则后变为 keep。
- 示例规则句 `把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档` 解析为 2 条规则：
  1. `archive_candidate`，domain=`github.com`，urlPattern=`/issues/`，inactiveDays=7，action=`suggest_archive`，rawText=`把 7 天没访问过的 GitHub issue 建议归档`；
  2. `never_archive`，domain=`docs.internal.com`，action=`keep`，rawText=`docs.internal.com 的页面永远不要归档`。
- `/api/config` 默认值：`cleanupThresholdDays=14`、`maxHistoryItems=100`、`enablePrivacyFilter=true`、`privacySensitiveKeywords=["password","token","bank","secret"]`。

---

## CTX 插件加载与上下文读取（UI 为主）

| 类别 | 测试点 | 数据 / 期望 |
|---|---|---|
| positive | manifest 合法：MV3，权限包含 tabs、history、storage、activeTab | 插件加载后 service worker 存在；`manifest_version=3` |
| positive | popup 展示当前页面的 title 和 URL | 先打开 mock 页面 Fetch_API 再打开 popup：当前页 testId 显示 `Fetch API - Web APIs \| MDN` 和对应 URL |
| positive | 展示当前窗口打开的 tabs 列表 | 打开 3 个 mock 页面：列表项数量为 3（不含插件自身页面），URL 与打开顺序一致或按方案约定排序 |
| positive | 展示最近 N 条历史（N=100），按时间倒序 | 通过 openTabs 访问 3 个页面：历史列表包含这 3 个 URL，第 1 条是最后访问的页面 |
| boundary | 历史超过 N 条时截断 | seedHistory 写入 101 条：列表项数量为 100 |
| boundary | 没有任何历史 / 只有插件页面 | 历史区显示空状态 testId 和文本 |
| compatibility | popup 以 tab 方式打开时「当前页」排除插件自身 | 当前页不是 `chrome-extension://…`，而是最近访问的 http(s) tab |
| compatibility | 当前页为系统页面（`chrome://extensions/`、新标签页） | 正常展示，并标记「系统页面，不可同步」 |
| exception | 后端不可达时 CTX 照常工作 | apiBaseUrl 指向 `http://127.0.0.1:9`：当前页、tabs、历史仍然展示（CTX 只依赖浏览器 API） |
| state | 很长的 title / URL | 截断显示，完整内容放在 title 属性中，布局不错位 |

## SYNC 同步

| 类别 | 测试点 | 数据 / 期望 |
|---|---|---|
| positive | 样例同步入库 | `POST /api/sync`（平移后的 resource.json）→ 200；按契约返回统计（原型口径 received=14、created=10、updated=4）；随后 `GET /api/health` 的 `pageCount=10` |
| positive | 区分 source | pull/456 的 sources 包含 `active_tab`、`history`；issues/123 包含 `open_tab`、`history`；actions 只有 `history`（通过返回 sources 的接口核对，以契约为准） |
| positive | visitCount / lastVisitedAt | issues/123 的 visitCount=8，lastVisitedAt 等于平移后的时间戳（用 `shiftedTime()` 计算，不要手写） |
| state | 重复同步幂等 | 同一 payload 同步两次：pageCount 仍为 10；issues/123 的 visitCount 仍为 8（取较大值，不累加） |
| state | isOpen 按快照刷新 | 第 2 次同步的 openTabs 去掉 docs.internal：该页 isOpen=false，并可能进入整理建议 |
| boundary | 空数组 | `activeTab=null`、`openTabs=[]`、`history=[]` → 200，新建 0 条 |
| boundary | URL 归一化去重 | `https://GitHub.com/org/repo/issues/123/?utm_source=x#c1` 与 `…/issues/123` 视为同一页面（原型口径，以 PRD 决策为准） |
| boundary | title 为空 | 用 URL 作为兜底 title（以 PRD 为准） |
| negative | 非法 JSON | 请求体 `{bad` → 400，`error.code` 按契约（例如 `INVALID_JSON`） |
| negative | 字段类型错误 | `openTabs: "x"`、`history: {}` → 400，`error.message` 指出字段名 |
| negative | 非 http(s) URL | `chrome://extensions/`、`file:///etc/hosts`、`javascript:alert(1)` 不入库，计入 filtered |
| negative | 错误的方法 | `GET /api/sync` → 404 或 405（以契约为准） |
| boundary | 请求体过大 | 超过契约上限 → 413（以契约为准） |
| exception | 插件端：后端不可达时同步 | sync-button 点击后，同步状态显示失败及原因；「最近一次同步」记录为失败 |
| exception | 插件端：同步过程中关闭 popup 再打开 | 同步结果仍然可见（状态保存在 storage 中） |
| security | 后端兜底隐私过滤 | 直接 `POST /api/sync` 携带 `…reset-password?token=8f2a91c` → 不入库，filtered 计数加 1 |

## RANK 历史排序

| 类别 | 测试点 | 数据 / 期望 |
|---|---|---|
| positive | 排序与字段 | `GET /api/pages/ranked` → 10 条；每项都有 url、title、domain、visitCount、lastVisitedAt、score、reason；按 score 降序 |
| positive | 头尾顺序 | 原型权重下前 2 名为 issues/123（1.00）、pull/456（0.94）；最后 2 名为 issues/100（0.23）、Google 搜索页（0.11）（以 PRD 第 13 节为准） |
| positive | reason 可解释 | 打开中的页面 reason 包含「打开」；高频页面包含访问次数（例如「8 次」） |
| boundary | score 范围 | 每项 `0 ≤ score ≤ 1` |
| boundary | 空库 | reset 后 → `pages=[]` |
| boundary | 同分排序稳定 | 构造两条完全相同特征的页面：两次请求顺序一致（次级排序键以方案为准） |
| state | 规则影响排序 | 保存 never_archive docs.internal.com 后：docs.internal 的 score 上升（原型 0.56 → 0.65），reason 包含「受保护」 |
| state | 删除规则后恢复 | 删除该规则后 score 和 reason 恢复到保存前的值 |
| negative | 非法查询参数 | 契约支持 `limit` 等参数时：`limit=-1`、`limit=abc` → 400 或按契约忽略 |
| performance | 大数据量排序 | 1 万条数据时 ranked 的耗时（以方案阈值为准） |

## REC 下一步推荐

| 类别 | 测试点 | 数据 / 期望 |
|---|---|---|
| positive | GitHub PR 推荐同仓库 CI | currentPage=pull/456，openTabs 为样例的 3 个：第 1 条为 `https://github.com/org/repo/actions`，`type=next_visit`，reason 提到 PR / CI（原型：「你正在查看 PR，同仓库 CI 页面最近访问频率较高…」） |
| positive | 排除规则 | 结果中不包含当前页 pull/456、已打开的 issues/123 / Fetch_API / docs.internal，也不包含与已打开的 issues/123 判重的 `issues/123?tab=comments` |
| positive | 文档页推荐同站点高频页 | currentPage=`https://react.dev/learn`：第 1 条为 `https://react.dev/reference/react/useState`（同站点访问 6 次） |
| positive | 兜底不为空 | currentPage=`https://example.org/x`（库中没有同域名页面）：至少 1 条推荐，reason 非空（全局高分兜底） |
| boundary | 所有候选都已打开 | 把全部页面放进 openTabs：返回空列表或带说明的兜底（以 PRD 为准），不能返回已打开的页面 |
| boundary | 空库 | reset 后请求推荐：按 PRD 返回空列表或提示信息，不报 500 |
| boundary | 推荐条数上限 | 结果数量不超过方案约定的 K（例如 5） |
| negative | 缺少 currentPage / URL 非法 | → 400，error 指出字段 |
| compatibility | 当前页为系统页面 | currentPage=`chrome://newtab/` → 按 PRD 走兜底或返回 400 |
| state | 推荐缓存失效 | 同一请求两次结果一致；再次同步新数据后结果更新 |
| performance | 1 万条数据下 p95 < 100ms | 导入 `bulkHistory(10000)` 后连续请求 20 次：p95 < 100ms，用 `evidence.metric('p95', …)` 留存 |

## CLEAN 整理建议

| 类别 | 测试点 | 数据 / 期望 |
|---|---|---|
| positive | 无规则时的建议 | archive：Google 搜索页（35.88 天）、issues/100（24.31 天）；merge：`issues/123` + `issues/123?tab=comments`；没有 keep（原型口径共 3 条） |
| positive | 有规则时的建议 | 保存示例两条规则后：issues/100 的 reason 提到 7 天和命中的规则；新增 keep `docs.internal.com/ai-agent-design`，reason 提到受保护域名（原型口径共 4 条） |
| positive | reason 可解释 | archive 的 reason 包含天数，以及「不在当前打开的 tab 中」 |
| boundary | 全局阈值边界 | 固定 now 后构造 `14 天 - 1 分钟` 和 `14 天 + 1 分钟` 两条：只有后者被归档（有 `?now=` 覆盖参数时可以直接测「恰好 14 天」，严格大于还是大于等于以 PRD 为准） |
| boundary | 规则阈值边界 | GitHub issue `7 天 ± 1 分钟`，保存 7 天规则后只有超过 7 天的那条被归档 |
| positive（technique: decision-table） | 优先级组合 | 当前打开 > never_archive > archive_candidate > 全局阈值：例如「已打开且 30 天」不归档；「命中 never_archive 且 30 天」为 keep；「命中 7 天规则、10 天、未打开」为 archive |
| state | 规则区分度 | 构造 issues/87（10 天）：没有规则时不在 archive 中；保存 7 天规则后出现；删除规则后消失 |
| state | 删除 never_archive 后恢复归档 | 构造 docs.internal 下 20 天未打开的页面：有规则时为 keep，删除规则后为 archive |
| boundary | merge 分组 | 只差 hash 的两个 URL、同一页面 3 个变体：合并为 1 组，`urls` 含 3 项 |
| boundary | 空库 | → `suggestions=[]` |
| negative | 已禁用的规则 | `enabled=false` 的规则不生效 |
| compatibility | 搜索页判重的已知局限 | 不同 q 的 Google 搜索页去掉 query 后相同：按 PRD 决策（严格去 query 时会被 merge；保留 q 时不会）写期望值 |

## RULE 自然语言规则

| 类别 | 测试点 | 数据 / 期望 |
|---|---|---|
| positive | 解析示例句 | `POST /api/rules/parse` → 2 条规则，字段见第 0 节 |
| positive | 解析不落库 | parse 之后 `GET /api/rules` 仍为空 |
| positive | 保存 → 列表 → 删除 | 保存 parse 返回的 2 条 → 列表 2 条，每条都有后端分配的 id，`enabled=true`；用列表中取得的 id 删除 1 条 → 列表 1 条；`health.ruleCount` 依次为 2、1 |
| positive | 等价句式 | `七天没访问的 GitHub issue 建议归档` → inactiveDays=7；`两周没看的搜索结果页建议归档` → inactiveDays=14、urlPattern=`/search`；`一个月`→ 30（以 PRD 支持的句式为准） |
| positive（technique: error-guessing） | 否定先于动作 | `docs.internal.com 的页面永远不要归档` → never_archive，不能被解析成 archive_candidate；`别 / 不要 / 禁止 / 永远不要` 各取一条 |
| positive | 多子句拆分 | 用「，但」「；」「。」「并且」连接的句子拆成多条，rawText 为各自的子句 |
| negative | 无法识别 | `帮我整理一下` → rules=[]，并返回未识别片段和原因（原型：「没有识别到动作…」） |
| negative | 缺少作用对象 | `别关闭 docs 页面` → rules=[]，原因提示没有找到域名或页面类型 |
| negative | 空文本 / 只有空格 / 缺少 text 字段 | → 400 |
| boundary | 文本长度上限 | 恰好等于上限 → 200；上限 + 1 → 400（上限以契约为准） |
| boundary | 天数边界 | `0 天`、`1 天`、`365 天`、`99999 天`：按 PRD 接受或拒绝 |
| negative | 保存非法规则 | `type` 不在枚举中、never_archive 缺少 domain、inactiveDays 为负数 → 400 |
| negative | 删除不存在的规则 | 随机 id → 404；同一 id 删除两次，第 2 次返回 404 |
| security | 规则文本含 HTML | `<img src=x onerror=alert(1)> 7 天没访问的 GitHub issue 建议归档`：后端按纯文本保存；popup 规则列表以纯文本展示，不执行脚本 |
| state | UI：输入 → 预览 → 确认保存 → 列表 → 删除 | 每一步都有可断言的 testId 状态；预览阶段不调用保存接口（通过 `GET /api/rules` 核对） |

## DIAG 启动诊断

| 类别 | 测试点 | 数据 / 期望 |
|---|---|---|
| positive | health 字段 | `GET /api/health` → `status="ok"`、`version="1.0.0"`、`uptime` 为非负整数（秒）、`pageCount`、`ruleCount` |
| positive | health 随数据变化 | 导入样例后 `pageCount=10`；保存 2 条规则后 `ruleCount=2` |
| positive | config 字段 | `GET /api/config` → 第 0 节的 4 个默认值 |
| positive | UI 7 项检查 | 后端连接、tabs 权限、history 权限、storage 可用、API 地址、最近一次同步、规则数量，每项都有状态 testId 和说明文本 |
| exception | 后端不可达 | 后端连接项为失败，并给出排查建议（启动命令、端口、地址）；其他项照常显示 |
| state | 最近一次同步 | 未同步时显示「尚未同步」；同步成功后显示时间和结果；同步失败后显示失败原因 |
| state | 规则数量 | 保存 2 条规则后，诊断中的规则数量显示 2 |
| boundary | API 地址格式非法 | 设置为 `abc` → 地址项显示格式错误，不发起请求 |
| exception | storage 不可用 | 难以在真实浏览器中模拟时写 waiver，说明理由 |

## PRIV 隐私过滤

| 类别 | 测试点 | 数据 / 期望 |
|---|---|---|
| security | 插件端过滤后不上传 | 打开 `https://accounts.example.com/reset-password?token=8f2a91c` 和 `https://bank.example.com/account/overview` 后点击同步：`GET /api/pages/ranked` 中没有这两个 URL；同步状态显示过滤 2 条；证据中的 `/api/sync` 请求体也不包含它们 |
| boundary | 大小写不敏感 | `…?TOKEN=abc`、`…/Password/reset` 都被过滤 |
| boundary | 关键词位置 | 关键词出现在 host（`bank.example.com`）、path、query 中都被过滤 |
| boundary | 子串误伤（已知局限） | `https://huggingface.co/docs/tokenizers` 被 `token` 命中：按 PRD 的期望写用例，并在文档中注明局限 |
| positive | 关键词可配置 | 修改关键词配置后（按契约 / 方案提供的入口），新关键词生效 |
| security | 后端兜底 | 绕过插件直接 `POST /api/sync` 敏感 URL → 不入库 |
| security | 日志不泄露 | 证据中的 server.log 和 extension.log 不出现完整的敏感 URL |

## CACHE 本地缓存与离线降级（inScope 时）

| 类别 | 测试点 | 数据 / 期望 |
|---|---|---|
| positive | 缓存写入 | 同步成功后，storage 中有 ranked / 推荐缓存及其时间戳（key 以 ui-contract.storageKeys 为准） |
| exception | 离线展示缓存 | 同步成功后把 apiBaseUrl 改成 `http://127.0.0.1:9`，重新打开 popup：展示上次的排序和推荐，并显示离线标识和缓存时间 |
| state | 恢复在线 | 改回正确地址后刷新：离线标识消失，数据重新从后端获取 |
| boundary | 没有缓存时离线 | 首次打开就离线：显示空状态和离线提示，不报错 |

## INCR 增量同步（inScope 时）

| 类别 | 测试点 | 数据 / 期望 |
|---|---|---|
| positive | 记录游标 | 首次同步后 storage 中保存同步游标（时间戳） |
| positive | 只上传增量 | 第 2 次同步前新增 1 个页面：证据中第 2 次 `/api/sync` 请求体的 history 只包含新增项（或数量明显少于第 1 次） |
| boundary | 没有增量 | 无新访问时再次同步：history 为空数组，后端数据不变 |
| exception | 同步失败不推进游标 | 后端不可达时同步失败：游标保持不变，恢复后补传 |

## PERF 性能（nfr）

| 类别 | 测试点 | 数据 / 期望 |
|---|---|---|
| performance | 推荐接口 | 1 万条数据，连续 20 次，p95 < 100ms（PROBLEM.md 提示），记录 p50 / p95 |
| performance | 同步大批量数据 | 1 万条一次同步的耗时在方案阈值内 |
| performance | 预计算 / 缓存生效 | 第 2 次相同推荐请求的耗时不高于第 1 次（只作为观测指标，不建议作为硬断言） |

> 性能用例的数据用确定性生成（`bulkHistory(n)`），不要使用随机数；阈值写在 expected 中，测得的数值用 `evidence.metric` 留存，供质量报告引用。
