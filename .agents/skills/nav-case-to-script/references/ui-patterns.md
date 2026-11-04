# 插件 UI 脚本写法

基于 `tests/fixtures/extension.mjs`。每个测试都有一个独立的 persistent context（已加载 `extension/`），后端会自动 reset，API 地址也已经指向本次的测试后端。

## 1. 骨架

```js
import { test, expect } from '../fixtures/extension.mjs';

test('TC-UI-RANK-001 同步后展示排序结果，分数和理由可见', async ({ ext, api }) => {
  await api.loadSample();                                   // 旧页面、visitCount 只能通过后端导入构造
  const popup = await ext.openPopup();
  await test.step('S1：查看历史排序区块', async () => {
    const items = popup.getByTestId('ranked-item');
    await expect(items, '[E1] 展示 10 条排序结果').toHaveCount(10);
    await expect(items.first().getByTestId('ranked-item-score'), '[E2] 首条显示分数').toHaveText(/^\d\.\d{2}$/);
    await expect(items.first().getByTestId('ranked-item-reason'), '[E3] 首条显示理由').toContainText('打开');
    await ext.snap(popup, '排序结果');
  });
});
```

## 2. 构造浏览器状态

| 需要的状态 | 写法 | 说明 |
|---|---|---|
| 打开若干页面（有标题、有真实历史） | `await ext.mockSites({ [url]: '标题' }); await ext.openTabs([url1, url2])` | 外部站点被夹具离线化，不访问外网 |
| 只要历史，不要打开 | `await ext.seedHistory([url])` | 访问时间是当前时间；**无法设置 visitCount 和更早的时间** |
| 旧页面、高访问次数 | `await api.loadSample()` 或 `api.seed(...)` | 通过真实的 /api/sync 导入后端 |
| 当前页面 | 最后一个打开的 http(s) tab | popup 以 tab 方式打开时，插件必须排除自身页面（前端方案中给出算法） |
| 后端不可达 | `await ext.useUnreachableBackend()` | API 地址指向一个没有服务的端口，属于真实的连接失败；**禁止 route 后端** |
| 修改配置 | `await ext.setStorage({ apiBaseUrl: '…' })` / 在 popup 中操作配置输入框 | key 以 ui-contract.storageKeys 为准 |
| 首次安装（storage 为空） | 在文件顶部写 `test.use({ presetApiBase: false })` | 夹具默认会预写 apiBaseUrl 指向测试后端，这条路径就测不到了。关闭后插件使用自己的默认地址，用例需要通过诊断页 UI 修改地址，或者断言「后端未连接」的引导文案 |
| 隐私 URL | `await ext.openTabs(['https://accounts.example.com/reset?token=abc'])` | 同步后用 `api.get('/api/pages/ranked')` 核对**后端没有收到** |

系统页面降级：Playwright 自带的 Chromium 允许打开 `chrome://version/`。先 `const p = await ext.context.newPage(); await p.goto('chrome://version/')`，再打开 popup，断言当前页面区块显示「系统页面，不可同步」之类的降级文案（具体以 PRD 为准）。

## 3. 等待和断言

- **只用自动重试的断言**：`toHaveText`、`toContainText`、`toHaveCount`、`toBeVisible`、`toBeHidden`、`toHaveAttribute`、`toBeEnabled` / `toBeDisabled`。它们会一直重试到超时，不需要也**不允许** `waitForTimeout`。
- 等待异步完成：断言最终状态，例如 `await expect(popup.getByTestId('sync-status')).toContainText('同步成功')`，不要去断言中间的「同步中」。
- 列表：`toHaveCount(n)` 断言数量，`items.nth(i)` 取第 i 项，再在项内用 `getByTestId` 取子元素（列表项内部的 testId 需要在 ui-contract 中登记）。
- 等后端状态：`await expect.poll(async () => (await api.get('/api/health')).body.ruleCount, { message: '[E4] 规则已保存到后端' }).toBe(2)`。
- 状态恢复：`const p2 = await ext.reopenPopup()`，断言重新打开后仍然显示上次的同步结果（验证状态存在 storage 里，而不是 popup 的内存里）。
- 同时核对存储：`expect((await ext.getStorage('lastSync')).lastSync.ok, '[E3] 同步结果写入 storage').toBe(true)`（key 以契约为准）。

## 4. 截图与证据

- 每个关键步骤调用 `await ext.snap(page, '步骤名')`，截图写入 `evidence/<CaseID>/screenshots/NN-步骤名.png`；测试结束时夹具会自动再截一张 `final`，并把所有截图合成 `flow.gif`。
- 截图会按内容 hash 去重：与本用例上一张完全相同的截图不再保存，`result.json` 中的 `dedupedShots` 记录跳过的张数。所以请在**状态发生变化之后**截图，例如断言通过以后，不要在点击之前、之后连续截两张相同的画面。
- UI 用例同样会生成 `state-before/after/diff.json`，用来证明界面操作确实改变了后端数据，例如点击同步后 `pages.added`。
- 以标签页打开 popup 测不出只在真实弹窗里出现的问题，例如尺寸塌缩。这类问题由真实安装冒烟（`scripts/smoke-install.mjs`）负责，见 `real-popup-smoke.md`。
- service worker 和 popup 的 console 输出会写入 `evidence/<CaseID>/extension.log`；同时间段的后端日志写入 `server.log`。

## 5. 常见失败与原因

| 现象 | 原因 | 处理 |
|---|---|---|
| `strict mode violation: getByTestId(...) resolved to N elements` | testId 在页面上不唯一（列表项） | 先定位到列表项，再在项内取子元素 |
| 当前页面显示的是 `chrome-extension://…/popup.html` | 插件没有排除自身页面 | 产品缺陷（前端方案要求必须排除） |
| 历史区块为空 | `chrome.history.search` 没有传 `startTime`（默认只查 24 小时）或者测试没有造历史 | 先看 `extension.log` 和截图 |
| 同步失败 `BACKEND_UNREACHABLE` | apiBaseUrl 没有指向测试端口，或者后端没有 CORS / host_permissions | 看 `extension.log` 和 `server.log` 中是否收到了请求 |
| 偶发失败 | 断言了中间状态，或者用了固定等待 | 改为断言最终状态；用 `--repeat=3` 验证稳定性 |
