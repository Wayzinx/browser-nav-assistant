# 题目目标

实现一个 **浏览器导航助手**：浏览器插件采集当前页面、打开标签页和浏览历史，后端基于访问模式和用户自然语言配置，对历史页面进行评分排序、推荐下一步访问页面、识别旧页面和重复页面，并提供启动诊断能力确认权限和配置正确。

---

# 背景

你所在的团队正在构建一个类 browser-use 的 AI 浏览器助手基础设施。它不直接控制浏览器完成复杂任务，而是先做一个更基础但真实的能力层：

用户在浏览器中打开大量页面（文档、GitHub Issue、内部系统、竞品、搜索结果）时，经常遇到以下问题：

- 标签页越开越多，不知道哪些该保留、哪些该归档或关闭
- 浏览历史很长，但很难找到"最近没用但可能重要"的页面
- 用户在完成某个任务时，系统无法判断下一步应访问哪个页面
- 用户希望通过自然语言配置规则，例如：
  - "把 7 天没访问过的 GitHub issue 建议归档"
  - "如果我连续看了 3 个 React 文档，推荐相关 MDN 页面"
  - "docs.internal.com 的页面永远不要归档"
  - "不要上传包含 password、token 的 URL"

本题要求实现一个简化版浏览器插件 + 后端服务，采集浏览器行为数据，实现推荐、整理和规则配置。

---

# 总体约束

- 浏览器插件必须基于 **Chrome Extension Manifest V3** 实现
- 后端不限语言和框架，选择你熟悉的即可
- 可以使用内存存储，但需要能解释真实持久化方案
- 不要求真实调用 LLM，推荐和规则解析均可 mock 或用规则引擎实现
- 不允许直接使用完整成熟的推荐系统平台作为核心实现
- 隐私敏感页面（含 password、token、bank 等关键词的 URL）不应上传到后端
- 所有功能需要能在本地完整演示
- 可以使用 AI / Coding Agent 辅助开发，但需要能解释插件结构、权限配置、通信逻辑和数据模型

---

# 系统架构说明

系统包含两个主要部分：

## 浏览器插件

插件至少包含以下三个模块：

**Popup 页面**
用户点击插件图标后打开，展示：
- 当前页面标题和 URL
- 同步按钮和同步状态
- 推荐的下一步访问页面
- 历史排序概览
- 整理建议摘要
- 自然语言配置输入框
- 诊断状态入口

**Background Service Worker**
负责：
- 响应 popup 操作
- 调用浏览器 `tabs` / `history` API
- 与后端 API 通信
- 管理同步状态和本地缓存

**（可选）Content Script**
如需在网页内注入功能（如高亮推荐关键词）可使用，不强制要求。

## 后端服务

提供以下核心能力：
- 接收并存储浏览器行为数据
- 对页面进行评分和排序
- 推荐下一步访问页面
- 识别旧页面和重复页面
- 解析自然语言规则为结构化配置
- 提供健康检查和配置查询接口

---

# 核心数据模型

## 页面记录（Page）

```json
{
  "id": "page_123",
  "url": "https://github.com/org/repo/issues/123",
  "normalizedUrl": "https://github.com/org/repo/issues/123",
  "title": "Fix login redirect bug",
  "domain": "github.com",
  "visitCount": 8,
  "lastVisitedAt": 1710000000000,
  "firstSeenAt": 1709000000000,
  "sources": ["history", "open_tab"],
  "isOpen": true,
  "isArchived": false,
  "score": 0.91
}
```

## 规则（Rule）

```json
{
  "id": "rule_123",
  "rawText": "7 天没访问的 GitHub issue 建议归档",
  "type": "archive_candidate",
  "domain": "github.com",
  "urlPattern": "/issues/",
  "inactiveDays": 7,
  "action": "suggest_archive",
  "enabled": true
}
```

## 推荐（Recommendation）

```json
{
  "id": "rec_123",
  "type": "next_visit",
  "url": "https://github.com/org/repo/actions",
  "title": "GitHub Actions",
  "score": 0.86,
  "reason": "你正在查看 PR，同仓库的 CI 页面最近访问频率较高",
  "createdAt": 1710000000000
}
```

---

# 必做功能

## 1. 插件可以正确加载并读取浏览器上下文

- 提供合法的 `manifest.json`，包含必要的权限声明（至少 `tabs`、`history`、`storage`、`activeTab`）
- 可以在 Chrome 开发者模式下加载
- 插件 popup 能展示：
  - 当前 active tab 的 URL 和 title
  - 当前窗口打开的 tabs 列表（URL、title）
  - 最近 N 条浏览历史（建议 N=50 或 100）

## 2. 浏览器数据同步到后端

插件提供"同步浏览器上下文"按钮，点击后：

- 将当前 tab、open tabs、最近历史发送给后端
- 后端保存页面记录，按 URL 去重
- 更新 `visitCount` / `lastVisitedAt`
- 区分 `source`：`active_tab` / `open_tab` / `history`
- 插件展示同步成功状态

后端接口：

```
POST /api/sync
Content-Type: application/json

{
  "activeTab": { "url": "...", "title": "..." },
  "openTabs": [{ "url": "...", "title": "..." }],
  "history": [{ "url": "...", "title": "...", "lastVisitTime": 1710000000000 }]
}
```

## 3. 历史排序接口

后端提供按评分排序的页面列表：

```
GET /api/pages/ranked
```

返回示例：

```json
{
  "pages": [
    {
      "url": "https://github.com/org/repo/issues/123",
      "title": "Fix login redirect bug",
      "domain": "github.com",
      "visitCount": 8,
      "lastVisitedAt": 1710000000000,
      "score": 0.91,
      "reason": "最近 3 天多次访问，且当前仍处于打开状态"
    }
  ]
}
```

评分策略需能解释，例如：

```
score = recencyScore * 0.4 + frequencyScore * 0.3 + isOpenBoost * 0.2 + domainBoost * 0.1
```

候选人不一定要实现复杂算法，但需要能解释评分维度和取舍。

## 4. 推荐下一步访问页面

后端根据当前上下文推荐下一步访问：

```
POST /api/recommendations/next
Content-Type: application/json

{
  "currentPage": { "url": "...", "title": "..." },
  "openTabs": [...],
  "recentHistory": [...]
}
```

返回示例：

```json
{
  "recommendations": [
    {
      "type": "next_visit",
      "url": "https://github.com/org/repo/actions",
      "title": "GitHub Actions",
      "score": 0.86,
      "reason": "你正在查看 PR，同仓库 CI 页面最近访问频率较高，可能需要检查构建状态"
    }
  ]
}
```

最小实现可以基于规则：
- 当前是 GitHub PR，推荐同 repo 的 issue / actions
- 当前是文档页，推荐同域名高频访问页面
- 当前页面域名与历史某些页面相同，推荐同域名高分页面
- 排除当前已打开页面或重复 URL

## 5. 旧页面与重复页面整理建议

后端提供整理建议：

```
GET /api/pages/cleanup-suggestions
```

返回示例：

```json
{
  "suggestions": [
    {
      "action": "archive",
      "url": "https://example.com/old-doc",
      "title": "Old Documentation",
      "reason": "超过 14 天未访问，且不在当前打开的 tab 中"
    },
    {
      "action": "merge",
      "urls": [
        "https://github.com/org/repo/issues/123",
        "https://github.com/org/repo/issues/123?tab=comments"
      ],
      "reason": "去掉 query 参数后 URL 相同，疑似重复页面"
    },
    {
      "action": "keep",
      "url": "https://docs.internal.com/design",
      "reason": "被保护域名配置，不建议归档"
    }
  ]
}
```

基础规则：
- 超过 X 天未访问，且不是当前打开的 tab，建议归档
- URL 去掉 query/hash 后相同，认为可能重复
- 被 `never_archive` 规则保护的域名不归档

## 6. 自然语言规则配置

插件提供规则输入框，用户输入自然语言，例如：

```
把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档
```

后端提供规则解析接口：

```
POST /api/rules/parse
Content-Type: application/json

{
  "text": "把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档"
}
```

返回示例：

```json
{
  "rules": [
    {
      "id": "rule_1",
      "rawText": "...",
      "type": "archive_candidate",
      "domain": "github.com",
      "urlPattern": "/issues/",
      "inactiveDays": 7,
      "action": "suggest_archive"
    },
    {
      "id": "rule_2",
      "rawText": "...",
      "type": "never_archive",
      "domain": "docs.internal.com",
      "action": "keep"
    }
  ]
}
```

不要求真实 LLM，可以用关键词规则解析器实现（识别：N 天没访问、域名、动作词等）。

插件需展示解析结果，用户确认后调用保存接口：

```
POST /api/rules
```

规则需要：
- 可查看已有规则列表
- 可删除规则
- 整理建议和排序接口需要读取规则执行

## 7. 启动诊断与配置检查

这是本题的一个重要考察点，考察候选人是否具备全栈启动、配置和排障能力。

**插件端需要展示诊断状态：**

| 检查项 | 说明 |
|--------|------|
| 后端服务是否可连接 | 调用 `/api/health` 检查 |
| `tabs` 权限是否已授权 | 检查 manifest 权限配置 |
| `history` 权限是否已授权 | 检查 manifest 权限配置 |
| `storage` 权限是否可用 | 检查本地存储可用性 |
| API base URL 配置是否正确 | 展示当前配置的后端地址 |
| 最近一次同步是否成功 | 展示最近同步时间和结果 |
| 当前规则数量 | 已保存的规则条数 |

**后端需要提供：**

```
GET /api/health
```

```json
{
  "status": "ok",
  "version": "1.0.0",
  "uptime": 3600,
  "pageCount": 128,
  "ruleCount": 3
}
```

```
GET /api/config
```

```json
{
  "cleanupThresholdDays": 14,
  "maxHistoryItems": 100,
  "enablePrivacyFilter": true,
  "privacySensitiveKeywords": ["password", "token", "bank", "secret"]
}
```

---

# 进阶要求

以下功能可做可不做，作为加分项：

**隐私过滤**
- 同步前检查 URL 是否包含敏感关键词（password、token、bank、secret 等）
- 符合条件的 URL 不上传，在插件本地过滤掉
- 可配置敏感关键词列表

**支持右键菜单**
- 在任意网页右键，出现"添加到分析"或"标记为重要"选项

**本地持久化**
- 使用 `chrome.storage.local` 或 `IndexedDB` 缓存推荐结果和历史排序
- 离线状态下可以查看上次缓存的结果

**增量同步**
- 记录上次同步游标（时间戳）
- 每次只上传增量历史，避免重复上传

**页面高亮**
- 在网页中通过 content script 高亮推荐关键词或相关 issue 编号

**向量相似度 mock**
- 对页面 title 做简单相似度聚合，识别相关页面

**后端持久化**
- 使用 SQLite、文件或真实数据库持久化页面记录和规则
- 重启后数据不丢失

**快速响应优化**
- 对推荐结果进行缓存
- 预计算页面评分，避免每次请求全量扫描

---

# 验收要求

候选人需要能完成以下演示流程：

1. 启动后端服务
2. 在 Chrome 开发者模式加载插件
3. 插件诊断页显示：后端连接正常、`tabs` 和 `history` 权限正常
4. 打开几个测试页面（例如 GitHub、MDN、搜索页）
5. 点击"同步浏览器上下文"，插件显示同步成功
6. 插件展示历史排序结果，分数和排序理由可见
7. 插件展示推荐下一步访问的页面（至少 1 条，有 reason）
8. 输入自然语言规则，后端解析为结构化规则，用户确认保存
9. 展示旧页面整理建议，建议与规则配置一致
10. 候选人能解释数据模型、评分策略、规则解析和诊断设计

---

# 交付物

- 完整源码（插件 + 后端）
- 启动说明（如何安装插件、启动后端）
- 架构说明（插件各模块职责、后端 API 列表、数据模型）
- 评分策略说明（排序维度和权重取舍）
- 规则解析说明（支持哪些自然语言模式）
- 诊断说明（诊断项含义和排查方法）

**建议目录结构：**

```
ai-browser-navigation-agent/
├── PROBLEM.md
├── README.md
├── extension/
│   ├── manifest.json
│   ├── popup/
│   ├── background/
│   └── content/
├── server/
│   ├── src/
│   └── ...
├── scripts/
│   ├── start.sh
│   └── test.sh
└── resources/
    └── sample-history.json
```

---

# 提示

- 建议先把 manifest 权限配置好并验证可以读取 tabs 和 history，再写业务逻辑
- 插件的 background service worker 和 popup 不能共享内存，需要通过消息通信
- `chrome.history.search` 可以读取浏览历史，`chrome.tabs.query` 可以读取打开的 tabs
- 当前页面为 `chrome://` 等系统页面时，content script 无法注入，需要做降级处理
- 规则解析不要求 LLM，先用关键词匹配实现，能解析 "N 天"、"域名"、"动作"即可
- 快速响应很重要：推荐接口应该尽量快，不要每次全量扫描大量历史记录
- 面试官可能会追问：
  - 如果历史记录有 10 万条，推荐接口如何保持 100ms 内返回？
  - 如果后端不可用，插件应该怎么降级处理？
  - 你的规则解析能处理哪些边界情况？不能处理的怎么告知用户？
  - 如果用户在隐身模式下，history API 会有什么变化？
