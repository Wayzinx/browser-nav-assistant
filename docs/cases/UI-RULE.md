# RULE 自然语言规则 UI 用例分片

> 对应任务：`.workflow/context/briefs/case-UI-RULE.md`。本文件与 `docs/trace/cases/UI-RULE.json` 一一对应；docs/07 与 cases-ui.json 由 validator 合并生成。当前为用例设计，尚未生成脚本与执行证据。

## 独立执行与数据配方

- 范围：RULE 模块 layers 含 FE 的 5 个 Feature（F-RULE-01、06、07、08、09）共 14 条 AC；BE-only Feature（F-RULE-02/03/04/05/10）由 API 分片负责，本分片只在 UI 渲染相关处顺带引用 F-RULE-02#AC5、F-RULE-05#AC1/AC3/AC4。
- 每个 Case ID 对应 `tests/ui/<CaseID>.spec.mjs`，从 `tests/fixtures/extension.mjs` 导入 test/expect；每条自带 reset 与造数，不依赖其他用例与执行顺序。
- popup 以 tab 方式打开（`ext.openPopup()` / `ext.reopenPopup()`）；元素只用 ui-contract 登记的 testId；外部站点 route 离线化；禁止 route 后端。
- 规则前置数据：用 api 夹具真实调用 `POST /api/rules/parse` 取 rules，再原样 `POST /api/rules` 保存（setup 步骤，不写死 id）；旧页面用 `api.loadSample()`（resource.json 按 D-01 平移）导入。
- 后端不可达：`ext.useUnreachableBackend()`（`http://127.0.0.1:9`）。「中途断开」场景在 popup 已打开后切换 apiBaseUrl，不刷新页面。
- UI 无法构造的非法输入（非法 type、不存在 id、501 字）通过 popup 页面 `chrome.runtime.sendMessage({ type, payload, requestId })` 直达 C-FE-RULE-01 handler，断言消息信封 `{ ok:false, error:{ code, message } }`。

## 用例

### TC-UI-RULE-001 规则页签输入题目示例句并解析：展示「建议归档」「永不归档」2 张卡片，含字段摘要、原文、置信度与 JSON

- 优先级：P0 ｜ 类别：positive ｜ 技术：equivalence
- 关联 Feature：F-RULE-01
- 验收引用：F-RULE-01#AC1
- 关联 Code：C-FE-RULE-02、C-FE-RULE-01
- 未来脚本：`tests/ui/TC-UI-RULE-001.spec.mjs`
- 前置条件：
  - 使用 tests/fixtures/extension.mjs 的 test：独立 persistent Chromium context（channel=chromium）加载真实扩展，popup 以 tab 方式打开（ext.openPopup()）；api 夹具在本条开始前调用 POST /api/__test__/reset
  - 后端由 Playwright webServer 启动（ENABLE_TEST_API=1，TEST_PORT 默认 4100）；夹具已把 chrome.storage.local.apiBaseUrl 写为测试后端地址
  - 只 route 外部站点（github.com、docs.internal.com 等）；禁止 route 后端 /api、localhost、127.0.0.1；元素只用 ui-contract 登记的 getByTestId
- 测试数据：输入文本：「把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档」（PROBLEM.md 示例句，F-RULE-02#AC1 口径）。不需要导入样例数据。
- 步骤：
  - S1：打开 popup，点击 testId tab-rules，等待 panel-rules 可见
  - S2：在 rule-input 中填入「把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档」，点击 rule-parse-button，等待 rule-parse-loading 消失、rule-preview-list 可见
  - S3：读取 rule-preview-list 内全部 rule-card 的 data-type，以及每张卡片内 rule-card-type / rule-card-fields / rule-card-raw / rule-card-confidence 的文本
  - S4：点击第 1 张卡片内的 rule-card-json-toggle，读取 rule-card-json 的 textContent 并 JSON.parse
- 预期：
  - E1：S2 后 rule-card 数量 = 2，rule-parse-error 不可见
  - E2：第 1 张卡片 data-type="archive_candidate"，rule-card-type 文本为「建议归档」，rule-card-fields 文本包含「github.com」「/issues/」「7 天」，rule-card-raw 文本为「把 7 天没访问过的 GitHub issue 建议归档」
  - E3：第 2 张卡片 data-type="never_archive"，rule-card-type 文本为「永不归档」，rule-card-fields 文本包含「docs.internal.com」，rule-card-raw 文本为「docs.internal.com 的页面永远不要归档」
  - E4：两张卡片的 rule-card-confidence 均可见，文本为「高」
  - E5：S4 后 rule-card-json 可见，解析得到的对象 type="archive_candidate"、domain="github.com"、urlPattern="/issues/"、inactiveDays=7、action="suggest_archive"
- 证据目录：`evidence/TC-UI-RULE-001/`
  - screenshot: 解析后 2 张卡片
  - screenshot: 展开 JSON
  - server.log: POST /api/rules/parse

### TC-UI-RULE-002 解析后不确认：GET /api/rules 仍为 0 条，已保存列表为空，health.ruleCount=0

- 优先级：P0 ｜ 类别：positive ｜ 技术：state-transition
- 关联 Feature：F-RULE-01
- 验收引用：F-RULE-01#AC2
- 关联 Code：C-FE-RULE-01、C-FE-RULE-02
- 未来脚本：`tests/ui/TC-UI-RULE-002.spec.mjs`
- 前置条件：
  - 使用 tests/fixtures/extension.mjs 的 test：独立 persistent Chromium context（channel=chromium）加载真实扩展，popup 以 tab 方式打开（ext.openPopup()）；api 夹具在本条开始前调用 POST /api/__test__/reset
  - 后端由 Playwright webServer 启动（ENABLE_TEST_API=1，TEST_PORT 默认 4100）；夹具已把 chrome.storage.local.apiBaseUrl 写为测试后端地址
  - 只 route 外部站点（github.com、docs.internal.com 等）；禁止 route 后端 /api、localhost、127.0.0.1；元素只用 ui-contract 登记的 getByTestId
- 测试数据：输入文本：「把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档」；解析前后各调用一次 GET /api/rules 对比 total。
- 步骤：
  - S1：调用 GET /api/rules，记录 body.total 为 before
  - S2：打开 popup，点击 tab-rules，在 rule-input 填入示例句并点击 rule-parse-button，等待 rule-card 出现
  - S3：不点击 rule-save-button，调用 GET /api/rules 与 GET /api/health
  - S4：关闭 popup 后重新打开（ext.reopenPopup()），点击 tab-rules，等待 rules-list-loading 消失
- 预期：
  - E1：S1 的 before=0；S2 后 rule-card 数量 = 2
  - E2：S3 的 GET /api/rules 返回 200，body.total=0 且 rules 为 []（与 before 相同）；GET /api/health 的 ruleCount=0
  - E3：S4 后 rules-list-empty 可见，rules-count 文本为「0」，rules-item 数量 = 0
- 证据目录：`evidence/TC-UI-RULE-002/`
  - screenshot: 关键步骤截图（ext.snap）
  - extension.log
  - server.log

### TC-UI-RULE-003 输入「帮我整理一下」：显示黄色提示框含「没有识别到动作」与例句，无规则卡片且保存不可用

- 优先级：P1 ｜ 类别：negative ｜ 技术：equivalence
- 关联 Feature：F-RULE-01、F-RULE-05
- 验收引用：F-RULE-01#AC3、F-RULE-05#AC1
- 关联 Code：C-FE-RULE-02、C-FE-RULE-01
- 未来脚本：`tests/ui/TC-UI-RULE-003.spec.mjs`
- 前置条件：
  - 使用 tests/fixtures/extension.mjs 的 test：独立 persistent Chromium context（channel=chromium）加载真实扩展，popup 以 tab 方式打开（ext.openPopup()）；api 夹具在本条开始前调用 POST /api/__test__/reset
  - 后端由 Playwright webServer 启动（ENABLE_TEST_API=1，TEST_PORT 默认 4100）；夹具已把 chrome.storage.local.apiBaseUrl 写为测试后端地址
  - 只 route 外部站点（github.com、docs.internal.com 等）；禁止 route 后端 /api、localhost、127.0.0.1；元素只用 ui-contract 登记的 getByTestId
- 测试数据：输入文本：「帮我整理一下」（无效等价类：没有动作词）。后端返回 rules=[]、unparsed 1 条（reason 含「没有识别到动作」，examples ≥ 1）。
- 步骤：
  - S1：打开 popup，点击 tab-rules
  - S2：在 rule-input 填入「帮我整理一下」，点击 rule-parse-button，等待 rule-parse-loading 消失
  - S3：读取 rule-unparsed 文本、rule-card 数量与 rule-save-button 状态，再调用 GET /api/rules
- 预期：
  - E1：rule-unparsed 可见，文本包含「没有识别到动作」，且包含「帮我整理一下」
  - E2：rule-unparsed 中至少展示 1 条例句：文本包含「归档」（来自 unparsed[0].examples）
  - E3：rule-card 数量 = 0；rule-save-button 不可见或为 disabled
  - E4：GET /api/rules 返回 body.total=0
- 证据目录：`evidence/TC-UI-RULE-003/`
  - screenshot: 关键步骤截图（ext.snap）
  - extension.log
  - server.log

### TC-UI-RULE-004 后端不可达时打开规则页签：「解析」按钮 disabled，显示「后端未连接，暂时无法解析」

- 优先级：P1 ｜ 类别：exception ｜ 技术：error-guessing
- 关联 Feature：F-RULE-01
- 验收引用：F-RULE-01#AC4
- 关联 Code：C-FE-RULE-02、C-FE-RULE-05
- 未来脚本：`tests/ui/TC-UI-RULE-004.spec.mjs`
- 前置条件：
  - 使用 tests/fixtures/extension.mjs 的 test：独立 persistent Chromium context（channel=chromium）加载真实扩展，popup 以 tab 方式打开（ext.openPopup()）；api 夹具在本条开始前调用 POST /api/__test__/reset
  - 后端由 Playwright webServer 启动（ENABLE_TEST_API=1，TEST_PORT 默认 4100）；夹具已把 chrome.storage.local.apiBaseUrl 写为测试后端地址
  - 只 route 外部站点（github.com、docs.internal.com 等）；禁止 route 后端 /api、localhost、127.0.0.1；元素只用 ui-contract 登记的 getByTestId
  - 后端不可达用 ext.useUnreachableBackend()（apiBaseUrl=http://127.0.0.1:9）构造，不 route 后端
- 测试数据：apiBaseUrl=http://127.0.0.1:9（无服务监听）；在打开 popup 之前设置。
- 步骤：
  - S1：调用 ext.useUnreachableBackend()，然后打开 popup，等待 connection-status 的 data-state 变为 "offline"
  - S2：读取首页 home-rule-parse-button 的 disabled 状态
  - S3：点击 tab-rules，在 rule-input 填入「github.com 永远不要归档」，读取 rule-parse-button 与 rule-offline-hint
- 预期：
  - E1：S1 后 connection-status data-state="offline"，文本「后端未连接」
  - E2：S2 的 home-rule-parse-button 为 disabled
  - E3：S3 的 rule-parse-button 为 disabled（填入文本后仍 disabled）
  - E4：rule-offline-hint 可见，文本包含「后端未连接，暂时无法解析」；rule-card 数量 = 0
- 证据目录：`evidence/TC-UI-RULE-004/`
  - screenshot: 离线规则页签
  - extension.log

### TC-UI-RULE-005 首页「用一句话配置规则」输入示例句点击解析：切换到规则页签并展示同样 2 张卡片

- 优先级：P0 ｜ 类别：positive ｜ 技术：scenario
- 关联 Feature：F-RULE-01
- 验收引用：F-RULE-01#AC1
- 关联 Code：C-FE-RULE-05、C-FE-RULE-02、C-FE-RULE-01
- 未来脚本：`tests/ui/TC-UI-RULE-005.spec.mjs`
- 前置条件：
  - 使用 tests/fixtures/extension.mjs 的 test：独立 persistent Chromium context（channel=chromium）加载真实扩展，popup 以 tab 方式打开（ext.openPopup()）；api 夹具在本条开始前调用 POST /api/__test__/reset
  - 后端由 Playwright webServer 启动（ENABLE_TEST_API=1，TEST_PORT 默认 4100）；夹具已把 chrome.storage.local.apiBaseUrl 写为测试后端地址
  - 只 route 外部站点（github.com、docs.internal.com 等）；禁止 route 后端 /api、localhost、127.0.0.1；元素只用 ui-contract 登记的 getByTestId
- 测试数据：输入文本：「把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档」；入口为首页 home-rule-input。
- 步骤：
  - S1：打开 popup，保持在首页，确认 home-rule-input 可见
  - S2：在 home-rule-input 填入示例句，点击 home-rule-parse-button
  - S3：等待 panel-rules 可见、rule-parse-loading 消失，读取 tab-rules、rule-input 与 rule-card
- 预期：
  - E1：S2 前 home-rule-parse-button 为 enabled
  - E2：S3 后 tab-rules 的 aria-selected="true"，panel-rules 可见
  - E3：rule-input 的值等于「把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档」
  - E4：rule-card 数量 = 2，data-type 依次为 "archive_candidate"、"never_archive"
- 证据目录：`evidence/TC-UI-RULE-005/`
  - screenshot: 关键步骤截图（ext.snap）
  - extension.log
  - server.log

### TC-UI-RULE-006 PARSE_RULE 文本长度边界：500 字返回 ok:true，501 字与空串返回 VALIDATION_FAILED 且不写库

- 优先级：P1 ｜ 类别：boundary ｜ 技术：boundary
- 关联 Feature：F-RULE-01、F-RULE-05
- 验收引用：F-RULE-01#AC2、F-RULE-05#AC4
- 关联 Code：C-FE-RULE-01
- 未来脚本：`tests/ui/TC-UI-RULE-006.spec.mjs`
- 前置条件：
  - 使用 tests/fixtures/extension.mjs 的 test：独立 persistent Chromium context（channel=chromium）加载真实扩展，popup 以 tab 方式打开（ext.openPopup()）；api 夹具在本条开始前调用 POST /api/__test__/reset
  - 后端由 Playwright webServer 启动（ENABLE_TEST_API=1，TEST_PORT 默认 4100）；夹具已把 chrome.storage.local.apiBaseUrl 写为测试后端地址
  - 只 route 外部站点（github.com、docs.internal.com 等）；禁止 route 后端 /api、localhost、127.0.0.1；元素只用 ui-contract 登记的 getByTestId
  - 消息由 popup 页面执行 page.evaluate(() => chrome.runtime.sendMessage({ type, payload, requestId }))，响应信封为 { ok, data } 或 { ok:false, error:{ code, message } }
- 测试数据：text500 = "github.com 永远不要归档" 后补「。」至恰好 500 个字符；text501 = text500 + "。"（501 字）；text0 = ""。契约：text trim 后 1–500 字。
- 步骤：
  - S1：打开 popup（任意页签），通过 chrome.runtime.sendMessage 发送 PARSE_RULE { text: text500 }
  - S2：发送 PARSE_RULE { text: text501 }
  - S3：发送 PARSE_RULE { text: "" }
  - S4：调用 GET /api/rules 与 GET /api/health
- 预期：
  - E1：S1 响应 ok=true，data.rules 为数组、data.unparsed 为数组、data.warnings 为数组
  - E2：S2 响应 ok=false，error.code="VALIDATION_FAILED"，error.message 为非空字符串
  - E3：S3 响应 ok=false，error.code="VALIDATION_FAILED"
  - E4：S4 的 GET /api/rules body.total=0，health.ruleCount=0（解析不写库）
- 证据目录：`evidence/TC-UI-RULE-006/`
  - extension.log: 三次 PARSE_RULE 的响应
  - server.log: 3 次 POST /api/rules/parse 的状态码 200/400/400

### TC-UI-RULE-007 在线打开后后端中途不可达再点「解析」：显示 rule-parse-error，不残留 loading、无卡片

- 优先级：P1 ｜ 类别：exception ｜ 技术：error-guessing
- 关联 Feature：F-RULE-01
- 验收引用：F-RULE-01#AC4
- 关联 Code：C-FE-RULE-02、C-FE-RULE-01
- 未来脚本：`tests/ui/TC-UI-RULE-007.spec.mjs`
- 前置条件：
  - 使用 tests/fixtures/extension.mjs 的 test：独立 persistent Chromium context（channel=chromium）加载真实扩展，popup 以 tab 方式打开（ext.openPopup()）；api 夹具在本条开始前调用 POST /api/__test__/reset
  - 后端由 Playwright webServer 启动（ENABLE_TEST_API=1，TEST_PORT 默认 4100）；夹具已把 chrome.storage.local.apiBaseUrl 写为测试后端地址
  - 只 route 外部站点（github.com、docs.internal.com 等）；禁止 route 后端 /api、localhost、127.0.0.1；元素只用 ui-contract 登记的 getByTestId
  - 后端不可达用 ext.useUnreachableBackend()（apiBaseUrl=http://127.0.0.1:9）构造，不 route 后端
- 测试数据：先以真实后端打开 popup（解析按钮可用），再把 apiBaseUrl 改为 http://127.0.0.1:9 模拟后端中途断开；popup send 超时兜底 10 秒。
- 步骤：
  - S1：打开 popup，点击 tab-rules，确认 rule-parse-button 为 enabled
  - S2：调用 ext.useUnreachableBackend()（不刷新 popup）
  - S3：在 rule-input 填入「github.com 永远不要归档」，点击 rule-parse-button，等待最多 12 秒
- 预期：
  - E1：S1 时 rule-parse-button 为 enabled，rule-offline-hint 不可见
  - E2：S3 后 rule-parse-error 可见，文本非空（长度 ≥ 2）
  - E3：S3 后 rule-parse-loading 不可见，rule-card 数量 = 0
- 证据目录：`evidence/TC-UI-RULE-007/`
  - screenshot: 关键步骤截图（ext.snap）
  - extension.log
  - server.log

### TC-UI-RULE-008 未指定天数「GitHub 的页面建议归档」：卡片显示 14 天、置信度「中」，提示框说明使用默认 14 天

- 优先级：P1 ｜ 类别：boundary ｜ 技术：boundary
- 关联 Feature：F-RULE-01、F-RULE-02
- 验收引用：F-RULE-01#AC1、F-RULE-02#AC5
- 关联 Code：C-FE-RULE-02
- 未来脚本：`tests/ui/TC-UI-RULE-008.spec.mjs`
- 前置条件：
  - 使用 tests/fixtures/extension.mjs 的 test：独立 persistent Chromium context（channel=chromium）加载真实扩展，popup 以 tab 方式打开（ext.openPopup()）；api 夹具在本条开始前调用 POST /api/__test__/reset
  - 后端由 Playwright webServer 启动（ENABLE_TEST_API=1，TEST_PORT 默认 4100）；夹具已把 chrome.storage.local.apiBaseUrl 写为测试后端地址
  - 只 route 外部站点（github.com、docs.internal.com 等）；禁止 route 后端 /api、localhost、127.0.0.1；元素只用 ui-contract 登记的 getByTestId
- 测试数据：输入文本：「GitHub 的页面建议归档」。后端口径（F-RULE-02#AC5）：inactiveDays=14、confidence=medium，notes 含「未指定天数，使用默认 14 天」。
- 步骤：
  - S1：打开 popup，点击 tab-rules
  - S2：在 rule-input 填入「GitHub 的页面建议归档」，点击 rule-parse-button，等待 rule-card 出现
  - S3：读取 rule-card 的 data-type、rule-card-fields、rule-card-confidence 与 rule-unparsed 文本
- 预期：
  - E1：rule-card 数量 = 1，data-type="archive_candidate"，rule-card-type 文本「建议归档」
  - E2：rule-card-fields 文本包含「github.com」和「14 天」
  - E3：rule-card-confidence 文本为「中」
  - E4：rule-unparsed 可见，文本包含「未指定天数，使用默认 14 天」
- 证据目录：`evidence/TC-UI-RULE-008/`
  - screenshot: 关键步骤截图（ext.snap）
  - extension.log
  - server.log

### TC-UI-RULE-009 冲突句「7 天…建议归档；github.com 永远不要归档」：2 张卡片 + 提示框含「冲突」「永不归档」

- 优先级：P1 ｜ 类别：negative ｜ 技术：error-guessing
- 关联 Feature：F-RULE-01、F-RULE-05
- 验收引用：F-RULE-01#AC1、F-RULE-05#AC3
- 关联 Code：C-FE-RULE-02、C-FE-RULE-01
- 未来脚本：`tests/ui/TC-UI-RULE-009.spec.mjs`
- 前置条件：
  - 使用 tests/fixtures/extension.mjs 的 test：独立 persistent Chromium context（channel=chromium）加载真实扩展，popup 以 tab 方式打开（ext.openPopup()）；api 夹具在本条开始前调用 POST /api/__test__/reset
  - 后端由 Playwright webServer 启动（ENABLE_TEST_API=1，TEST_PORT 默认 4100）；夹具已把 chrome.storage.local.apiBaseUrl 写为测试后端地址
  - 只 route 外部站点（github.com、docs.internal.com 等）；禁止 route 后端 /api、localhost、127.0.0.1；元素只用 ui-contract 登记的 getByTestId
- 测试数据：输入文本：「7 天没访问的 GitHub issue 建议归档；github.com 永远不要归档」。后端返回 2 条规则、warnings 1 条（含「冲突」「永不归档」），视图按字符串渲染在 rule-unparsed。
- 步骤：
  - S1：打开 popup，点击 tab-rules
  - S2：在 rule-input 填入冲突句，点击 rule-parse-button，等待 rule-card 出现
  - S3：读取 rule-card 的 data-type 与 rule-unparsed 文本
- 预期：
  - E1：rule-card 数量 = 2，data-type 依次为 "archive_candidate"、"never_archive"
  - E2：rule-unparsed 可见，文本同时包含「冲突」与「永不归档」
  - E3：rule-save-button 文本为「确认保存 2 条」（冲突仅提示，不阻止保存）
- 证据目录：`evidence/TC-UI-RULE-009/`
  - screenshot: 关键步骤截图（ext.snap）
  - extension.log
  - server.log

### TC-UI-RULE-010 题目示例句解析后默认勾选 2 条，点「确认保存 2 条」：后端 2 条 enabled=true，列表显示 2 条

- 优先级：P0 ｜ 类别：positive ｜ 技术：scenario
- 关联 Feature：F-RULE-06、F-RULE-07
- 验收引用：F-RULE-06#AC1、F-RULE-07#AC2
- 关联 Code：C-FE-RULE-03、C-FE-RULE-01、C-FE-RULE-04
- 未来脚本：`tests/ui/TC-UI-RULE-010.spec.mjs`
- 前置条件：
  - 使用 tests/fixtures/extension.mjs 的 test：独立 persistent Chromium context（channel=chromium）加载真实扩展，popup 以 tab 方式打开（ext.openPopup()）；api 夹具在本条开始前调用 POST /api/__test__/reset
  - 后端由 Playwright webServer 启动（ENABLE_TEST_API=1，TEST_PORT 默认 4100）；夹具已把 chrome.storage.local.apiBaseUrl 写为测试后端地址
  - 只 route 外部站点（github.com、docs.internal.com 等）；禁止 route 后端 /api、localhost、127.0.0.1；元素只用 ui-contract 登记的 getByTestId
- 测试数据：输入文本：「把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档」；后端 POST /api/rules 成功为 201（经 SAVE_RULES 透传）。正式 id 由后端分配，用例中不写死。
- 步骤：
  - S1：打开 popup，点击 tab-rules，在 rule-input 填入示例句并点击 rule-parse-button，等待 2 张 rule-card
  - S2：读取 2 个 rule-card-checkbox 的 checked 与 rule-save-button 文本
  - S3：点击 rule-save-button，等待 rule-save-result 可见
  - S4：读取 rules-count、rules-item（data-rule-id、data-type）与 rule-card 数量；调用 GET /api/rules 与 GET /api/health
- 预期：
  - E1：S2 两个 rule-card-checkbox 均为 checked，rule-save-button 文本为「确认保存 2 条」且 enabled
  - E2：S3 后 rule-save-result 文本包含「2」，不包含「失败」
  - E3：GET /api/rules 返回 total=2；2 条规则 id 均为非空字符串且互不相同，enabled=true，type 分别为 archive_candidate、never_archive；health.ruleCount=2
  - E4：rules-count 文本为「2」，rules-item 数量 = 2，其 data-rule-id 集合等于 GET /api/rules 返回的 id 集合
  - E5：保存成功后预览清空：rule-card 数量 = 0
- 证据目录：`evidence/TC-UI-RULE-010/`
  - screenshot: 保存前 / 保存后
  - server.log: POST /api/rules 201

### TC-UI-RULE-011 勾选数边界：取消第 2 条显示「确认保存 1 条」，全部取消为 0 条且 disabled，保存后只剩 archive_candidate

- 优先级：P1 ｜ 类别：boundary ｜ 技术：boundary
- 关联 Feature：F-RULE-06
- 验收引用：F-RULE-06#AC2
- 关联 Code：C-FE-RULE-03、C-FE-RULE-01
- 未来脚本：`tests/ui/TC-UI-RULE-011.spec.mjs`
- 前置条件：
  - 使用 tests/fixtures/extension.mjs 的 test：独立 persistent Chromium context（channel=chromium）加载真实扩展，popup 以 tab 方式打开（ext.openPopup()）；api 夹具在本条开始前调用 POST /api/__test__/reset
  - 后端由 Playwright webServer 启动（ENABLE_TEST_API=1，TEST_PORT 默认 4100）；夹具已把 chrome.storage.local.apiBaseUrl 写为测试后端地址
  - 只 route 外部站点（github.com、docs.internal.com 等）；禁止 route 后端 /api、localhost、127.0.0.1；元素只用 ui-contract 登记的 getByTestId
- 测试数据：输入文本：「把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档」；勾选数 N 的边界取 2 → 1 → 0 → 1。
- 步骤：
  - S1：打开 popup，点击 tab-rules，解析示例句，等待 2 张 rule-card
  - S2：取消第 2 张卡片（data-type=never_archive）的 rule-card-checkbox，读取 rule-save-button
  - S3：再取消第 1 张卡片的 rule-card-checkbox，读取 rule-save-button
  - S4：重新勾选第 1 张卡片，点击 rule-save-button，等待 rule-save-result 可见
  - S5：调用 GET /api/rules，读取 rules-item
- 预期：
  - E1：S2 后 rule-save-button 文本为「确认保存 1 条」且 enabled
  - E2：S3 后 rule-save-button 文本为「确认保存 0 条」且 disabled
  - E3：S4 后 rule-save-button 文本恢复为「确认保存 1 条」；rule-save-result 文本包含「1」
  - E4：GET /api/rules 返回 total=1，rules[0].type="archive_candidate"、rules[0].domain="github.com"
  - E5：rules-item 数量 = 1，data-type="archive_candidate"；rules-count 文本为「1」
- 证据目录：`evidence/TC-UI-RULE-011/`
  - screenshot: 关键步骤截图（ext.snap）
  - extension.log
  - server.log

### TC-UI-RULE-012 SAVE_RULES 提交 type=unknown_type：返回 VALIDATION_FAILED，规则数不变，列表仍为空

- 优先级：P1 ｜ 类别：negative ｜ 技术：equivalence
- 关联 Feature：F-RULE-06
- 验收引用：F-RULE-06#AC3
- 关联 Code：C-FE-RULE-01
- 未来脚本：`tests/ui/TC-UI-RULE-012.spec.mjs`
- 前置条件：
  - 使用 tests/fixtures/extension.mjs 的 test：独立 persistent Chromium context（channel=chromium）加载真实扩展，popup 以 tab 方式打开（ext.openPopup()）；api 夹具在本条开始前调用 POST /api/__test__/reset
  - 后端由 Playwright webServer 启动（ENABLE_TEST_API=1，TEST_PORT 默认 4100）；夹具已把 chrome.storage.local.apiBaseUrl 写为测试后端地址
  - 只 route 外部站点（github.com、docs.internal.com 等）；禁止 route 后端 /api、localhost、127.0.0.1；元素只用 ui-contract 登记的 getByTestId
  - 消息由 popup 页面执行 page.evaluate(() => chrome.runtime.sendMessage({ type, payload, requestId }))，响应信封为 { ok, data } 或 { ok:false, error:{ code, message } }
- 测试数据：payload = { rules: [{ rawText: "未知类型规则", type: "unknown_type", domain: "github.com", action: "keep" }] }（UI 无法构造非法类型，故经 SAVE_RULES 消息直达 handler）。
- 步骤：
  - S1：调用 GET /api/rules，记录 total 为 before
  - S2：打开 popup，发送 SAVE_RULES 消息（非法 type）
  - S3：调用 GET /api/rules 与 GET /api/health；点击 tab-rules，等待 rules-list-loading 消失
- 预期：
  - E1：S1 的 before=0
  - E2：S2 响应 ok=false，error.code="VALIDATION_FAILED"，error.message 为非空字符串
  - E3：S3 的 GET /api/rules body.total=0（与 before 相同），health.ruleCount=0
  - E4：rules-list-empty 可见，rules-count 文本为「0」
- 证据目录：`evidence/TC-UI-RULE-012/`
  - extension.log: SAVE_RULES 响应
  - server.log: POST /api/rules 400

### TC-UI-RULE-013 解析后后端中途不可达再点保存：rule-save-result 显示错误，预览卡片保留，后端无规则

- 优先级：P1 ｜ 类别：exception ｜ 技术：error-guessing
- 关联 Feature：F-RULE-06
- 验收引用：F-RULE-06#AC1
- 关联 Code：C-FE-RULE-03、C-FE-RULE-01
- 未来脚本：`tests/ui/TC-UI-RULE-013.spec.mjs`
- 前置条件：
  - 使用 tests/fixtures/extension.mjs 的 test：独立 persistent Chromium context（channel=chromium）加载真实扩展，popup 以 tab 方式打开（ext.openPopup()）；api 夹具在本条开始前调用 POST /api/__test__/reset
  - 后端由 Playwright webServer 启动（ENABLE_TEST_API=1，TEST_PORT 默认 4100）；夹具已把 chrome.storage.local.apiBaseUrl 写为测试后端地址
  - 只 route 外部站点（github.com、docs.internal.com 等）；禁止 route 后端 /api、localhost、127.0.0.1；元素只用 ui-contract 登记的 getByTestId
  - 后端不可达用 ext.useUnreachableBackend()（apiBaseUrl=http://127.0.0.1:9）构造，不 route 后端
- 测试数据：先在线解析「把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档」得到 2 张卡片，再把 apiBaseUrl 改为 http://127.0.0.1:9；真实后端仍在运行，用 api 夹具查询。
- 步骤：
  - S1：打开 popup，点击 tab-rules，解析示例句，等待 2 张 rule-card
  - S2：调用 ext.useUnreachableBackend()（不刷新 popup）
  - S3：点击 rule-save-button，等待 rule-save-result 可见（最多 12 秒）
  - S4：用 api 夹具调用 GET /api/rules
- 预期：
  - E1：S3 后 rule-save-result 可见，文本不包含「已保存」，且长度 ≥ 2
  - E2：S3 后 rule-card 数量仍为 2（失败时不清空预览，可重试）
  - E3：S4 的 GET /api/rules body.total=0
- 证据目录：`evidence/TC-UI-RULE-013/`
  - screenshot: 关键步骤截图（ext.snap）
  - extension.log
  - server.log

### TC-UI-RULE-014 已保存 2 条规则后打开规则页签：列表 2 条，每条有类型标签、摘要、原文、开启的开关和删除按钮

- 优先级：P0 ｜ 类别：positive ｜ 技术：equivalence
- 关联 Feature：F-RULE-07
- 验收引用：F-RULE-07#AC1、F-RULE-07#AC2
- 关联 Code：C-FE-RULE-04、C-FE-RULE-01
- 未来脚本：`tests/ui/TC-UI-RULE-014.spec.mjs`
- 前置条件：
  - 使用 tests/fixtures/extension.mjs 的 test：独立 persistent Chromium context（channel=chromium）加载真实扩展，popup 以 tab 方式打开（ext.openPopup()）；api 夹具在本条开始前调用 POST /api/__test__/reset
  - 后端由 Playwright webServer 启动（ENABLE_TEST_API=1，TEST_PORT 默认 4100）；夹具已把 chrome.storage.local.apiBaseUrl 写为测试后端地址
  - 只 route 外部站点（github.com、docs.internal.com 等）；禁止 route 后端 /api、localhost、127.0.0.1；元素只用 ui-contract 登记的 getByTestId
- 测试数据：准备步骤（setup，不计入断言）：api.post('/api/rules/parse', { text: '把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档' }) 取 body.rules，原样作为 api.post('/api/rules', { rules }) 的请求体保存，记下返回的正式 id；得到 archive_candidate 与 never_archive 2 条规则。
- 步骤：
  - S1：按 testData 经接口保存 2 条规则，调用 GET /api/rules
  - S2：打开 popup，点击 tab-rules，等待 rules-list-loading 消失、rules-list 可见
  - S3：逐条读取 rules-item 的 data-rule-id / data-type，以及其中 rules-item-type、rules-item-summary、rules-item-raw、rules-item-toggle、rules-item-delete
- 预期：
  - E1：S1 的 GET /api/rules 返回 200，total=2，每条都含 id、rawText、type、action、enabled 字段
  - E2：rules-count 文本为「2」，rules-item 数量 = 2，data-rule-id 集合等于 S1 返回的 id 集合
  - E3：data-type="archive_candidate" 的项 rules-item-type 文本「建议归档」、rules-item-raw 文本「把 7 天没访问过的 GitHub issue 建议归档」、rules-item-summary 文本包含「github.com」
  - E4：data-type="never_archive" 的项 rules-item-type 文本「永不归档」、rules-item-raw 文本「docs.internal.com 的页面永远不要归档」、rules-item-summary 文本包含「docs.internal.com」
  - E5：每条的 rules-item-toggle 为 checked（role=switch），rules-item-delete 可见且 enabled
- 证据目录：`evidence/TC-UI-RULE-014/`
  - screenshot: 关键步骤截图（ext.snap）
  - extension.log
  - server.log

### TC-UI-RULE-015 没有任何规则时打开规则页签：显示 rules-list-empty，规则数为 0

- 优先级：P2 ｜ 类别：state ｜ 技术：state-transition
- 关联 Feature：F-RULE-07
- 验收引用：F-RULE-07#AC2
- 关联 Code：C-FE-RULE-04、C-FE-RULE-01
- 未来脚本：`tests/ui/TC-UI-RULE-015.spec.mjs`
- 前置条件：
  - 使用 tests/fixtures/extension.mjs 的 test：独立 persistent Chromium context（channel=chromium）加载真实扩展，popup 以 tab 方式打开（ext.openPopup()）；api 夹具在本条开始前调用 POST /api/__test__/reset
  - 后端由 Playwright webServer 启动（ENABLE_TEST_API=1，TEST_PORT 默认 4100）；夹具已把 chrome.storage.local.apiBaseUrl 写为测试后端地址
  - 只 route 外部站点（github.com、docs.internal.com 等）；禁止 route 后端 /api、localhost、127.0.0.1；元素只用 ui-contract 登记的 getByTestId
- 测试数据：后端 reset 后 0 条规则。
- 步骤：
  - S1：调用 GET /api/rules
  - S2：打开 popup，点击 tab-rules，等待 rules-list-loading 消失
- 预期：
  - E1：S1 的 body.total=0
  - E2：rules-list-empty 可见，rules-list-error 不可见
  - E3：rules-count 文本为「0」，rules-item 数量 = 0
- 证据目录：`evidence/TC-UI-RULE-015/`
  - screenshot: 关键步骤截图（ext.snap）
  - extension.log
  - server.log

### TC-UI-RULE-016 后端不可达且无规则缓存：规则列表显示 rules-list-error，不显示空状态

- 优先级：P1 ｜ 类别：exception ｜ 技术：error-guessing
- 关联 Feature：F-RULE-07
- 验收引用：F-RULE-07#AC2
- 关联 Code：C-FE-RULE-04、C-FE-RULE-01
- 未来脚本：`tests/ui/TC-UI-RULE-016.spec.mjs`
- 前置条件：
  - 使用 tests/fixtures/extension.mjs 的 test：独立 persistent Chromium context（channel=chromium）加载真实扩展，popup 以 tab 方式打开（ext.openPopup()）；api 夹具在本条开始前调用 POST /api/__test__/reset
  - 后端由 Playwright webServer 启动（ENABLE_TEST_API=1，TEST_PORT 默认 4100）；夹具已把 chrome.storage.local.apiBaseUrl 写为测试后端地址
  - 只 route 外部站点（github.com、docs.internal.com 等）；禁止 route 后端 /api、localhost、127.0.0.1；元素只用 ui-contract 登记的 getByTestId
  - 后端不可达用 ext.useUnreachableBackend()（apiBaseUrl=http://127.0.0.1:9）构造，不 route 后端
- 测试数据：chrome.storage.local 中没有 cache.rules（全新 profile）；打开 popup 前设置 apiBaseUrl=http://127.0.0.1:9。
- 步骤：
  - S1：调用 ext.useUnreachableBackend()，打开 popup
  - S2：点击 tab-rules，等待 rules-list-loading 消失（最多 12 秒）
- 预期：
  - E1：rules-list-error 可见，文本非空
  - E2：rules-list-empty 不可见，rules-item 数量 = 0
- 证据目录：`evidence/TC-UI-RULE-016/`
  - screenshot: 关键步骤截图（ext.snap）
  - extension.log
  - server.log

### TC-UI-RULE-017 在线加载过 2 条规则后后端不可达：离线仍显示缓存的 2 条规则，「解析」不可用

- 优先级：P1 ｜ 类别：exception ｜ 技术：state-transition
- 关联 Feature：F-RULE-07、F-RULE-01
- 验收引用：F-RULE-07#AC2、F-RULE-01#AC4
- 关联 Code：C-FE-RULE-04、C-FE-RULE-01、C-FE-RULE-02
- 未来脚本：`tests/ui/TC-UI-RULE-017.spec.mjs`
- 前置条件：
  - 使用 tests/fixtures/extension.mjs 的 test：独立 persistent Chromium context（channel=chromium）加载真实扩展，popup 以 tab 方式打开（ext.openPopup()）；api 夹具在本条开始前调用 POST /api/__test__/reset
  - 后端由 Playwright webServer 启动（ENABLE_TEST_API=1，TEST_PORT 默认 4100）；夹具已把 chrome.storage.local.apiBaseUrl 写为测试后端地址
  - 只 route 外部站点（github.com、docs.internal.com 等）；禁止 route 后端 /api、localhost、127.0.0.1；元素只用 ui-contract 登记的 getByTestId
  - 后端不可达用 ext.useUnreachableBackend()（apiBaseUrl=http://127.0.0.1:9）构造，不 route 后端
- 测试数据：准备步骤（setup，不计入断言）：api.post('/api/rules/parse', { text: '把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档' }) 取 body.rules，原样作为 api.post('/api/rules', { rules }) 的请求体保存，记下返回的正式 id；先在线打开规则页签让 LIST_RULES 写入 cache.rules，再切换为不可达。PRD 第 1444 行：离线时已保存的规则仍然可以查看。
- 步骤：
  - S1：按 testData 保存 2 条规则；打开 popup，点击 tab-rules，等待 rules-item 数量 = 2
  - S2：关闭 popup，调用 ext.useUnreachableBackend()，重新打开 popup 并点击 tab-rules，等待 rules-list-loading 消失
  - S3：读取 rules-item、rules-count、rule-parse-button、rule-offline-hint
- 预期：
  - E1：S1 时 rules-count 文本为「2」
  - E2：S3 时 rules-item 数量 = 2，data-rule-id 与 S1 相同；rules-count 文本为「2」；rules-list-error 不可见
  - E3：rule-parse-button 为 disabled，rule-offline-hint 文本包含「后端未连接」
- 证据目录：`evidence/TC-UI-RULE-017/`
  - screenshot: 关键步骤截图（ext.snap）
  - extension.log
  - server.log

### TC-UI-RULE-018 删除 never_archive 规则并确认：列表剩 1 条、health.ruleCount=1，整理页签不再有 ai-agent-design 的保留项

- 优先级：P0 ｜ 类别：positive ｜ 技术：scenario
- 关联 Feature：F-RULE-08
- 验收引用：F-RULE-08#AC1、F-RULE-08#AC3
- 关联 Code：C-FE-RULE-04、C-FE-RULE-01
- 未来脚本：`tests/ui/TC-UI-RULE-018.spec.mjs`
- 前置条件：
  - 使用 tests/fixtures/extension.mjs 的 test：独立 persistent Chromium context（channel=chromium）加载真实扩展，popup 以 tab 方式打开（ext.openPopup()）；api 夹具在本条开始前调用 POST /api/__test__/reset
  - 后端由 Playwright webServer 启动（ENABLE_TEST_API=1，TEST_PORT 默认 4100）；夹具已把 chrome.storage.local.apiBaseUrl 写为测试后端地址
  - 只 route 外部站点（github.com、docs.internal.com 等）；禁止 route 后端 /api、localhost、127.0.0.1；元素只用 ui-contract 登记的 getByTestId
- 测试数据：api.loadSample()（resource.json 按 D-01 平移导入）；准备步骤（setup，不计入断言）：api.post('/api/rules/parse', { text: '把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档' }) 取 body.rules，原样作为 api.post('/api/rules', { rules }) 的请求体保存，记下返回的正式 id。保存后整理建议中 https://docs.internal.com/ai-agent-design 为 keep（命中 never_archive）。
- 步骤：
  - S1：导入样例并经接口保存 2 条规则；调用 GET /api/pages/cleanup-suggestions
  - S2：打开 popup，点击 tab-rules，等待 rules-item 数量 = 2
  - S3：在 data-type="never_archive" 的 rules-item 内点击 rules-item-delete，再点击出现的 rules-item-delete-confirm
  - S4：等待 rules-item 数量变为 1；调用 GET /api/rules、GET /api/health、GET /api/pages/cleanup-suggestions
  - S5：点击 tab-cleanup，等待 cleanup-group-keep 渲染完成，读取所有 data-action="keep" 的 cleanup-item 的 cleanup-item-url
- 预期：
  - E1：S1 的 suggestions 中存在 action="keep"、url="https://docs.internal.com/ai-agent-design" 的项
  - E2：S3 点击 rules-item-delete 后 rules-item-delete-confirm 可见；确认前 rules-item 数量仍为 2
  - E3：S4 后 rules-item 数量 = 1，剩余项 data-type="archive_candidate"；rules-count 文本为「1」
  - E4：GET /api/rules total=1；GET /api/health ruleCount=1
  - E5：S4 的 cleanup-suggestions 中没有 action="keep" 且 url="https://docs.internal.com/ai-agent-design" 的项；S5 中 data-action="keep" 的 cleanup-item 均不含 https://docs.internal.com/ai-agent-design
- 证据目录：`evidence/TC-UI-RULE-018/`
  - screenshot: 删除确认 / 删除后列表 / 整理页签
  - server.log: DELETE /api/rules/:id 200

### TC-UI-RULE-019 DELETE_RULE 删除不存在的 id=rule_not_exist：返回 NOT_FOUND，规则数不变

- 优先级：P1 ｜ 类别：negative ｜ 技术：error-guessing
- 关联 Feature：F-RULE-08
- 验收引用：F-RULE-08#AC2
- 关联 Code：C-FE-RULE-01
- 未来脚本：`tests/ui/TC-UI-RULE-019.spec.mjs`
- 前置条件：
  - 使用 tests/fixtures/extension.mjs 的 test：独立 persistent Chromium context（channel=chromium）加载真实扩展，popup 以 tab 方式打开（ext.openPopup()）；api 夹具在本条开始前调用 POST /api/__test__/reset
  - 后端由 Playwright webServer 启动（ENABLE_TEST_API=1，TEST_PORT 默认 4100）；夹具已把 chrome.storage.local.apiBaseUrl 写为测试后端地址
  - 只 route 外部站点（github.com、docs.internal.com 等）；禁止 route 后端 /api、localhost、127.0.0.1；元素只用 ui-contract 登记的 getByTestId
  - 消息由 popup 页面执行 page.evaluate(() => chrome.runtime.sendMessage({ type, payload, requestId }))，响应信封为 { ok, data } 或 { ok:false, error:{ code, message } }
- 测试数据：准备步骤（setup，不计入断言）：api.post('/api/rules/parse', { text: 'docs.internal.com 的页面永远不要归档' }) 取 body.rules，原样作为 api.post('/api/rules', { rules }) 的请求体保存，记下返回的正式 id（1 条 never_archive）；再删除不存在的 id "rule_not_exist"。
- 步骤：
  - S1：经接口保存 1 条规则；打开 popup
  - S2：发送 DELETE_RULE { id: "rule_not_exist" }
  - S3：调用 GET /api/rules；点击 tab-rules，等待 rules-list-loading 消失
- 预期：
  - E1：S2 响应 ok=false，error.code="NOT_FOUND"，error.message 包含「rule_not_exist」
  - E2：S3 的 GET /api/rules total=1
  - E3：rules-item 数量 = 1，data-type="never_archive"
- 证据目录：`evidence/TC-UI-RULE-019/`
  - screenshot: 关键步骤截图（ext.snap）
  - extension.log
  - server.log

### TC-UI-RULE-020 删除最后 1 条规则（1→0）：未确认不删除，确认后列表进入空状态、health.ruleCount=0

- 优先级：P2 ｜ 类别：boundary ｜ 技术：boundary
- 关联 Feature：F-RULE-08
- 验收引用：F-RULE-08#AC1
- 关联 Code：C-FE-RULE-04、C-FE-RULE-01
- 未来脚本：`tests/ui/TC-UI-RULE-020.spec.mjs`
- 前置条件：
  - 使用 tests/fixtures/extension.mjs 的 test：独立 persistent Chromium context（channel=chromium）加载真实扩展，popup 以 tab 方式打开（ext.openPopup()）；api 夹具在本条开始前调用 POST /api/__test__/reset
  - 后端由 Playwright webServer 启动（ENABLE_TEST_API=1，TEST_PORT 默认 4100）；夹具已把 chrome.storage.local.apiBaseUrl 写为测试后端地址
  - 只 route 外部站点（github.com、docs.internal.com 等）；禁止 route 后端 /api、localhost、127.0.0.1；元素只用 ui-contract 登记的 getByTestId
- 测试数据：准备步骤（setup，不计入断言）：api.post('/api/rules/parse', { text: 'docs.internal.com 的页面永远不要归档' }) 取 body.rules，原样作为 api.post('/api/rules', { rules }) 的请求体保存，记下返回的正式 id（仅 1 条 never_archive）。边界：规则数 1 → 0；未点击确认按钮时不得发出删除。
- 步骤：
  - S1：经接口保存 1 条规则；打开 popup，点击 tab-rules，等待 rules-item 数量 = 1
  - S2：点击 rules-item-delete 但不点击 rules-item-delete-confirm；关闭并重新打开 popup，点击 tab-rules；调用 GET /api/rules
  - S3：点击 rules-item-delete，再点击 rules-item-delete-confirm，等待 rules-item 数量变为 0
  - S4：调用 GET /api/rules 与 GET /api/health
- 预期：
  - E1：S2 后 rules-item 数量仍为 1，GET /api/rules total=1
  - E2：S3 后 rules-list-empty 可见，rules-count 文本为「0」
  - E3：S4 的 GET /api/rules total=0，rules=[]；health.ruleCount=0
- 证据目录：`evidence/TC-UI-RULE-020/`
  - screenshot: 关键步骤截图（ext.snap）
  - extension.log
  - server.log

### TC-UI-RULE-021 列表加载后后端不可达再删除：删除失败，列表与后端规则均保持 2 条

- 优先级：P2 ｜ 类别：exception ｜ 技术：error-guessing
- 关联 Feature：F-RULE-08
- 验收引用：F-RULE-08#AC1
- 关联 Code：C-FE-RULE-04、C-FE-RULE-01
- 未来脚本：`tests/ui/TC-UI-RULE-021.spec.mjs`
- 前置条件：
  - 使用 tests/fixtures/extension.mjs 的 test：独立 persistent Chromium context（channel=chromium）加载真实扩展，popup 以 tab 方式打开（ext.openPopup()）；api 夹具在本条开始前调用 POST /api/__test__/reset
  - 后端由 Playwright webServer 启动（ENABLE_TEST_API=1，TEST_PORT 默认 4100）；夹具已把 chrome.storage.local.apiBaseUrl 写为测试后端地址
  - 只 route 外部站点（github.com、docs.internal.com 等）；禁止 route 后端 /api、localhost、127.0.0.1；元素只用 ui-contract 登记的 getByTestId
  - 后端不可达用 ext.useUnreachableBackend()（apiBaseUrl=http://127.0.0.1:9）构造，不 route 后端
- 测试数据：准备步骤（setup，不计入断言）：api.post('/api/rules/parse', { text: '把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档' }) 取 body.rules，原样作为 api.post('/api/rules', { rules }) 的请求体保存，记下返回的正式 id；在线加载列表后把 apiBaseUrl 改为 http://127.0.0.1:9 再删除。
- 步骤：
  - S1：经接口保存 2 条规则；打开 popup，点击 tab-rules，等待 rules-item 数量 = 2，记录 data-rule-id 集合
  - S2：调用 ext.useUnreachableBackend()（不刷新 popup）
  - S3：在 data-type="never_archive" 的项内点击 rules-item-delete 与 rules-item-delete-confirm，等待最多 12 秒
  - S4：用 api 夹具调用 GET /api/rules
- 预期：
  - E1：S3 后 rules-item 数量仍为 2，data-rule-id 集合与 S1 相同
  - E2：S4 的 GET /api/rules total=2
- 证据目录：`evidence/TC-UI-RULE-021/`
  - screenshot: 关键步骤截图（ext.snap）
  - extension.log
  - server.log

### TC-UI-RULE-022 关闭 never_archive 开关后整理建议无 ai-agent-design 的 keep，重新打开后 keep 恢复

- 优先级：P1 ｜ 类别：positive ｜ 技术：state-transition
- 关联 Feature：F-RULE-09
- 验收引用：F-RULE-09#AC1、F-RULE-09#AC2
- 关联 Code：C-FE-RULE-04、C-FE-RULE-01
- 未来脚本：`tests/ui/TC-UI-RULE-022.spec.mjs`
- 前置条件：
  - 使用 tests/fixtures/extension.mjs 的 test：独立 persistent Chromium context（channel=chromium）加载真实扩展，popup 以 tab 方式打开（ext.openPopup()）；api 夹具在本条开始前调用 POST /api/__test__/reset
  - 后端由 Playwright webServer 启动（ENABLE_TEST_API=1，TEST_PORT 默认 4100）；夹具已把 chrome.storage.local.apiBaseUrl 写为测试后端地址
  - 只 route 外部站点（github.com、docs.internal.com 等）；禁止 route 后端 /api、localhost、127.0.0.1；元素只用 ui-contract 登记的 getByTestId
- 测试数据：api.loadSample()（D-01 平移）；准备步骤（setup，不计入断言）：api.post('/api/rules/parse', { text: 'docs.internal.com 的页面永远不要归档' }) 取 body.rules，原样作为 api.post('/api/rules', { rules }) 的请求体保存，记下返回的正式 id（type=never_archive、domain=docs.internal.com）。
- 步骤：
  - S1：导入样例并经接口保存 never_archive 规则；打开 popup，点击 tab-rules，等待 rules-item 数量 = 1
  - S2：点击 rules-item-toggle（关闭），等待其 checked=false；调用 GET /api/rules 与 GET /api/pages/cleanup-suggestions
  - S3：点击 tab-cleanup，读取 data-action="keep" 的 cleanup-item 的 cleanup-item-url
  - S4：点击 tab-rules，再次点击 rules-item-toggle（打开），等待 checked=true；调用 GET /api/rules 与 GET /api/pages/cleanup-suggestions
  - S5：点击 tab-cleanup，读取 data-action="keep" 的 cleanup-item 的 cleanup-item-url 与 cleanup-item-rule-tag
- 预期：
  - E1：S2 后 rules-item-toggle 未选中；GET /api/rules 中该规则 enabled=false
  - E2：S2 的 cleanup-suggestions 中没有 action="keep" 且 url="https://docs.internal.com/ai-agent-design" 的项；S3 中 keep 项均不含 https://docs.internal.com/ai-agent-design
  - E3：S4 后 rules-item-toggle 为 checked；GET /api/rules 中该规则 enabled=true
  - E4：S4 的 cleanup-suggestions 中存在 action="keep"、url="https://docs.internal.com/ai-agent-design" 的项；S5 中有 1 个 data-action="keep" 的 cleanup-item 的 cleanup-item-url 包含 https://docs.internal.com/ai-agent-design，且其 cleanup-item-rule-tag 可见
- 证据目录：`evidence/TC-UI-RULE-022/`
  - screenshot: 停用后 / 启用后的整理页签
  - server.log: 2 次 PATCH /api/rules/:id

### TC-UI-RULE-023 TOGGLE_RULE 作用于不存在的 id=rule_not_exist：返回 NOT_FOUND，已有规则 enabled 不变

- 优先级：P2 ｜ 类别：negative ｜ 技术：error-guessing
- 关联 Feature：F-RULE-09
- 验收引用：F-RULE-09#AC1
- 关联 Code：C-FE-RULE-01
- 未来脚本：`tests/ui/TC-UI-RULE-023.spec.mjs`
- 前置条件：
  - 使用 tests/fixtures/extension.mjs 的 test：独立 persistent Chromium context（channel=chromium）加载真实扩展，popup 以 tab 方式打开（ext.openPopup()）；api 夹具在本条开始前调用 POST /api/__test__/reset
  - 后端由 Playwright webServer 启动（ENABLE_TEST_API=1，TEST_PORT 默认 4100）；夹具已把 chrome.storage.local.apiBaseUrl 写为测试后端地址
  - 只 route 外部站点（github.com、docs.internal.com 等）；禁止 route 后端 /api、localhost、127.0.0.1；元素只用 ui-contract 登记的 getByTestId
  - 消息由 popup 页面执行 page.evaluate(() => chrome.runtime.sendMessage({ type, payload, requestId }))，响应信封为 { ok, data } 或 { ok:false, error:{ code, message } }
- 测试数据：准备步骤（setup，不计入断言）：api.post('/api/rules/parse', { text: 'docs.internal.com 的页面永远不要归档' }) 取 body.rules，原样作为 api.post('/api/rules', { rules }) 的请求体保存，记下返回的正式 id；对不存在的 id "rule_not_exist" 发送 TOGGLE_RULE { enabled:false }。
- 步骤：
  - S1：经接口保存 1 条规则；打开 popup
  - S2：发送 TOGGLE_RULE { id: "rule_not_exist", enabled: false }
  - S3：调用 GET /api/rules 与 GET /api/health
- 预期：
  - E1：S2 响应 ok=false，error.code="NOT_FOUND"
  - E2：S3 的 GET /api/rules total=1，rules[0].enabled=true
  - E3：health.enabledRuleCount=1
- 证据目录：`evidence/TC-UI-RULE-023/`
  - screenshot: 关键步骤截图（ext.snap）
  - extension.log
  - server.log

### TC-UI-RULE-024 停用唯一规则后重开 popup 开关仍为关闭，health.enabledRuleCount 1→0→1

- 优先级：P2 ｜ 类别：boundary ｜ 技术：state-transition
- 关联 Feature：F-RULE-09
- 验收引用：F-RULE-09#AC1、F-RULE-09#AC2
- 关联 Code：C-FE-RULE-04、C-FE-RULE-01
- 未来脚本：`tests/ui/TC-UI-RULE-024.spec.mjs`
- 前置条件：
  - 使用 tests/fixtures/extension.mjs 的 test：独立 persistent Chromium context（channel=chromium）加载真实扩展，popup 以 tab 方式打开（ext.openPopup()）；api 夹具在本条开始前调用 POST /api/__test__/reset
  - 后端由 Playwright webServer 启动（ENABLE_TEST_API=1，TEST_PORT 默认 4100）；夹具已把 chrome.storage.local.apiBaseUrl 写为测试后端地址
  - 只 route 外部站点（github.com、docs.internal.com 等）；禁止 route 后端 /api、localhost、127.0.0.1；元素只用 ui-contract 登记的 getByTestId
- 测试数据：准备步骤（setup，不计入断言）：api.post('/api/rules/parse', { text: 'docs.internal.com 的页面永远不要归档' }) 取 body.rules，原样作为 api.post('/api/rules', { rules }) 的请求体保存，记下返回的正式 id（仅 1 条规则）。边界：启用规则数在 1 与 0 之间切换。
- 步骤：
  - S1：经接口保存 1 条规则，调用 GET /api/health；打开 popup，点击 tab-rules
  - S2：点击 rules-item-toggle（关闭），等待 checked=false；调用 GET /api/health
  - S3：关闭并重新打开 popup，点击 tab-rules，等待 rules-list-loading 消失
  - S4：点击 rules-item-toggle（打开），等待 checked=true；调用 GET /api/health
- 预期：
  - E1：S1 的 health.ruleCount=1、enabledRuleCount=1
  - E2：S2 的 health.ruleCount=1、enabledRuleCount=0
  - E3：S3 后 rules-item 数量 = 1，rules-item-toggle 未选中（停用状态持久）
  - E4：S4 的 health.enabledRuleCount=1
- 证据目录：`evidence/TC-UI-RULE-024/`
  - screenshot: 关键步骤截图（ext.snap）
  - extension.log
  - server.log

### TC-UI-RULE-025 后端不可达时切换开关：后端规则 enabled 保持 true，恢复在线后开关显示为开启

- 优先级：P2 ｜ 类别：exception ｜ 技术：error-guessing
- 关联 Feature：F-RULE-09
- 验收引用：F-RULE-09#AC1
- 关联 Code：C-FE-RULE-04、C-FE-RULE-01
- 未来脚本：`tests/ui/TC-UI-RULE-025.spec.mjs`
- 前置条件：
  - 使用 tests/fixtures/extension.mjs 的 test：独立 persistent Chromium context（channel=chromium）加载真实扩展，popup 以 tab 方式打开（ext.openPopup()）；api 夹具在本条开始前调用 POST /api/__test__/reset
  - 后端由 Playwright webServer 启动（ENABLE_TEST_API=1，TEST_PORT 默认 4100）；夹具已把 chrome.storage.local.apiBaseUrl 写为测试后端地址
  - 只 route 外部站点（github.com、docs.internal.com 等）；禁止 route 后端 /api、localhost、127.0.0.1；元素只用 ui-contract 登记的 getByTestId
  - 后端不可达用 ext.useUnreachableBackend()（apiBaseUrl=http://127.0.0.1:9）构造，不 route 后端
- 测试数据：准备步骤（setup，不计入断言）：api.post('/api/rules/parse', { text: 'docs.internal.com 的页面永远不要归档' }) 取 body.rules，原样作为 api.post('/api/rules', { rules }) 的请求体保存，记下返回的正式 id；在线加载列表后把 apiBaseUrl 改为 http://127.0.0.1:9 再关闭开关，最后改回测试后端地址。
- 步骤：
  - S1：经接口保存 1 条规则；打开 popup，点击 tab-rules，等待 rules-item 数量 = 1
  - S2：调用 ext.useUnreachableBackend()，点击 rules-item-toggle，等待最多 12 秒
  - S3：用 api 夹具调用 GET /api/rules
  - S4：调用 ext.setApiBase(测试后端地址)，关闭并重新打开 popup，点击 tab-rules，等待 rules-list-loading 消失
- 预期：
  - E1：S3 的 GET /api/rules total=1，rules[0].enabled=true
  - E2：S4 后 rules-item-toggle 为 checked（与后端 enabled=true 一致）
- 证据目录：`evidence/TC-UI-RULE-025/`
  - screenshot: 关键步骤截图（ext.snap）
  - extension.log
  - server.log

## Feature → Case 覆盖

| Feature | AC | 覆盖用例 | 类别分布（正 / 反 / 边 / 异 / 其他） | waiver |
|---|---|---|---|---|
| F-RULE-01 | AC1 | TC-UI-RULE-001、TC-UI-RULE-005、TC-UI-RULE-008、TC-UI-RULE-009 | 3 / 2 / 2 / 3 / 0 | 无 |
| F-RULE-01 | AC2 | TC-UI-RULE-002、TC-UI-RULE-006 | 3 / 2 / 2 / 3 / 0 | 无 |
| F-RULE-01 | AC3 | TC-UI-RULE-003 | 3 / 2 / 2 / 3 / 0 | 无 |
| F-RULE-01 | AC4 | TC-UI-RULE-004、TC-UI-RULE-007、TC-UI-RULE-017 | 3 / 2 / 2 / 3 / 0 | 无 |
| F-RULE-06 | AC1 | TC-UI-RULE-010、TC-UI-RULE-013 | 1 / 1 / 1 / 1 / 0 | 无 |
| F-RULE-06 | AC2 | TC-UI-RULE-011 | 1 / 1 / 1 / 1 / 0 | 无 |
| F-RULE-06 | AC3 | TC-UI-RULE-012 | 1 / 1 / 1 / 1 / 0 | 无 |
| F-RULE-07 | AC1 | TC-UI-RULE-014 | 2 / 0 / 0 / 2 / 1 | 无 |
| F-RULE-07 | AC2 | TC-UI-RULE-010、TC-UI-RULE-014、TC-UI-RULE-015、TC-UI-RULE-016、TC-UI-RULE-017 | 2 / 0 / 0 / 2 / 1 | 无 |
| F-RULE-08 | AC1 | TC-UI-RULE-018、TC-UI-RULE-020、TC-UI-RULE-021 | 1 / 1 / 1 / 1 / 0 | 无 |
| F-RULE-08 | AC2 | TC-UI-RULE-019 | 1 / 1 / 1 / 1 / 0 | 无 |
| F-RULE-08 | AC3 | TC-UI-RULE-018 | 1 / 1 / 1 / 1 / 0 | 无 |
| F-RULE-09 | AC1 | TC-UI-RULE-022、TC-UI-RULE-023、TC-UI-RULE-024、TC-UI-RULE-025 | 1 / 1 / 1 / 1 / 0 | 无 |
| F-RULE-09 | AC2 | TC-UI-RULE-022、TC-UI-RULE-024 | 1 / 1 / 1 / 1 / 0 | 无 |

## Code → Case 覆盖

| Code ID | 用例 |
|---|---|
| C-FE-RULE-01 | TC-UI-RULE-001、TC-UI-RULE-002、TC-UI-RULE-003、TC-UI-RULE-005、TC-UI-RULE-006、TC-UI-RULE-007、TC-UI-RULE-009、TC-UI-RULE-010、TC-UI-RULE-011、TC-UI-RULE-012、TC-UI-RULE-013、TC-UI-RULE-014、TC-UI-RULE-015、TC-UI-RULE-016、TC-UI-RULE-017、TC-UI-RULE-018、TC-UI-RULE-019、TC-UI-RULE-020、TC-UI-RULE-021、TC-UI-RULE-022、TC-UI-RULE-023、TC-UI-RULE-024、TC-UI-RULE-025 |
| C-FE-RULE-02 | TC-UI-RULE-001、TC-UI-RULE-002、TC-UI-RULE-003、TC-UI-RULE-004、TC-UI-RULE-005、TC-UI-RULE-007、TC-UI-RULE-008、TC-UI-RULE-009、TC-UI-RULE-017 |
| C-FE-RULE-03 | TC-UI-RULE-010、TC-UI-RULE-011、TC-UI-RULE-013 |
| C-FE-RULE-04 | TC-UI-RULE-010、TC-UI-RULE-014、TC-UI-RULE-015、TC-UI-RULE-016、TC-UI-RULE-017、TC-UI-RULE-018、TC-UI-RULE-020、TC-UI-RULE-021、TC-UI-RULE-022、TC-UI-RULE-024、TC-UI-RULE-025 |
| C-FE-RULE-05 | TC-UI-RULE-004、TC-UI-RULE-005 |

## 类别分布统计（本分片）

| 类别 | 数量 |
|---|---|
| positive | 7 |
| negative | 5 |
| exception | 7 |
| boundary | 5 |
| state | 1 |

| 优先级 | 数量 |
|---|---|
| P0 | 6 |
| P1 | 13 |
| P2 | 6 |

> 全项目统计以 `node .agents/skills/nav-test-case-design/scripts/check-cases.mjs --json` 的 stats 为准。
