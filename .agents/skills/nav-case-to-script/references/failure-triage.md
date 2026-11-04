# 失败分诊

`run-cases.mjs` 会给每个失败打上分类（`summary.json` → `steps.run.cases[].failures[].category`），同时给出 `[En]` 标签和一句提示。分诊顺序：**先看分类 → 再看证据 → 最后看代码**。

## 1. 证据在哪里

| 想知道 | 看哪里 |
|---|---|
| 请求发了什么、后端回了什么 | `evidence/<CaseID>/api/NN-*.json` |
| 后端有没有收到请求、内部报了什么错 | `evidence/<CaseID>/server.log`（按 reqId `<CaseID>-NN` 搜索） |
| 插件做了什么、报了什么错 | `evidence/<CaseID>/extension.log` |
| 页面长什么样 | `evidence/<CaseID>/screenshots/*.png`、`flow.gif` |
| Playwright 原始报告、trace | `evidence/_runs/<runId>/pw.json`、`test-results/**/trace.zip`（`npx playwright show-trace`） |
| 后端没起来的原因 | `summary.json` 中的 `steps.run.webServerStderr` |

## 2. 分类 → 动作

| 分类 | 判定依据 | 负责方 | 动作 |
|---|---|---|---|
| ENV | webServer 启动失败、端口被占用、浏览器启动失败 | 环境 | 换端口，检查 `node server/src/index.js` 能不能单独启动；不改脚本 |
| SETUP | `[setup]` 开头的错误：reset 或数据导入失败 | 后端 | TDD 红灯阶段属于正常；产品实现之后仍然失败 → 后端缺陷 |
| SCRIPT | SyntaxError、导入错误、未定义的变量、getByTestId 匹配到多个元素 | 脚本 | 直接修改脚本 |
| CONTRACT | `Cannot read properties of undefined` | 待定 | 对照 `api/*.json` 的实际响应和 api-contract：不一致 → 后端缺陷；一致 → 脚本取值路径错误 |
| ASSERTION | `[En]` 断言失败 | 待定 | 见第 3 节 |
| ASSERTION_UNTAGGED | 断言失败，但没有 `[En]` 标签 | 脚本 | 先补标签，再按 ASSERTION 处理 |
| TIMEOUT | 测试或等待超时 | 待定 | 看截图：元素根本没有渲染 → 产品缺陷；渲染了但 testId 不一样 → 对照 ui-contract，确定是产品没按契约实现还是脚本写错 |

## 3. 断言失败的裁决

按权威顺序比较：`PROBLEM.md` > `PRD / features.json` > `api-contract.json / ui-contract.json` > `cases-*.json` > 测试脚本。

1. 实际值不符合契约或用例，而契约和用例与上游文档一致 → **产品缺陷**。在报告中写清楚：Case ID、`[En]`、期望值、实际值、证据路径。不改脚本。
2. 脚本的期望值与用例 expected 不一致（脚本写错了）→ 修脚本，使它与用例一致。
3. 用例 expected 与契约或 PRD 冲突 → 不要自己改，提交 `testDisputes`：`{ caseId, reason, evidence: "文档原文 vs 断言" }`，由仲裁 agent 裁决。
4. **任何情况下都不允许**：为了让测试通过而删掉断言、放宽匹配器（`toBe` 改成 `toBeTruthy`）、修改期望值去迎合实现、加 skip。

## 4. 变异存活

`mutation.json` 中的 `survived` 列出了没被杀死的算子。处理方式见 `assertion-cookbook.md` §4。判断能不能豁免：这个属性是否出现在本用例的任何一条 expected 中？出现了 → 必须补断言；没出现，并且由别的用例负责 → 可以写 `mutation-ignore`，理由中写明由哪个用例负责。

## 5. 不稳定（flaky）

`--repeat=3` 中有时通过、有时失败：
- 断言了中间状态（例如「同步中」），改为断言最终状态；
- 依赖了执行顺序或者上一个测试的数据（每个用例都应该自己准备数据）；
- 依赖了真实时间的边界值（改为用时间基准覆盖参数，或者 ± 1 分钟）；
- 列表顺序没有确定性（同分时的二级排序规则应该写进契约）。

不允许用重试掩盖不稳定（配置中 `retries: 0`）。
