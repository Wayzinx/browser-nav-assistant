# 验收流程探索记录（PROBLEM.md「验收要求」第 3–9 步）

- 时间：2026-11-03 07:28（第 7 轮，UI 探索，端口 4180；产品代码自第 6 轮后无改动，结果与第 6 轮一致）
- 后端：`PORT=4180 HOST=127.0.0.1 ENABLE_TEST_API=1 LOG_FILE=evidence/_runtime/explore-4180.log node server/src/index.js`（结束后用 SIGTERM 停止）
- 插件：headless Chromium（`channel: 'chromium'`）加载 `extension/`，`apiBaseUrl=http://127.0.0.1:4180`；外部站点（github.com、developer.mozilla.org、www.google.com、docs.internal.com）用 route 离线化，没有 route 后端
- 脚本：`tests/explore/tmp/acceptance-r7-4180.mjs`；日志：`evidence/ACCEPTANCE-FLOW/explore/log.json`；每张截图旁有同名 `.aria.txt`（ariaSnapshot）
- 旧页面数据：`chrome.history.addUrl` 不能指定访问时间，所以先按 PRD D-01 把 `resource.json` 时间平移后通过真实 `POST /api/sync` 导入（received=14、pageCount=10），再在浏览器中打开测试页面，由插件同步

## 结论

第 3–9 步全部可以走通，功能符合验收要求。发现 1 个界面缺陷（主按钮悬停时文字不可读），另有 1 个观察项。

| 步骤 | 结果 | 实际观察 | 截图 |
|---|---|---|---|
| 3 诊断页：后端连接、tabs、history 权限正常 | 通过 | `diag-check-backend` / `diag-check-tabs` / `diag-check-history` 的 data-status 都是 ok，文案分别为「后端服务连接正常；耗时 3 ms」「tabs 权限已授权，标签页 URL 可读」「history 权限已授权，历史查询可用」；汇总为「通过 8 · 警告 2 · 失败 0 · 提示 1」 | explore/1.png、explore/2.png |
| 4 打开测试页面（GitHub、MDN、搜索页） | 通过 | 打开 github.com/org/repo/pull/456、MDN Fetch_API、google 搜索、docs.internal.com；上下文页签列出这 4 个页面（另有浏览器启动时自带的 about:blank） | explore/3.png |
| 5 点击「同步浏览器上下文」显示同步成功 | 通过 | sync-status data-status=success，文案「同步成功 · 上传 9 条 · 过滤 0 条 · 07:28 · 刚刚」；health.pageCount=11 | explore/4.png |
| 6 历史排序，分数和理由可见 | 通过 | 共 11 条，按分数降序：pull/456 0.94「正在浏览，最近 3 天内多次访问（5 次），常用域名 github.com」，MDN 0.84，issues/123 0.80……；页面显示权重公式 `score = 0.4×时效 + 0.3×频次 + 0.2×打开 + 0.1×域名`，展开明细显示「时效 1.00 频次 0.82 打开 1.00 域名 1.00」 | explore/5.png、explore/6.png |
| 7 推荐下一步访问（至少 1 条，有 reason） | 通过 | 3 条：Actions · org/repo 0.87「你正在查看 PR，同仓库 CI 页面最近访问频率较高……」；Fix login redirect bug 0.80「同仓库的 Issue 可能与本次改动相关」；useState – React 0.46 | explore/7.png |
| 8 自然语言规则 → 解析 → 确认保存 | 通过 | 输入「把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档」，解析出 2 张卡片：建议归档「github.com · /issues/ · 7 天」（高）、永不归档「docs.internal.com」（高），默认勾选；点击「确认保存 2 条」后提示「已保存 2 条规则」，rules-count=2，GET /api/rules 中有 rule_1、rule_2 | explore/8.png、explore/9.png |
| 9 旧页面整理建议，与规则一致 | 通过 | 归档 2：google 搜索（已 35 天，默认 14 天阈值）、issues/100（已 24 天，带「规则」标签，原文「把 7 天没访问过的 GitHub issue 建议归档」）；重复 1：issues/123 与 issues/123?tab=comments；保留 1：docs.internal.com/ai-agent-design（「被保护域名配置」，带规则标签）。与 GET /api/pages/cleanup-suggestions 一致 | explore/10.png、explore/11.png |

## 发现的问题

### ACCEPTANCE-BUG-1（product_bug，界面）：鼠标悬停在「同步浏览器上下文」主按钮上时文字看不见

- 复现：打开 popup，把鼠标移到 `sync-button` 上（也可以在点击同步后，鼠标停在按钮上不动）。
- 期望：主按钮悬停时仍是品牌色背景加白字，或者有可读的悬停样式。
- 实际：计算样式为 `color: rgb(255,255,255)`、`background: rgb(245,247,249)`，白字配近白底，按钮文字几乎不可见。演示第 5 步点击同步后，鼠标通常就停在按钮上，因此一定会看到。
- 原因：`extension/popup/popup.css` 第 106 行 `button:hover:not(:disabled) { background: var(--color-bg); }` 的优先级 (0,2,1) 高于第 108 行 `button.primary { … background: var(--color-brand); }` 的 (0,1,1)，悬停时背景被覆盖，文字颜色仍是 #fff。
- 证据：explore/12.png（悬停态，第 7 轮复现：color rgb(255,255,255)、background rgb(245,247,249)）；TC-UI-PRIV-004 的 explore/r5-2.png 中也能看到同样现象。

### 观察项（不判定为缺陷）

- 首次打开诊断页时，「当前规则数量」显示警告「规则数不一致：本地 未缓存，后端 0；已自动重新拉取 0 条规则」。这符合技术方案（本地 cache.rules 条数与 health.ruleCount 对比），但全新安装时本地无缓存、后端 0 条，也算「不一致」，演示时会多出 1 个警告。建议无缓存且后端为 0 时直接判为通过。
- popup 固定高度 600px，顶部「当前页面 + 同步区」约占 310px，各页签内容区比较窄，演示时需要在内部滚动。
