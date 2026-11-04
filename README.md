# 浏览器导航助手

> **提交包说明**：平台上传限制为最多 200 个文件、单个文件不超过 1MB、总计不超过 10MB。因此源码和 `docs/01`–`08` 原样提交，测试脚本（`tests/`）、追溯数据（`docs/trace` 等）、流程资产（`.workflow`、`.agents`、`specs`）和测试证据（`evidence/`）以压缩包形式放在 `bundles/` 下。运行 `scripts/unpack-bundles.sh` 可以一键还原，详见 [bundles/README.md](bundles/README.md)。

一个 Chrome Manifest V3 插件加一个本地 Node.js 后端。插件读取当前页面、打开的标签页和浏览历史，在本地过滤掉隐私敏感 URL 后上传到后端。后端负责：

- 按 URL 去重保存页面，并给历史页面**评分排序**；
- 根据当前上下文**推荐下一步访问的页面**；
- 识别**旧页面和重复页面**，给出整理建议；
- 把**自然语言规则**解析为结构化配置，并让规则参与排序、整理和推荐；
- 提供**健康检查和配置查询**，供插件的启动诊断使用。

不调用 LLM，推荐和规则解析都是可解释的规则引擎。后端零运行时依赖（只用 Node 原生 `http` 模块），插件不需要构建，可以直接加载。

> 需求真相源：[PROBLEM.md](PROBLEM.md)、[resource.json](resource.json)（只读）。详细设计：[PRD](docs/02-PRD.md)、[后端方案](docs/03-技术方案-后端.md)、[前端方案](docs/04-技术方案-前端.md)、[系统架构](docs/05-系统架构.md)。

---

## 目录

- [目录结构](#目录结构)
- [快速开始](#快速开始)
- [架构说明](#架构说明)
- [API 列表](#api-列表)
- [数据模型](#数据模型)
- [评分策略说明](#评分策略说明)
- [推荐策略说明](#推荐策略说明)
- [整理建议说明](#整理建议说明)
- [规则解析说明](#规则解析说明)
- [隐私过滤](#隐私过滤)
- [诊断说明](#诊断说明)
- [测试说明](#测试说明)
- [需求追溯](#需求追溯)
- [演示脚本（验收 1–10 步）](#演示脚本验收-110-步)
- [面试追问要点](#面试追问要点)

---

## 目录结构

```
浏览器导航助手/
├── PROBLEM.md / resource.json      # 题目与样例数据（真相源，只读）
├── README.md
├── package.json                    # 仅测试依赖（@playwright/test 等）；后端没有运行时依赖
├── playwright.config.mjs           # 测试配置：自动拉起后端（ENABLE_TEST_API=1）
├── extension/                      # Chrome MV3 插件（无构建步骤）
│   ├── manifest.json
│   ├── background/
│   │   ├── service-worker.js       # 消息路由、右键菜单事件（监听器在顶层同步注册）
│   │   ├── handlers/               # 每类消息一个处理器：context / sync / ranked / recommend / cleanup / rules / diagnostics …
│   │   └── services/               # api-client、collector（tabs/history）、privacy、sync、cursor（增量）、cache、diagnostics、context-menu …
│   ├── popup/
│   │   ├── popup.html / popup.js   # 外壳：6 个页签（首页、上下文、排序、整理、规则、诊断）
│   │   ├── lib/                    # 消息封装、事件总线、缓存优先渲染、DOM 工具
│   │   └── views/                  # 各区块视图（current-page、sync、recommend、ranked、cleanup、rule-parse、rule-list、diagnostics …）
│   └── shared/                     # 常量、消息名、storage key、URL 工具、日志
├── server/src/                     # 后端（Node.js ESM，原生 http）
│   ├── index.js / app.js / config.js   # 启动编排、请求生命周期与 CORS、唯一的环境变量入口
│   ├── routes/                     # 参数校验 + 调 service，不含业务规则
│   ├── services/                   # 业务编排：sync、rank、recommend、cleanup、rule、privacy、health、config …
│   ├── domain/                     # 纯函数：URL 归一化、评分、理由、推荐召回、整理判定、规则解析
│   ├── store/                      # 内存仓储 + 二级索引 + JSON 快照持久化
│   └── lib/                        # http、校验、日志、时钟、错误
├── scripts/
│   ├── start.sh                    # 启动后端并打印 /api/health
│   ├── test.sh                     # 测试统一入口（参数透传给 playwright test）
│   ├── import-sample.mjs           # 导入样例（时间平移后走真实 POST /api/sync）
│   ├── print-health.mjs            # start.sh 使用：端口占用检查与健康检查打印
│   └── bench-perf.mjs              # 10 万页面性能基准
├── resources/sample-history.json   # 样例数据（与 resource.json 内容一致）
├── data/snapshot.json              # start.sh 启动时的 JSON 快照（后端持久化）
├── tests/
│   ├── api/  <CaseID>.spec.mjs     # 接口用例（一个 Case ID 一个文件）
│   ├── e2e/  <CaseID>.spec.mjs     # 多接口编排的端到端用例
│   ├── ui/   <CaseID>.spec.mjs     # 加载真实插件、操作 popup 的 UI 用例
│   └── fixtures/                   # 共享夹具：api / evidence / extension / mutation / sample
├── evidence/<CaseID>/              # 每个用例的执行证据（结果、请求响应、日志、截图、GIF）
├── docs/                           # 需求理解、PRD、技术方案、架构、测试用例、追溯数据
│   └── trace/                      # requirements / features / code-points / cases / 契约 / matrix.md
└── specs/                          # 前后端代码规范与检查脚本
```

---

## 快速开始

### 1. 环境

| 依赖 | 版本 | 说明 |
|---|---|---|
| Node.js | 开发和测试使用 v24（需内置 `fetch`，建议 ≥ 20） | 后端只用标准库，不需要 `npm install` 就能启动 |
| Chrome / Chromium | 支持 Manifest V3 的版本 | 加载 `extension/` |
| npm 依赖 | `npm install` | 只有运行测试时需要（Playwright） |

### 2. 启动后端

```bash
./scripts/start.sh                 # 默认 http://127.0.0.1:3000
PORT=4120 ./scripts/start.sh       # 更换端口
```

`start.sh` 会依次：

1. 检查端口是否被占用，被占用时直接提示「请用 PORT=<端口> 更换端口」并退出，不会连到别人的服务；
2. 设置 `SNAPSHOT_FILE=data/snapshot.json`，开启 JSON 快照持久化（重启后数据不丢）；
3. 用 `exec node server/src/index.js` 启动服务，健康检查通过后在终端打印一行 `/api/health` 的返回，例如：

```json
{"status":"ok","version":"1.0.0","uptime":0,"pageCount":0,"ruleCount":0,"enabledRuleCount":0,"lastSyncAt":null,"persistence":"snapshot","startedAt":1793662965875}
```

后端环境变量（只在 `server/src/config.js` 读取）：

| 变量 | 默认 | 用途 |
|---|---|---|
| `PORT` / `HOST` | `3000` / `127.0.0.1` | 监听地址 |
| `SNAPSHOT_FILE` | 未设置（纯内存）；`start.sh` 设为 `data/snapshot.json` | JSON 快照文件，设置后启用持久化 |
| `ENABLE_TEST_API` | 未设置 | 为 `1` 时注册 `POST /api/__test__/reset`（只供测试） |
| `LOG_FILE` / `LOG_LEVEL` | 未设置 / `info` | JSON 日志追加到文件；级别 debug / info / warn / error |

想从空数据开始演示：停掉后端，删除 `data/snapshot.json` 再启动；或者用 `SNAPSHOT_FILE= ./scripts/start.sh`（显式置空）以纯内存模式启动。快照文件为空或损坏时，后端会打一条 warn 日志并以空数据启动。

### 3. 在 Chrome 开发者模式加载插件

1. 打开 `chrome://extensions`，打开右上角的「开发者模式」；
2. 点击「加载已解压的扩展程序」，选择项目中的 `extension/` 目录；
3. 把「导航助手」固定到工具栏，点击图标打开 popup。

插件默认连接 `http://127.0.0.1:3000`。如果后端换了端口，在 popup 的「诊断」页签修改 API Base URL 并保存（修改地址会清空增量同步游标，下次同步自动改为全量）。

manifest 中声明的权限及用途：

| 权限 | 用途 |
|---|---|
| `tabs` | `chrome.tabs.query` 读取当前窗口和所有普通窗口的标签页 URL、标题 |
| `history` | `chrome.history.search` 读取最近浏览历史（默认 30 天内、最多 100 条） |
| `storage` | `chrome.storage.local` 保存 API 地址、同步状态、增量游标、结果缓存、诊断结果 |
| `activeTab` | 读取用户当前正在看的页面 |
| `contextMenus` | 右键菜单「添加到分析」「标记为重要」（进阶功能） |
| `host_permissions`: `http://localhost/*`、`http://127.0.0.1/*` | 允许 service worker 调用本地后端；后端 CORS 也只放行插件和本机来源 |

### 4. 导入样例数据（可选，推荐用于演示）

`chrome.history.addUrl` 不能指定访问时间和次数，造不出「14 天没访问」的旧页面。所以提供了导入脚本：

```bash
node scripts/import-sample.mjs                               # 导入到 http://127.0.0.1:3000
API_BASE=http://127.0.0.1:4120 node scripts/import-sample.mjs
```

脚本读取 `resources/sample-history.json`，把所有 `lastVisitTime` 整体平移到「最新一条 = 当前时间 − 5 分钟」（保持各条之间的时间间隔），然后通过真实的 `POST /api/sync` 导入，最后打印同步结果和健康检查：

```json
{"ok":true,"syncedAt":…,"received":14,"created":10,"updated":4,"rejected":0,"rejectedByReason":{"invalid_url":0,"privacy":0},"pageCount":10,"mode":"full"}
```

为什么要平移：`resource.json` 的时间戳在 2024 年 3 月，如果原样导入，所有页面都会「已经几百天没访问」，排序和整理建议就失去区分度。

---

## 架构说明

完整的架构图、模块边界、时序图和文件归属见 **[docs/05-系统架构.md](docs/05-系统架构.md)**。这里是概要：

```
┌──────────────────────── Chrome 插件（MV3） ───────────────────────┐
│ popup（页面）                     background service worker      │
│  views/* ── chrome.runtime ──▶ handlers/*  ──▶ services/*         │
│  只渲染、只发消息                 │ tabs / history API（collector） │
│  cache-first 先读缓存             │ privacy 本地过滤（上传前）       │
│                                   │ api-client（超时、错误归一）    │
│                                   │ chrome.storage.local（状态/缓存）│
└───────────────────────────────────┼──────────────────────────────┘
                                    │ HTTP JSON（x-request-id）
┌───────────────────────────────────▼──── 后端 Node.js ─────────────┐
│ app.js（CORS、请求日志、错误信封） → routes（校验） → services      │
│   → domain（纯函数：评分、推荐召回、整理判定、规则解析）            │
│   → store（Map 主表 + 索引：dupKey / domain / repo / openSet）      │
│   派生：排序快照（含域名/仓库 Top-50 桶）、推荐缓存、关键词表       │
│   持久化：JSON 快照（防抖 1s，tmp + fsync + rename 原子替换）       │
└──────────────────────────────────────────────────────────────────┘
```

### 插件各模块职责

| 模块 | 职责 |
|---|---|
| **popup** | 展示当前页面（标题、URL、☆ 标记重要）、同步按钮与同步状态、推荐 Top 3、排序概览 Top 5、整理摘要、规则快捷输入、诊断入口；另有上下文 / 排序 / 整理 / 规则 / 诊断页签。popup 不直接调后端，也不直接调 tabs / history，一律通过 `chrome.runtime.sendMessage` 交给 service worker。 |
| **background service worker** | 在模块顶层同步注册 `onMessage`、`onInstalled`、`contextMenus.onClicked`，保证 SW 被唤醒时能立即收到事件；按消息类型分发给 `handlers/`（共 24 种消息，见 `extension/shared/messages.js`）；所有结果统一为 `{ ok, data }` 或 `{ ok:false, error:{code,message} }`，不向 popup 抛异常。 |
| **services** | `collector` 读取 tabs / history（排除无痕和插件自身页面）；`privacy` 上传前过滤；`sync` 单飞同步（多个入口共享同一个 Promise）；`cursor` 增量游标；`cache` 结果缓存与离线降级；`recovery` 后端恢复后自动补同步一次；`diagnostics` 11 项诊断；`context-menu` 右键菜单。 |
| **content script** | 未实现（题目为可选）。当前页是 `chrome://` 等系统页时，popup 显示「系统页 · 跳过」，同步时也不上传。 |

**popup 与 SW 不共享内存**：同步状态、游标、缓存都存在 `chrome.storage.local`，popup 通过 `storage.onChanged` 订阅更新。SW 随时可能被回收，同步状态带 `startedAt`，超过 30 秒仍是 `syncing` 且当前 SW 没有在执行同步，就判定为中断并允许重试。

### 后端分层

| 层 | 规则 |
|---|---|
| `routes/` | 只做参数校验（白名单字段、长度、数组上限），校验全部通过才调用 service |
| `services/` | 业务编排；写操作完成后递增版本号（data / rule / config），派生缓存据此失效 |
| `domain/` | 纯函数，不读时间、不读仓储，便于单独验证 |
| `store/` | 唯一持有状态；对外只返回深拷贝 |

---

## API 列表

所有接口都是 JSON。错误统一为 `{"error": {"code", "message", "details?"}}`，响应头带 `x-request-id`（请求头传入时原样回传，便于串联插件日志和后端日志）。

### 题目要求的接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/sync` | 上报 `activeTab`、`openTabs`、`history`（可带 `mode: full / incremental`、`cursor`、`clientVersion`）。返回 `{ ok, syncedAt, received, created, updated, rejected, rejectedByReason{invalid_url, privacy}, pageCount, mode }` |
| `GET` | `/api/pages/ranked` | 评分排序。查询参数 `limit`（1–500，默认 20）、`domain`（含子域）、`openOnly`。返回 `{ pages[], total, domains[], generatedAt }`，每页带 `score`、`scoreDetail`、`reason` |
| `POST` | `/api/recommendations/next` | 下一步推荐。请求 `{ currentPage, openTabs, recentHistory }`（`currentPage` 必填，可为 `null`）。返回 `{ recommendations[], cached, generatedAt }`，最多 5 条 |
| `GET` | `/api/pages/cleanup-suggestions` | 整理建议。返回 `{ summary{archive, merge, keep}, suggestions[], thresholdDays, generatedAt }` |
| `POST` | `/api/rules/parse` | 自然语言解析（只预览，不保存）。请求 `{ text }`（1–500 字）。返回 `{ rules[], unparsed[], warnings[] }` |
| `POST` | `/api/rules` | 保存用户勾选的规则 `{ rules: [...] }`（1–20 条）。后端重新校验并分配正式 id，返回 201 `{ rules, ruleCount }` |
| `GET` | `/api/rules` | 已保存规则列表 `{ rules, total }`（含停用的） |
| `DELETE` | `/api/rules/:id` | 删除规则，返回 `{ deleted, ruleCount }`；不存在返回 404 |
| `GET` | `/api/health` | `{ status, version, uptime, pageCount, ruleCount, enabledRuleCount, lastSyncAt, persistence, startedAt }` |
| `GET` | `/api/config` | `{ cleanupThresholdDays, maxHistoryItems, enablePrivacyFilter, privacySensitiveKeywords, baseSensitiveKeywords, historyLookbackDays, recencyHalfLifeDays, weights, minRecommendationScore, apiVersion, limits }` |

### 扩展接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `PATCH` | `/api/rules/:id` | 启用 / 停用规则 `{ enabled }` |
| `PUT` | `/api/config` | 部分更新配置（整理阈值、历史条数、回溯天数、隐私开关与关键词），整批校验通过才生效 |
| `POST` | `/api/pages/archive` | 归档 `{ urls }`，返回 `{ ok, affected, archivedAt, notFound }` |
| `POST` | `/api/pages/unarchive` | 撤销归档 |
| `POST` | `/api/pages/merge` | 合并重复页 `{ urls(2–50), keepUrl }` |
| `POST` | `/api/pages/manual` | 右键「添加到分析」：单页加入（source=`manual`） |
| `POST` | `/api/pages/important` | 右键 / ☆「标记为重要」`{ url, title, important }` |
| `POST` | `/api/__test__/reset` | 清空全部状态。**只有 `ENABLE_TEST_API=1` 时注册**，生产启动不存在 |

`GET /api/pages/ranked`、`GET /api/pages/cleanup-suggestions`、`POST /api/recommendations/next` 支持 `?now=<毫秒时间戳>` 覆盖计算时刻，用于测试和复算；非法值返回 400，不会悄悄回退到当前时间。

### 错误码

| HTTP | code | 场景 |
|---|---|---|
| 400 | `VALIDATION_FAILED` | 字段不合法，`details.fields` 给出字段路径（如 `openTabs[3].url`） |
| 400 | `INVALID_JSON` | 请求体不是合法 JSON |
| 404 | `NOT_FOUND` | 接口或规则不存在 |
| 405 | `METHOD_NOT_ALLOWED` | 路径存在但方法不支持，响应头带 `Allow` |
| 413 | `PAYLOAD_TOO_LARGE` | 请求体超过 1 MB，或单次同步数组超过 500 条 |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | 不是 `application/json` |
| 500 | `INTERNAL` | 未预期的异常（只返回 reqId，堆栈只写日志） |

完整契约：[docs/trace/api-contract.json](docs/trace/api-contract.json)。

---

## 数据模型

### 页面（Page）

```json
{
  "id": "page_2",
  "url": "https://github.com/org/repo/issues/123",
  "normalizedUrl": "https://github.com/org/repo/issues/123",
  "dupKey": "github.com/org/repo/issues/123",
  "domain": "github.com",
  "repo": "org/repo",
  "title": "Fix login redirect bug",
  "visitCount": 8,
  "lastVisitedAt": 1710090000000,
  "firstSeenAt": 1710090000000,
  "sources": ["history", "open_tab"],
  "isOpen": true,
  "isActive": false,
  "isImportant": false,
  "isArchived": false,
  "archivedAt": null,
  "mergedInto": null,
  "updatedAt": 1710100000000
}
```

| 字段 | 口径 |
|---|---|
| `normalizedUrl` | **存储主键**。去掉 hash 和跟踪参数（`utm_*`、`ref`、`ref_src`、`spm`、`from`、`fbclid`、`gclid`、`_ga`），其余 query 排序后保留，去掉末尾 `/`，不含 URL 里的用户名密码 |
| `dupKey` | **判重 key**（比主键更宽）。host 去 `www.` + path 去末尾 `/` + 只保留有语义的 query（`q`、`query`、`wd`、`keyword`、`search`、`v`、`id`）。所以 `issues/123` 和 `issues/123?tab=comments` 主键不同、dupKey 相同，会被识别为重复页 |
| `visitCount` | 取 `max(已有值, 本次 history.visitCount)`，最小为 1。重复同步同一批数据不会累加 |
| `lastVisitedAt` / `firstSeenAt` | 分别取最大 / 最小值；当前活动标签页按服务器当前时间计；客户端时间超前 5 分钟以上会被纠正 |
| `sources` | `active_tab` / `open_tab` / `history` / `manual` 的并集 |
| `isOpen` / `isActive` | 以**最近一次同步快照**为准：本次出现在 openTabs / activeTab 中为 true，其余全部置 false |
| `score` / `scoreDetail` / `reason` | **不落库**，由排序快照在读时计算（随时间衰减） |

### 规则（Rule）

```json
{
  "id": "rule_1",
  "rawText": "把 7 天没访问过的 GitHub issue 建议归档",
  "type": "archive_candidate",
  "domain": "github.com",
  "urlPattern": "/issues/",
  "inactiveDays": 7,
  "action": "suggest_archive",
  "enabled": true,
  "confidence": "high",
  "createdAt": 1710100000000,
  "updatedAt": 1710100000000
}
```

| type | action | 专有字段 | 作用 |
|---|---|---|---|
| `archive_candidate` | `suggest_archive` | `inactiveDays`（1–3650） | 命中范围的页面用自己的天数阈值判定归档 |
| `never_archive` | `keep` | `domain` 或 `urlPattern` 至少一个 | 永不归档，整理建议中输出 keep；排序时域名分取满分 |
| `recommend_related` | `recommend` | `trigger{domain, minCount}`、`target{domain}` | 连续浏览触发站点 N 个页面后推荐目标站点 |
| `privacy_filter` | `exclude_upload` | `keywords[]`（1–20 个） | 关键词并入有效隐私关键词表 |
| `boost_domain` | `boost` | `domain` | 排序时域名分取满分 |

`rawText` 保存拆分后的子句原文。`domain` 匹配本域和子域（必须有 `.` 边界），`urlPattern` 是对 path + query 的子串匹配，两者同时存在时取交集。解析预览返回 `rule_1`、`rule_2`…（与题目示例一致），保存时由后端重新分配正式 id，删除后 id 不复用。

### 推荐（Recommendation）

```json
{
  "id": "rec_3",
  "type": "next_visit",
  "url": "https://github.com/org/repo/actions",
  "title": "Actions · org/repo",
  "score": 0.87,
  "reason": "你正在查看 PR，同仓库 CI 页面最近访问频率较高，可能需要检查构建状态",
  "strategy": "same_repo",
  "contextUrl": "https://github.com/org/repo/pull/456",
  "createdAt": 1710100000000
}
```

`strategy` 取值：`rule` / `same_repo` / `same_doc_site` / `same_domain` / `global_top`。推荐只读不写，不落库。

### 其他后端状态

| 实体 | 内容 |
|---|---|
| Settings | `cleanupThresholdDays`=14、`maxHistoryItems`=100、`historyLookbackDays`=30、`enablePrivacyFilter`=true、`privacySensitiveKeywords`=[password, token, bank, secret] |
| SyncLog | 最近 50 次同步的计数和耗时（**不记录 URL**） |
| 版本号 | `data` / `rule` / `config` 三个单调递增计数，是排序快照、推荐缓存、关键词表的失效依据 |
| 索引 | `dupKey`、`domain`、`repo`、`openSet`、`domainVisits`，写入时增量维护 |

### 插件本地存储（chrome.storage.local）

| key | 内容 |
|---|---|
| `apiBaseUrl` | 后端地址，默认 `http://127.0.0.1:3000` |
| `syncState` | `{status: idle/syncing/success/error, startedAt, lastSuccessAt, lastError, cursor, cursorBase, mode, stats}` |
| `cache` | `ranked` / `recommendations`（按当前页 URL 分桶，最多 20 个）/ `cleanup` / `rules` / `config`，每项 `{data, cachedAt}` |
| `connection` | 连接状态、最近错误码、`recoverPending`（后端恢复后是否要补同步） |
| `importantUrls`、`ignoredSuggestions`（7 天过期）、`lastCleanupAction`（撤销用）、`lastDiagnostics`、`lastMenuAction` | 各功能的本地状态 |

### 持久化方案

| 阶段 | 方案 | 状态 |
|---|---|---|
| 内存 | `Map` 主表 + 二级索引 | 默认；测试使用 |
| JSON 快照 | 状态变更后防抖 1 秒；写 `<file>.<pid>.tmp` → fsync → rename 原子替换；SIGTERM / SIGINT 时同步刷盘；启动时校验 schema 和每条记录，不合法则告警并以空数据启动 | **已实现**（`start.sh` 默认开启） |
| SQLite | 表 pages / rules / sync_logs / settings；`normalized_url UNIQUE` 做 UPSERT；`(domain, static_score)` 索引支持 Top-K 召回；WAL 模式 | 只写了方案（`node:sqlite` 在 Node 24 仍是实验特性） |

演进时只替换 `store/*.js` 的实现，仓储函数签名不变，services / domain / 插件都不用改。

---

## 评分策略说明

```
score = 0.4 × recency + 0.3 × frequency + 0.2 × isOpen + 0.1 × domainBoost      （0–1，保留 2 位小数）
```

| 维度 | 权重 | 计算方式 | 为什么这样取 |
|---|---|---|---|
| recency 时效 | 0.4 | `0.5 ^ (未访问天数 / 7)`，7 天半衰期 | 「最近在用」是判断页面是否重要的最强信号；用指数衰减而不是线性，避免 30 天和 60 天之后的页面分数一样都是 0 |
| frequency 频次 | 0.3 | `ln(1 + visitCount) / ln(1 + 全库最大 visitCount)` | 对数压缩，避免一个访问了 200 次的首页把其他页面都压成 0 |
| isOpen 打开 | 0.2 | 当前打开为 1，否则为 0 | 用户正开着的页面大概率还要用 |
| domainBoost 域名 | 0.1 | 按优先级取第一个命中：标记为重要 = 1；命中 `never_archive` 规则 = 1；命中 `boost_domain` 规则 = 1；否则 = 该域名总访问量 / 访问量最大的域名 | 权重最低，只做同分时的微调；同时是规则影响排序的入口 |

- 归一化只统计未归档页面；同分时按 `lastVisitedAt` 降序。
- `scoreDetail` 返回四个分量和 `domainSource`（important / protected / boost / affinity），可以逐项复算：`0.4×recency + 0.3×frequency + 0.2×open + 0.1×domain` 与 `score` 的差不超过 0.01。权重和半衰期也通过 `GET /api/config` 公开，popup 排序页显示公式。
- **排序理由**按优先级最多取 3 句，用「，」连接：正在浏览 → 访问情况（「最近 3 天内多次访问（8 次）」「今天访问过」「已 20 天未访问」等）→ 高频访问 → 当前仍处于打开状态 → 域名来源（「已被你标记为重要」「属于受保护域名」「命中优先域名规则」「常用域名 github.com」）。

导入样例后立即查询（无规则），排序结果为：

| 页面 | score | 说明 |
|---|---|---|
| github.com/org/repo/issues/123 | 1.00 | 8 次访问（全库最多）、打开中、github.com 访问量最大 |
| github.com/org/repo/pull/456 | 0.94 | 正在浏览，5 次 |
| developer.mozilla.org/…/Fetch_API | 0.83 | 打开中，4 次 |
| react.dev/reference/react/useState | 0.69 | |
| react.dev/learn | 0.57 | |
| docs.internal.com/ai-agent-design | 0.56 | 打开中，但 7 天前访问 |
| github.com/org/repo/issues/100 | 0.23 | 24 天未访问 |
| google.com/search?q=… | 0.11 | 35 天未访问 |

**取舍**：没有引入停留时长、点击序列等题目数据中没有的信号；权重固定写在 `config.js`，是为了让结果可以手算、可以测试。如果以后要个性化，可以改为按用户对推荐的点击反馈调权重。

**性能**：排序结果是一个「排序快照」，写入后用 `setImmediate` 在后台预建；快照 60 秒内直接复用，60 秒到 1 小时之间先返回旧快照、后台刷新，超过 1 小时或版本号变化时同步重建。读接口不会每次全量打分。

---

## 推荐策略说明

两阶段：**召回**（每种策略只读排序快照里对应的 Top-50 桶，合并后最多 200 个候选）→ **打分过滤**。

| 策略 | 触发条件 | 关联度 rel | 理由示例 |
|---|---|---|---|
| `rule` | 已保存的 `recommend_related` 规则被触发：最近 20 条历史中，从最新开始连续 N 个不同的触发站点页面 | 0.95 | 「你已连续浏览 3 个 React 页面，按你的规则推荐相关 MDN 页面」；库里没有目标站点的页面时，推荐站内搜索（固定 0.8） |
| `same_repo` | 当前是 GitHub 页面，候选是同一 owner/repo | PR→Actions 1.0；Issue→PR 0.9；PR→Issue 0.8；其他 0.7 | 「你正在查看 PR，同仓库 CI 页面最近访问频率较高，可能需要检查构建状态」 |
| `same_doc_site` | 当前是文档页（MDN、react.dev、docs.internal.com、vuejs.org、nodejs.org，或路径含 /docs、/reference、/learn、/guide） | 0.8 | 「你正在看 react.dev 文档，这是同站点访问 6 次的高频页面」 |
| `same_domain` | 非文档页的同域名 | 0.6 | 「与当前页面同域名，历史评分较高（0.83）」 |
| `global_top` | 兜底：全局高分页面 | 0.3 | 「近期综合评分较高的页面，可作为备选」 |

```
final = 0.6 × rel + 0.4 × 页面 score
```

过滤：排除当前页、已打开的页（按 dupKey，所以 `?tab=comments` 这种变体也排除）、已归档和本应归档的页、`final < 0.3` 的候选；同一 dupKey 只保留最高分；最多返回 5 条，popup 首页展示前 3 条。

相同上下文（当前 URL + 打开页集合 + 最近历史 + 三个版本号）的结果缓存 60 秒，返回中 `cached: true`。同步、规则、配置任何一个变化都会让旧缓存失效。

---

## 整理建议说明

每个未归档页面按以下顺序判定，**命中即停**：

| 顺序 | 条件 | 输出 |
|---|---|---|
| 1 | 命中启用的 `never_archive` 规则 | `keep`，理由「被保护域名配置（docs.internal.com），不建议归档」 |
| 2 | 已标记为重要 | `keep`，理由「你已标记为重要，不建议归档」 |
| 3 | 当前打开中 | 不建议归档 |
| 4 | 命中 `archive_candidate` 规则，且未访问天数 > 规则天数 | `archive`，理由引用规则原文；命中多条时取天数最小的 |
| 5 | 未访问天数 > 默认阈值（`cleanupThresholdDays`=14） | `archive`，理由「超过 14 天未访问（已 35 天），且不在当前打开的 tab 中」 |

另外，dupKey 相同的未归档页面（至少 2 个）输出一条 `merge` 建议，保留 URL 最短的那个，理由「去掉 query 参数后 URL 相同，疑似重复页面」。

- 天数按**整天向下取整**，必须**严格大于**阈值：阈值 14 天时，未访问 14 天 23 小时不归档，满 15 天才归档。
- 输出顺序：archive（按天数降序）→ merge → keep。每条建议都有稳定的 `key`（`archive:<normalizedUrl>` / `merge:<dupKey>`），插件的「忽略」按 key 记录在本地，7 天后过期。
- popup 支持「归档 / 合并 / 忽略」并可撤销最近一次操作。

---

## 规则解析说明

实现位于 `server/src/domain/rule-clauses.js`（分句）、`rule-lexicon.js`（要素抽取）、`rule-parser.js`（分类与组装）、`rule-diagnose.js`（无法识别与冲突）。流程：

```
文本 → 分句 → 每个子句：不支持句式检查 → 分类（5 种动作）→ 抽取天数 / 域名 / 页面类型 / 关键词 / 次数
     → 成功放入 rules，失败放入 unparsed（附原因和例句）→ 与已保存的启用规则做冲突检测 → warnings
```

### 分句

- 按 `；` `;` `。` 换行，以及「但 / 但是 / 另外 / 同时 / 而且 / 并且」切分；
- 逗号默认也切分，但两种情况保留：条件句的条件部分（「如果我连续看了 3 个 React 文档，推荐相关 MDN 页面」不拆开）；关键词列表（「包含 password，token 的 URL」不拆开）。

### 动作识别（按优先级）

| 类型 | 触发词 |
|---|---|
| `privacy_filter` | 不要 / 别 / 不 / 禁止 + 上传 / 同步 / 采集 / 记录；隐私过滤；屏蔽 |
| `recommend_related` | 推荐；建议看 / 打开 / 访问 |
| `never_archive` | 不要 / 别 / 不需要 / 禁止 / 无需 / 不用 / 不能 …（可带「再 / 自动 / 建议」）+ 归档 / 关闭 / 清理 / 删除；保留；保护；白名单 |
| `archive_candidate` | 归档、清理、关闭、收起 |
| `boost_domain` | 优先、置顶、重要、加权、提升 |

否定先于肯定判断，所以「永远不要归档」不会被识别成归档。

### 要素抽取

| 要素 | 支持的写法 |
|---|---|
| 天数 | 阿拉伯数字或中文数字（七、十四、两、二十…）+ 天 / 日 / 周 / 星期 / 个月；周 = 7 天，月 = 30 天。没写天数时默认 14 天，并标记 `confidence: medium` 和提示「未指定天数，使用默认 14 天」 |
| 域名 | 显式域名（`docs.internal.com`，去 `www.`）；别名：GitHub → github.com、MDN → developer.mozilla.org、React → react.dev、Google / 谷歌 → google.com、Stack Overflow → stackoverflow.com、npm → npmjs.com、飞书 → feishu.cn、语雀 → yuque.com |
| 页面类型 → `urlPattern` | issue → `/issues/`、PR / pull request → `/pull/`、actions / CI → `/actions`、搜索结果 / 搜索页 → `/search` |
| 关键词 | 「包含 / 含有 / 带有 / 含」之后、「的 URL / 网址 / 链接 / 页面」之前，按 `、` `，` 空格 `和` `及` 拆分 |
| 次数 | 「连续 / 一连 + 看 / 访问 / 浏览 / 打开 + N 个 / 篇 / 次 / 页」，1–20；没写默认 3 次 |

### 支持的句式示例

| 输入 | 结果 |
|---|---|
| 把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档 | 2 条：`archive_candidate`（github.com、/issues/、7 天）+ `never_archive`（docs.internal.com） |
| 七天没访问的 GitHub issue 建议归档 | `inactiveDays: 7` |
| 两周没看的搜索结果页建议归档 | `urlPattern: /search`、`inactiveDays: 14` |
| 1 个月没访问的 GitHub issue 建议归档 | `inactiveDays: 30` |
| 别归档 github.com 的页面 | `never_archive` |
| 如果我连续看了 3 个 React 文档，推荐相关 MDN 页面 | `recommend_related`：trigger react.dev × 3，target developer.mozilla.org |
| 不要上传包含 password、token 的 URL | `privacy_filter`：keywords [password, token] |
| 飞书文档优先显示 | `boost_domain`：feishu.cn |

### 不支持的句式（放入 `unparsed`，附原因和可以照写的例句）

| 输入特征 | 返回的原因 |
|---|---|
| 没有任何动作词，如「帮我整理一下」 | 没有识别到动作（归档 / 不要归档 / 推荐 / 不上传 / 优先） |
| 相对日期：上周、本月、昨天、自从…以来 | 暂不支持相对日期，请明确写出未访问的天数 |
| 「或」条件 | 暂不支持“或”条件，请拆成独立规则 |
| 正则表达式 | 暂不支持正则表达式，请使用域名或页面类型 |
| 基于标题或正文的条件 | 暂不支持基于标题或正文的条件，请使用域名或页面类型 |
| 「不要归档」但没有域名或页面类型，如「别关闭 docs 页面」 | 识别到“不要归档”，但没找到作用的域名或页面类型 |
| 天数为 0、负数、小数、超过 3650，或「几天」「半个月」 | 归档天数必须是 1–3650 的明确正整数 |
| 推荐规则缺触发站点或目标站点 | 推荐规则需要“触发站点”和“推荐站点”两个对象 |
| 「不上传」但没有关键词 | 识别到“不上传”，但没找到要过滤的关键词 |

此外：

- 一句话里有多个域名时只取第一个，并在 `notes` 中提示「请拆句配置」；
- 新规则与已有规则（或同一次输入里的其他规则）在同域 / 子域上一个归档、一个永不归档时，`warnings` 返回「…与…冲突，执行时“永不归档”优先」；
- `text` 为空或超过 500 字返回 400。

**告知用户的方式**：所有规则都是「先预览再确认保存」。popup 把每条解析结果显示为卡片（类型、域名、页面类型、天数、置信度、提示），用了默认值的会标出来；无法识别的片段单独列出原因和例句。保存时后端会重新校验，不信任客户端传来的 id、action 和时间。

`RuleParser` 的接口是「输入文本，输出 `{rules, unparsed, warnings}`」，以后接入 LLM 时用同样的 JSON Schema 约束输出即可，插件不用改。

---

## 隐私过滤

两道防线：

1. **插件端（上传前）**：URL 转小写后包含任一敏感关键词（默认 password、token、bank、secret，以后端 `/api/config` 下发的为准，后端不可用时用缓存或内置默认值）就不上传；非 http(s) 的系统页和无痕窗口的标签页也不上传。同步状态显示「过滤 N 条」，但**不记录被过滤的 URL**。
2. **后端（入库前）**：同样的关键词（配置关键词 ∪ 启用的 `privacy_filter` 规则关键词）再检查一次，命中的计入 `rejectedByReason.privacy`；日志只记录拒收原因和域名计数，访问日志中含敏感词的路径记为 `***`。

关键词列表可以通过 `PUT /api/config` 修改，也可以用自然语言规则「不要上传包含 xxx 的 URL」追加。

---

## 诊断说明

popup「诊断」页签共 11 项检查，每项独立执行（一项异常不影响其他项），结果为 ok / warn / fail / info。每个 warn / fail 都附可以直接执行的排查步骤。支持「重新检测」和「复制诊断报告」（JSON，包含检查结果、插件版本、配置；URL 会被替换为 `[已移除 URL]`，只保留 API 地址）。顶栏显示连接状态，有失败项时诊断页签显示红点。

| # | 检查项 | 含义 / 判定方式 | 常见异常与排查 |
|---|---|---|---|
| 1 | 后端服务连接 | `GET /api/health`，3 秒超时，显示耗时；区分 4 类错误：连接被拒绝、超时、HTTP 非 200、返回不是 JSON | 运行 `./scripts/start.sh`；核对端口与 API Base URL 是否一致；确认 manifest 的 `host_permissions` 包含该地址；在浏览器直接打开 `<地址>/api/health` 自查 |
| 2 | tabs 权限 | `chrome.permissions.contains` + 真实 `tabs.query`，确认能读到标签页 URL | 检查 manifest 的 permissions 是否含 `tabs`；在 `chrome://extensions` 重新加载插件 |
| 3 | history 权限 | `permissions.contains` + 真实 `history.search`（只查 1 条，不保留） | 同上，检查 `history` |
| 4 | storage 可用 | 写入随机值 → 读回比对 → 删除，并报告已用字节数 | 检查磁盘空间或配额；重新加载插件 |
| 5 | API Base URL | 显示当前配置的后端地址，并检查是否有该地址的 host 访问授权 | 地址格式错误时保存会被拒绝；未授权时把地址加入 `host_permissions` 并重新加载插件 |
| 6 | 最近一次同步 | 最近成功同步时间和上传条数；失败时显示错误原因 | 从未同步 → 点「立即同步」；超过 24 小时 → 重新同步；后端数据少于本地记录（后端重启且为内存模式、或 pageCount=0）→ 提示全量同步 |
| 7 | 当前规则数量 | 本地缓存的规则条数与 `health.ruleCount` 比对；不一致时自动重新拉取一次 | 不一致时到规则页签刷新，再重新检测。全新安装、本地还没有规则缓存时，第一次检测也会提示「不一致」并自动拉取，再检测一次即为通过 |
| 8 | activeTab 权限 | `permissions.contains` | 检查 manifest |
| 9 | 隐私过滤 | 开关是否开启、关键词数量、配置来源（server / cache / default） | 来源不是 server 说明后端配置不可用，正在使用兜底配置；关键词为空时检查 `/api/config` |
| 10 | 无痕模式 | 信息项：是否允许在无痕模式运行 | 无论是否授权，无痕窗口的数据都不会被采集 |
| 11 | 版本兼容 | 后端 `version` 的主版本是否等于插件期望的主版本 1 | 升级插件或后端，使主版本一致 |

前 7 项是题目要求的，后 4 项是补充。常见的排查顺序：先看第 1 项（后端是否在运行、端口是否一致），再看第 5 项（地址是否正确、是否授权），然后看第 6 项（是否同步过）。

后端侧的排查：

- 启动失败：端口被占用时 `start.sh` 会直接提示换端口；
- 每个请求都有 `x-request-id`，插件发出的请求 id 为 `ext_<时间>_<序号>`，可以在后端日志（`LOG_FILE`）中按 id 找到对应的 access 日志；
- `GET /api/health` 的 `persistence` 字段显示是 `memory` 还是 `snapshot`，`startedAt` 和 `lastSyncAt` 用来判断后端是否重启丢过数据。

---

## 测试说明

### 分层

| 层 | 目录 | 数量 | 内容 |
|---|---|---|---|
| 接口（API） | `tests/api/` | 219 | 单接口：请求 → 响应字段、状态码、错误码 |
| 端到端（E2E） | `tests/e2e/` | 8 | 多接口编排的真实业务流程（同步 → 排序 → 规则 → 整理 → 推荐），每个用例至少 3 步、跨 2 个以上模块 |
| 界面（UI） | `tests/ui/` | 143 | Playwright 启动 Chromium 加载真实插件，操作 popup；只用 ui-contract 中登记的 `data-testid` 选择器 |

约定：

- **一个 Case ID 一个脚本文件**：`tests/<层>/<CaseID>.spec.mjs`，测试标题以 Case ID 开头；用例的第 n 条预期在脚本中对应以 `[En]` 开头的断言消息。
- **不 mock 后端**：Playwright 用 `TEST_PORT`（默认 4100）自己拉起真实后端（`ENABLE_TEST_API=1`），每个测试前调用 `POST /api/__test__/reset` 隔离状态；UI 测试只对 github.com 等外部站点做离线拦截，禁止拦截 `/api` 和 localhost。
- `workers=1`、`retries=0`：后端是共享内存状态，必须串行；不允许靠重试掩盖不稳定。
- 「旧页面」通过后端样例导入构造（时间平移或 `?now=` 覆盖），因为 `chrome.history.addUrl` 无法指定访问时间。

### 运行

```bash
npm install                                         # 首次运行
npx playwright install chromium                     # 如本机没有 Chromium
./scripts/test.sh                                   # 全部（参数原样透传给 playwright test）
./scripts/test.sh --project=api                     # 只跑接口层；e2e / ui 同理
./scripts/test.sh tests/api/TC-API-RANK-011.spec.mjs    # 单个用例
TEST_PORT=4201 ./scripts/test.sh -g TC-UI-DIAG-002  # 指定端口 + 按标题过滤
npm run test:case                                   # 技能流水线：静态检查 → 执行 → 失败分类 → 证据完整性 → 断言变异检查
node scripts/bench-perf.mjs http://127.0.0.1:3000   # 性能基准：对空后端导入 10 万页面，测推荐 / 排序的 p50 / p95
```

### evidence/ 留痕

测试夹具自动把每个用例的证据写入 `evidence/<CaseID>/`，脚本只需在关键步骤调用 `ext.snap(page, '步骤名')`：

| 文件 | 内容 |
|---|---|
| `result.json` | 执行结果、失败的 `[En]` 断言 |
| `api/NN-*.json` | 每次请求和响应（请求头 `x-request-id: <CaseID>-NN`） |
| `server.log` | 按偏移截取的本用例后端日志 |
| `extension.log` | service worker 和 popup 的 console 输出（UI） |
| `screenshots/`、`flow.gif` | UI 步骤截图和动图 |
| `explore.json`、`explore/` | UI 探索结论和截图（真实驱动插件后人工判读的结果） |

`evidence/index.json` 汇总所有用例的状态和证据完整性；当前 370 个用例全部为 passed，且证据完整。验收流程（PROBLEM.md 第 3–9 步）的整体探索记录见 [evidence/ACCEPTANCE-FLOW/explore.md](evidence/ACCEPTANCE-FLOW/explore.md)。

### 追溯矩阵与测试报告

- 追溯矩阵：[docs/trace/matrix.md](docs/trace/matrix.md)，由 `node .workflow/validators/validate.mjs trace` 自动生成，列出每个 Feature 对应的前后端代码点、用例和执行结果，并链接到 `evidence/<CaseID>/`。
- 测试用例文档：[docs/06-测试用例-接口与E2E.md](docs/06-测试用例-接口与E2E.md)、[docs/07-测试用例-UI.md](docs/07-测试用例-UI.md)。
- 测试报告：`docs/08-测试报告.md`（准出报告，由 `nav-quality-report` 技能产出，包含需求覆盖率、用例执行结果、代码行覆盖率、断言变异杀死率、证据完整率等）。
- 代码规范检查：`node specs/tools/check-spec.mjs --side=all`，结果在 `docs/quality/`。
- 门禁自检：`node .workflow/validators/validate.mjs <stage>`（prd / design / cases / scripts / code / run / gate / final / trace）。

---

## 需求追溯

```
REQ-NNN（PROBLEM.md 原文需求点）
  → F-<MOD>-NN（Feature，含验收标准 AC）
    → C-FE-<MOD>-NN / C-BE-<MOD>-NN（代码点，源码中以 // @code 注释标注）
      → TC-API / TC-E2E / TC-UI-<MOD>-NNN（用例，一个 Case ID 一个脚本）
        → evidence/<CaseID>/（执行证据）
          → docs/08-测试报告.md
```

| 层 | 数量 | 文件 |
|---|---|---|
| 需求点 REQ | 124（必做 96） | [docs/trace/requirements.json](docs/trace/requirements.json) |
| Feature | 75（本期实现 70） | [docs/trace/features.json](docs/trace/features.json)、[docs/02-PRD.md](docs/02-PRD.md) |
| 代码点 | 后端 60、前端 58 | [code-points-be.json](docs/trace/code-points-be.json)、[code-points-fe.json](docs/trace/code-points-fe.json) |
| 用例 | API 219、E2E 8、UI 143 | [cases-api.json](docs/trace/cases-api.json)、[cases-ui.json](docs/trace/cases-ui.json) |
| 设计决策 | D-01 ~ D-27 | features.json 的 `decisions` 与 PRD「决策记录」 |

模块划分：

| 模块 | 内容 | 模块 | 内容 |
|---|---|---|---|
| CTX | 插件加载与上下文读取 | DIAG | 启动诊断 |
| SYNC | 同步与入库 | PRIV | 隐私过滤 |
| RANK | 历史排序 | CACHE | 本地缓存 / 离线降级 |
| REC | 下一步推荐 | INCR | 增量同步 |
| CLEAN | 整理建议与执行 | PERF | 性能（Top-K 召回、推荐缓存） |
| RULE | 自然语言规则 | MENU | 右键菜单 |
| PERSIST | 后端持久化 | DEMO | 启动脚本与样例数据 |

本期不做（`inScope=false`）：F-CLEAN-09、F-PRIV-06、F-PERSIST-02（SQLite，只写方案）、F-HL-01（页面高亮）、F-SIM-01（标题相似度聚合）。

查某个 ID 的全部关联：`node .workflow/validators/validate.mjs q F-RANK-02`。在源码中查实现：`grep -rn "@code C-BE-RANK-01" server extension`。

---

## 演示脚本（验收 1–10 步）

准备：一个干净的 Chrome 用户目录（或新建 Chrome 个人资料），避免真实历史干扰演示。

| 步骤 | 操作 | 预期看到 |
|---|---|---|
| 1 启动后端 | （可选，清空旧数据）`rm -f data/snapshot.json`；然后 `./scripts/start.sh`，另开终端执行 `node scripts/import-sample.mjs` | 终端打印 health（`status: ok`）；导入输出 `received: 14, created: 10, updated: 4, pageCount: 10` |
| 2 加载插件 | `chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选择 `extension/` | 插件加载无报错，工具栏出现「导航助手」 |
| 3 诊断 | 打开 popup →「诊断」页签 | 后端服务连接、tabs 权限、history 权限均为 ok；API Base URL 显示 `http://127.0.0.1:3000`。此时「最近一次同步」为警告「从未同步」，首次检测时「当前规则数量」也可能因本地还没有规则缓存而提示一次警告，都属正常 |
| 4 打开测试页面 | 打开 `https://github.com/org/repo/pull/456`、`https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API`、一个 Google 搜索页，最后停留在 GitHub PR 页 | popup 顶部「当前页面」显示 PR 的标题和 URL；「上下文」页签列出打开的标签页和最近历史 |
| 5 同步 | 点击「同步浏览器上下文」 | 状态变为「同步成功 · 上传 N 条 · 过滤 0 条 · 时间」；若打开了含 token / password 的 URL，会显示「过滤 1 条」，后端查不到该 URL |
| 6 历史排序 | 首页「历史排序」Top 5，或「排序」页签 | 按分数降序，每条显示分数和理由（如「正在浏览，最近 3 天内多次访问（5 次），常用域名 github.com」）；展开可看四个分量；页面显示评分公式 |
| 7 推荐 | 首页「推荐下一步」 | 当前页是 PR 时，推荐 `Actions · org/repo`，理由「你正在查看 PR，同仓库 CI 页面最近访问频率较高，可能需要检查构建状态」，以及同仓库的 Issue；已打开的页面不会出现在推荐中 |
| 8 规则 | 「规则」页签输入「把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档」→ 解析 → 确认保存 | 解析出 2 张卡片：建议归档（github.com · /issues/ · 7 天）和永不归档（docs.internal.com）；保存后已保存规则列表出现 2 条，可停用、删除。可以再试「上周的页面帮我清理」，观察 unparsed 的原因和例句 |
| 9 整理建议 | 「整理」页签 | 归档：Google 搜索页（已 35 天，默认 14 天阈值）、issues/100（已 24 天，标注命中规则原文）；重复：`issues/123` 与 `issues/123?tab=comments`；保留：`docs.internal.com/ai-agent-design`（被保护域名配置）。删除 never_archive 规则后刷新，keep 项消失，体现建议随规则变化 |
| 10 讲解 | 结合本 README | 数据模型、评分策略、规则解析、诊断设计；可再演示：停掉后端 → popup 显示离线提示条并展示上次缓存的结果，诊断第 1 项变为 fail 并给出排查步骤 → 重新启动后端 → 插件自动补同步一次 |

> 第 9 步中，没有规则时 issues/100 也会因为默认 14 天阈值被建议归档；保存规则后理由会变为「超过 7 天未访问…；命中规则「把 7 天没访问过的 GitHub issue 建议归档」」。如果希望更直观地看到规则的作用，可以在保存前后各看一次整理页签。

---

## 面试追问要点

**1. 历史有 10 万条，推荐接口如何保持 100ms 内返回？**

- 不在请求里全量打分：写入后在后台预建「排序快照」，读请求直接复用；快照按 data / rule / config 版本号失效，过期但不超过 1 小时时先返回旧快照、后台刷新。
- 快照构建时一次遍历，为每个域名和每个 GitHub 仓库保留 Top-50 桶；推荐召回只读「规则目标域名桶 + 当前仓库桶 + 当前域名桶 + 全局 Top」，候选最多 200 个，耗时与总页数无关。
- 相同上下文的推荐结果缓存 60 秒，版本号进入缓存 key，任何写入后自动失效。
- 页面主表是 `Map`，并维护 dupKey / domain / repo / openSet 二级索引，同步是 O(本批条数)。
- `scripts/bench-perf.mjs` 通过真实 `/api/sync` 导入 10 万页面后测 p95，阈值推荐 < 100ms、排序 < 50ms。
- 换 SQLite 后：`(domain, static_score)` 索引做 Top-K，recency 在查询时再乘。

**2. 后端不可用时，插件如何降级？**

- popup 采用「缓存优先」：先渲染 `chrome.storage.local` 中上次的排序、推荐、整理、规则结果，再后台刷新。
- 网络错误（`BACKEND_UNREACHABLE` / `TIMEOUT`）时显示离线提示条和缓存时间，顶栏变为离线；同步失败记录在 `syncState.lastError`，可重试。
- 后端恢复后（打开 popup 时检测到）自动补同步一次，然后清除 `recoverPending` 标记。
- 上下文页签读取 tabs / history 不依赖后端，离线也能看。
- 隐私配置拉不到时使用缓存或内置默认关键词，**不会因为拿不到配置就跳过过滤**。

**3. 规则解析能处理哪些边界？不能处理的怎么告知用户？**

- 能处理：中文数字、周 / 月换算、站点别名、子域匹配、否定词优先、条件句不拆分、关键词列表不拆分、缺省天数和次数（标记 medium 并提示）、归档与保护冲突（warnings，执行时永不归档优先）、多个域名（取第一个并提示拆句）。
- 不能处理：相对日期、「或」条件、正则、标题 / 正文条件、模糊数量（几天、半个月）、无动作词。这些放进 `unparsed`，附具体原因和可以照写的例句。
- 所有规则先预览再确认，保存时后端重新校验，客户端改过的 action / id 不会被采纳。

**4. 隐身模式下 history API 有什么变化？**

- Chrome 不会把无痕窗口的访问写入历史，所以 `chrome.history.search` 查不到无痕访问。
- 插件默认不在无痕模式运行；即使用户在扩展设置里允许，本插件也会按 `tab.incognito` 剔除无痕标签页，不展示、不上传。诊断第 10 项会说明当前授权状态。
- 右键菜单在无痕页面点击时直接拒绝，不进入上传路径。

**5. 为什么 popup 不直接调后端？MV3 的 service worker 有哪些坑？**

- 所有网络访问、tabs / history 调用都集中在 SW，popup 只发消息；这样 popup 关掉不会打断同步，权限和错误处理也只有一处。
- SW 随时会被回收：监听器必须在模块顶层同步注册；内存状态不可靠，同步状态、游标、缓存都放在 storage；同步用单飞 Promise 防止重复点击并发；`syncing` 超过 30 秒视为中断。
- popup 关闭后 `sendResponse` 可能失败，已做保护，不产生未处理的 Promise 拒绝。

**6. URL 去重和重复页识别为什么用两个 key？**

- `normalizedUrl` 是存储主键，只去掉 hash 和跟踪参数，保证不同的业务页面不会被误合并；
- `dupKey` 只保留有语义的 query，用来识别「可能是同一页」的重复建议；两者分开，既不丢数据，又能给出合并建议，且合并需要用户确认。

**7. 增量同步怎么做？什么时候退回全量？**

- 记录上次成功同步的游标（时间戳），下次只查 `cursor − 5 分钟` 之后的历史（重叠 5 分钟防止边界丢失；后端按主键合并、visitCount 取最大值，重复上传不会累加）。
- 以下情况游标失效、改为全量：修改了 API 地址；后端是内存模式且启动时间晚于游标（重启丢数据）；后端 `pageCount=0` 或从未同步。判断依据来自 `/api/health` 的 `persistence`、`startedAt`、`lastSyncAt`。

**8. 隐私为什么在前后端各做一次？**

- 前端过滤保证敏感 URL 根本不离开浏览器（题目要求）；后端再检查一次，是防止旧版本插件或其他客户端直接调用接口；日志和诊断报告都不含被过滤的 URL。

**9. 数据持久化如何保证不损坏？**

- 写临时文件 → fsync → rename 原子替换，失败时保留上一份正式快照；变更后防抖 1 秒写盘；收到 SIGTERM / SIGINT 时同步刷盘，并保证 3 秒内退出；启动时校验整个快照（版本、每条页面和规则的字段、id 与主键不重复），不合法则告警后以空数据启动。

**10. 评分权重怎么定的？如何验证？**

- 时效 > 频次 > 打开状态 > 域名，与「最近在用的最重要」的直觉一致；权重之和为 1，分数可以手算。
- 用样例数据的预期分数作为验收标准（见上文表格），接口返回 `scoreDetail` 供逐项复算；权重和半衰期通过 `/api/config` 公开。
