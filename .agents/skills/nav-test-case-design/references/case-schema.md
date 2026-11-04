# 用例结构与模板

基础结构以 `.workflow/CONVENTIONS.md` §4 为准，本技能在其上增加 `category`、`technique`、`acceptanceRefs` 三个字段，以及 S / E 编号前缀。validator 不检查这些新增字段；由 `scripts/check-cases.mjs` 检查。

## 1. JSON 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | `TC-<API\|E2E\|UI>-<MOD>-<NNN>`。MOD 与 `module` 一致；API / E2E 写在 `cases-api.json`，UI 写在 `cases-ui.json`。ID 发布后不得改作他用 |
| `type` | 是 | `API` / `E2E` / `UI`，与 ID 一致 |
| `module` | 是 | 与 ID 中的 MOD 一致。E2E 可以使用 `FLOW` 之类的链路模块名 |
| `title` | 是 | 一句话写清「条件 + 期望」，例如「重复同步同一批数据：页面数不变、visitCount 不累加」。同一 Feature 下不得重复 |
| `priority` | 是 | `P0`–`P3`，判定方法见第 4 节 |
| `category` | 是 | 主类别：`positive` / `negative` / `boundary` / `exception` / `security` / `performance` / `compatibility` / `state` |
| `technique` | 是 | 主设计技术：`equivalence` / `boundary` / `decision-table` / `state-transition` / `error-guessing` / `scenario` / `pairwise` |
| `features` | 是 | 关联的 Feature ID（多对多） |
| `acceptanceRefs` | 是 | 本用例覆盖的验收标准，格式为 `F-SYNC-01#AC1`。AC 编号取自 features.json acceptance 的「AC<n>：」前缀，引用的 Feature 必须出现在 `features` 中 |
| `codePoints` | 是 | 关联的 Code ID。API / E2E 只能引用 C-BE；UI 至少引用 1 个 C-FE；每个代码点的 `features` 必须与用例的 `features` 有交集 |
| `preconditions` | 否 | 数组。只描述环境和数据状态（例如「已 reset，并导入平移后的 resource.json」），**不得引用其他 Case ID** |
| `steps` | 是 | 数组，每条以 `S1：`、`S2：`…… 开头，从 1 开始连续编号。E2E 至少 3 步 |
| `expected` | 是 | 数组，每条以 `E1：`、`E2：`…… 开头，从 1 开始连续编号。脚本中用 `expect(x, '[E1] …')` 对应第 1 条 |
| `testData` | 否 | 数据来源和推算依据，例如「resource.json 平移，latest=now；issues/100 距今 24.31 天」 |
| `evidence` | 否 | 需要重点留存的证据，例如 `["api: POST /api/sync 请求体", "screenshot: 同步成功"]`，落在 `evidence/<CaseID>/` |

根节点可以带 `waivers`，用来说明某个 Feature 的某个必需类别为什么不适用：

```json
{
  "cases": [ ... ],
  "waivers": [
    { "feature": "F-DIAG-04", "category": "exception", "reason": "storage 写失败在真实 Chromium 中无法稳定模拟；由代码评审和诊断项实现的 try/catch 兜底保证" }
  ]
}
```

`positive` 不能豁免；理由要具体，能让评审员判断它是否成立。

## 2. 好用例与坏用例对照

### 2.1 API 正例

坏：

```json
{ "id": "TC-API-SYNC-001", "title": "同步接口测试", "steps": ["调用同步接口"], "expected": ["同步成功", "数据正确"] }
```

问题：标题没有写条件和期望；expected 只有「成功 / 正确」，无法断言；缺少 category、technique、acceptanceRefs；没有编号前缀。

好：

```json
{
  "id": "TC-API-SYNC-001", "type": "API", "module": "SYNC",
  "title": "同步样例数据后按 URL 去重入库，visitCount 取浏览器历史中的值",
  "priority": "P0", "category": "positive", "technique": "equivalence",
  "features": ["F-SYNC-02", "F-SYNC-03"],
  "acceptanceRefs": ["F-SYNC-02#AC1", "F-SYNC-03#AC2"],
  "codePoints": ["C-BE-SYNC-01", "C-BE-SYNC-02"],
  "preconditions": ["后端已 reset（测试夹具自动完成）"],
  "testData": "resource.json 按 D-01 平移：最新一条 lastVisitTime = now − 5 分钟；共 14 项，去重后 10 个页面",
  "steps": [
    "S1：POST /api/sync，请求体为平移后的 resource.json",
    "S2：GET /api/pages/ranked",
    "S3：GET /api/health"
  ],
  "expected": [
    "E1：S1 返回 200，响应中的统计字段与契约一致（原型口径 created=10、updated=4）",
    "E2：S2 的 pages.length=10，且 url 两两不同",
    "E3：S2 中 url=https://github.com/org/repo/issues/123 的项 visitCount=8，lastVisitedAt 等于平移后的时间戳",
    "E4：S3 的 pageCount=10"
  ],
  "evidence": ["api: S1 请求体与响应", "api: S2 响应"]
}
```

### 2.2 反例

```json
{
  "id": "TC-API-SYNC-006", "type": "API", "module": "SYNC",
  "title": "请求体不是合法 JSON 时返回 400 和统一错误格式，且不写入任何数据",
  "priority": "P1", "category": "negative", "technique": "error-guessing",
  "features": ["F-SYNC-02"], "acceptanceRefs": ["F-SYNC-02#AC3"], "codePoints": ["C-BE-SYNC-01"],
  "steps": ["S1：POST /api/sync，Content-Type 为 application/json，请求体为字符串 {bad", "S2：GET /api/health"],
  "expected": [
    "E1：S1 返回 400，body.error.code=\"INVALID_JSON\"，body.error.message 非空",
    "E2：S2 的 pageCount=0"
  ]
}
```

### 2.3 边界（时间）

```json
{
  "id": "TC-API-CLEAN-004", "type": "API", "module": "CLEAN",
  "title": "未访问 14 天 ± 1 分钟：只有超过阈值的页面被建议归档",
  "priority": "P1", "category": "boundary", "technique": "boundary",
  "features": ["F-CLEAN-01"], "acceptanceRefs": ["F-CLEAN-01#AC2"], "codePoints": ["C-BE-CLEAN-01"],
  "testData": "契约没有 ?now= 覆盖参数，因此不测「恰好 14 天」（服务端处理请求的毫秒级偏移会让结果不稳定），改为 14 天 - 1 分钟 / 14 天 + 1 分钟",
  "steps": [
    "S1：POST /api/sync 导入两条未打开的 history：https://example.com/a（距今 14 天 - 1 分钟）、https://example.com/b（距今 14 天 + 1 分钟）",
    "S2：GET /api/pages/cleanup-suggestions"
  ],
  "expected": [
    "E1：action=archive 的建议中包含 https://example.com/b，reason 包含「14 天」",
    "E2：action=archive 的建议中不包含 https://example.com/a"
  ]
}
```

### 2.4 E2E（步骤之间传递状态）

```json
{
  "id": "TC-E2E-FLOW-002", "type": "E2E", "module": "FLOW",
  "title": "规则闭环：解析 → 保存 → 整理建议体现规则 → 用返回的 id 删除 → 建议恢复",
  "priority": "P0", "category": "state", "technique": "scenario",
  "features": ["F-RULE-01", "F-RULE-02", "F-RULE-04", "F-CLEAN-02", "F-DIAG-05"],
  "acceptanceRefs": ["F-RULE-01#AC1", "F-RULE-02#AC1", "F-RULE-04#AC1", "F-CLEAN-02#AC1", "F-DIAG-05#AC1"],
  "codePoints": ["C-BE-RULE-01", "C-BE-RULE-02", "C-BE-CLEAN-02", "C-BE-DIAG-01"],
  "testData": "resource.json 平移后导入，并额外导入 https://github.com/org/repo/issues/87（距今 10 天、未打开）",
  "steps": [
    "S1：导入数据，GET /api/pages/cleanup-suggestions，记录 archive 列表 A0",
    "S2：POST /api/rules/parse，text 为示例规则句，取出返回的 rules",
    "S3：POST /api/rules，提交 S2 的 rules，取出保存后返回的 2 个 id",
    "S4：GET /api/pages/cleanup-suggestions",
    "S5：DELETE /api/rules/<S3 中 archive_candidate 规则的 id>",
    "S6：GET /api/pages/cleanup-suggestions；GET /api/health"
  ],
  "expected": [
    "E1：A0 中不包含 issues/87",
    "E2：S2 返回 2 条规则，类型依次为 archive_candidate、never_archive",
    "E3：S3 返回的 2 个 id 非空且互不相同",
    "E4：S4 的 archive 包含 issues/87，reason 包含「7 天」；keep 包含 docs.internal.com/ai-agent-design",
    "E5：S5 返回成功状态（以契约为准）",
    "E6：S6 的 archive 不再包含 issues/87；health.ruleCount=1"
  ]
}
```

要点：后一步使用前一步**响应中**的值（规则、id），不要硬编码 `rule_1` 这类后端生成的 ID。

### 2.5 UI

```json
{
  "id": "TC-UI-PRIV-001", "type": "UI", "module": "PRIV",
  "title": "含 token / bank 的页面在插件端被过滤，不上传后端",
  "priority": "P0", "category": "security", "technique": "equivalence",
  "features": ["F-PRIV-01"], "acceptanceRefs": ["F-PRIV-01#AC1", "F-PRIV-01#AC2"],
  "codePoints": ["C-FE-PRIV-01", "C-FE-SYNC-02"],
  "preconditions": ["外部站点已 route 离线化"],
  "steps": [
    "S1：依次打开 https://github.com/org/repo/pull/456、https://accounts.example.com/reset-password?token=8f2a91c、https://bank.example.com/account/overview",
    "S2：以 tab 方式打开 popup，点击 sync-button",
    "S3：GET /api/pages/ranked 核对后端数据"
  ],
  "expected": [
    "E1：sync-status 显示同步成功，并显示「已过滤 2 条」（文案以 ui-contract 为准）",
    "E2：S3 的 pages 中包含 pull/456，且不包含任何含 token、bank 的 URL",
    "E3：evidence 中的 /api/sync 请求体不含上述两个敏感 URL"
  ],
  "evidence": ["screenshot: 同步后的 popup", "api: S3 响应"]
}
```

## 3. md 文档模板（06 / 07）

```markdown
## SYNC 同步

### TC-API-SYNC-001 同步样例数据后按 URL 去重入库，visitCount 取浏览器历史中的值
- 优先级：P0 ｜ 类别：positive ｜ 技术：equivalence
- 关联 Feature：F-SYNC-02（AC1）、F-SYNC-03（AC2） ｜ 关联 Code：C-BE-SYNC-01、C-BE-SYNC-02
- 前置条件：后端已 reset
- 测试数据：resource.json 平移，latest=now
- 步骤：
  - S1：……
- 预期：
  - E1：……
- 证据：evidence/TC-API-SYNC-001/api/
```

文末附两张表：

1. **Feature → Case 覆盖表**：Feature ID | AC | 覆盖用例 | 类别分布（正 / 反 / 边 / 异 / 其他）| waiver。
2. **类别分布统计**：按模块统计各类别的用例数（数字取自 `check-cases.mjs --json` 的 stats，不要手算）。

md 中必须出现 JSON 里的全部 Case ID，且不能出现 JSON 中不存在的 ID（validator 规则 8）。

## 4. 优先级判定

| 优先级 | 判定条件（满足任一即可） |
|---|---|
| P0 | 对应 P0 Feature 的正例；PROBLEM.md 验收流程第 1–10 步直接依赖的路径；隐私不上传；E2E 主链路 |
| P1 | P0 Feature 的反例 / 边界 / 异常；P1 Feature 的正例；后端不可达等降级；规则否定句 |
| P2 | P1 Feature 的反例 / 边界；兼容性；UI 细节状态（长文本、空状态） |
| P3 | 已知局限的记录性用例；可选项 |
