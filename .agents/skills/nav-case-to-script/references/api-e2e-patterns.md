# API / E2E 脚本写法

所有示例都基于 `tests/fixtures/api.mjs`。字段名以 `docs/trace/api-contract.json` 为准，下面按 PROBLEM.md 的示例字段编写。

## 1. 一个 API 脚本的骨架

```js
import { test, expect, samplePayload, shiftedTime } from '../fixtures/api.mjs';

test('TC-API-RANK-001 排序结果按 score 降序且带理由', async ({ api }) => {
  const { now } = await api.loadSample();               // 前置条件（setup，不参与变异）

  const r = await test.step('S1：GET /api/pages/ranked', () => api.get('/api/pages/ranked'));

  expect(r.status, '[E1] 返回 200').toBe(200);
  const scores = r.body.pages.map((p) => p.score);
  expect(scores, '[E2] 按 score 降序').toEqual([...scores].sort((a, b) => b - a));
  for (const p of r.body.pages) {
    expect(p.score, `[E3] ${p.url} 的 score 在 [0,1] 内`).toBeGreaterThanOrEqual(0);
    expect(p.score, `[E3] ${p.url} 的 score 在 [0,1] 内`).toBeLessThanOrEqual(1);
    expect(p.reason, `[E4] ${p.url} 带有理由`).toMatch(/\S/);
  }
});
```

- `api` 每次调用前会自动 reset，所以每个脚本都必须**自己准备数据**，不能依赖别的用例留下的状态。
- `test.step` 的回调可以直接返回 Promise，返回值就是 step 的结果。

## 2. 数据准备

| 需要的数据 | 写法 |
|---|---|
| 样例数据（resource.json，按 PRD D-01 平移到最新一条 = now − 5 分钟） | `const { now, payload } = await api.loadSample()` |
| 在样例基础上改一点 | `api.loadSample({ transform: (p) => ({ ...p, openTabs: [] }) })` |
| 完全自定义的数据 | `api.seed({ activeTab: null, openTabs: [], history: [historyItem(url, { daysAgo: 15, visitCount: 2, now })] })` |
| 期望的时间戳 | `shiftedTime('https://github.com/org/repo/issues/123', now)`，**不要手写数字** |
| 大数据量（性能） | `api.seed({ activeTab: null, openTabs: [], history: bulkHistory(10_000, { now }) })` |
| 被测的就是同步本身 | 用 `api.post('/api/sync', payload)`，不要用 seed（seed 不参与变异检查） |

时间边界（「恰好 14 天」）：服务端处理请求时会有几毫秒偏移，`now - 14 * DAY` 到了服务端可能已经是 14 天零 3 毫秒。所以：
1. 契约提供了时间基准覆盖参数（例如 `?now=`）时：`api.get('/api/pages/cleanup-suggestions', { params: { now } })`，数据也按同一个 `now` 构造；
2. 契约没有提供时：拆成 `14 天 - 1 分钟`（不归档）和 `14 天 + 1 分钟`（归档）两个断言，并在脚本注释中说明原因。

## 3. 反例（入参校验和错误格式）

```js
test('TC-API-SYNC-010 非法 JSON 返回 400 INVALID_JSON', async ({ api }) => {
  const r = await api.raw('POST', '/api/sync', '{bad json');      // 原样发送（夹具内部转成 Buffer）
  expect(r.status, '[E1] 返回 400').toBe(400);
  expect(r.body, '[E2] 统一错误格式').toMatchObject({ error: { code: 'INVALID_JSON' } });
  expect(r.body.error.message, '[E2] message 非空').toMatch(/\S/);
  const h = await api.get('/api/health');
  expect(h.body.pageCount, '[E3] 失败的请求没有写入任何数据').toBe(0);   // 反例也要断言「没有副作用」
});
```

- 错误格式统一断言 `{ error: { code, message } }` 中的 **code 具体值**，不要只断言 400。
- 反例要多断言一步「没有副作用」：数据没有被写入、规则数没变。
- 数据驱动的变体（同一用例的多组输入）：在同一个文件里用循环生成多个 test，标题都以同一个 Case ID 开头：

```js
for (const [label, body] of [['openTabs 不是数组', { openTabs: 'x' }], ['history 不是数组', { history: {} }]]) {
  test(`TC-API-SYNC-011 入参类型错误返回 400：${label}`, async ({ api }) => {
    const r = await api.post('/api/sync', body);
    expect(r.status, '[E1] 返回 400').toBe(400);
    expect(r.body.error.code, '[E1] 错误码为 VALIDATION_FAILED').toBe('VALIDATION_FAILED');
  });
}
```

## 4. 幂等、隐私兜底、性能

```js
// 幂等：同一份数据同步两次，页面数和 visitCount 都不变
const first = await api.post('/api/sync', payload);
const second = await api.post('/api/sync', payload);
expect(second.body.pageCount, '[E1] 第二次同步后页面数仍为 10').toBe(first.body.pageCount);
const issue = (await api.get('/api/pages/ranked')).body.pages.find((p) => p.url === ISSUE);
expect(issue.visitCount, '[E2] visitCount 没有被累加，仍为 8').toBe(8);

// 后端兜底隐私过滤：直接调接口提交含 token 的 URL
await api.post('/api/sync', { activeTab: null, openTabs: [{ url: 'https://a.example.com/reset?token=abc', title: 't' }], history: [] });
const urls = (await api.get('/api/pages/ranked')).body.pages.map((p) => p.url);
expect(urls, '[E1] 含 token 的 URL 没有入库').not.toContain('https://a.example.com/reset?token=abc');

// 性能：预热 1 次，再测 20 次，记录 p95
await api.seed({ activeTab: null, openTabs: [], history: bulkHistory(10_000, { now }) });
const body = { currentPage: { url: 'https://github.com/org/repo7/pull/1', title: 'PR' }, openTabs: [], recentHistory: [] };
await api.post('/api/recommendations/next', body);
const ms = [];
for (let i = 0; i < 20; i++) ms.push((await api.post('/api/recommendations/next', body)).ms);
const p95 = ms.sort((a, b) => a - b)[Math.ceil(ms.length * 0.95) - 1];
evidence.metric('recommendations.p95', p95, 'ms');                 // 进入质量报告
expect(p95, '[E1] 1 万条数据下推荐接口 p95 < 100ms').toBeLessThan(100);
```

性能用例需要 `evidence` 夹具：`async ({ api, evidence }) => …`。

## 5. E2E 编排：步骤、传参、状态传递

E2E 验证的是「上一步的结果确实影响了下一步」。写法规则：

1. **一步一个 test.step**，标题为 `Sn：动作`，和用例的 steps 一一对应；
2. **step 返回下一步需要的值**，用 `const x = await test.step(...)` 接住；不要用外层的 `let` 变量在 step 之间悄悄传值；
3. **后端生成的值从响应中取**：`const ruleId = saved.find((x) => x.type === 'never_archive').id`；
4. **每一步断言本步的结果**，后面的步骤再断言**状态已经传递过去**（保存之后列表里能看到；删除之后整理建议恢复；health.ruleCount 跟着变）；
5. **跨接口的一致性**用同一个值比较：例如 sync 返回的 `pageCount` 等于 health 中的 `pageCount`、等于 ranked 的长度。

典型链路（PROBLEM.md 验收第 5–9 步）：

```
loadSample (setup)
 └─ S1 ranked            → 断言 10 条、降序、reason 非空                 → 返回 topUrl
 └─ S2 recommendations   → 断言首条为 actions、排除已打开和重复页面
 └─ S3 rules/parse       → 断言 2 条规则的结构                           → 返回 parsed.rules
 └─ S4 POST /api/rules   → 用 S3 的结果作为请求体；断言 201 和 2 条         → 返回 saved.rules（带 id）
     └─ GET /api/rules   → 断言 id 集合与 S4 的响应一致
 └─ S5 cleanup           → 断言 keep docs.internal、issues/100 的理由提到 7 天
 └─ S6 DELETE /rules/:id → id 取自 S4；断言删除成功
     └─ cleanup          → 断言 keep 消失（状态回滚）
 └─ S7 health            → 断言 ruleCount = 1、pageCount = 10（跨接口一致）
```

完整代码见 `assets/templates/e2e.spec.mjs`。

参数构造的常见坑：
- 推荐接口的请求体直接复用 `payload.activeTab / openTabs / history`（样例数据中的同一份对象），不要重新手写一遍 URL；
- 保存规则时把 parse 的输出原样传给保存接口（这正是用户「确认保存」的真实流程），不要在测试里手工拼一条规则；
- 在一个 E2E 里改动数据后要立即断言，不要等到最后才集中断言（失败时定位不到是哪一步）。

## 6. 留痕

不需要手动写证据：`api` 每次调用都会写入 `evidence/<CaseID>/api/NN-<METHOD>-<path>.json`（请求头、请求体、状态码、响应体、耗时），并带上 `x-request-id: <CaseID>-NN`；后端日志按偏移量截取到 `evidence/<CaseID>/server.log`。排查失败时**先看证据，再看代码**。

**后端状态快照（数据修改前后的查询结果）**：`api` 夹具在 reset 之后、用例结束时各调用一次 `GET /api/__test__/state`（只读，BE-RUN-07），自动写出：

| 文件 | 内容 |
|---|---|
| `state-before.json` / `state-after.json` | dataVersion、计数、页面关键字段、规则、配置、持久化文件摘要 |
| `state-diff.json` | 页面按 normalizedUrl、规则按 id 对比的新增 / 删除 / 字段变化，计数变化，配置变化 |

`result.json` 中的 `stateDiffSummary` 是摘要，例如同步样例数据后 `pages.added=10`、`counts.pages=10`。这些调用不写进 `api/`，也不参与变异检查。后端没有这个接口（404）时会自动跳过，并在 notes 中记录。

- 断言数据变化时，仍然要通过产品接口（例如 `GET /api/pages/ranked`）来断言。状态快照只作为证据，**不要在脚本里断言 `__test__/state`**：它不是产品契约。
- 参数化变体（同一 Case 有多个 test）的状态文件会追加 `-t<n>` 后缀。
