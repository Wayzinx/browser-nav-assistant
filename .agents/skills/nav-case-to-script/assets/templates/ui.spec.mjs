// 模板：插件 UI 用例（文件名 tests/ui/<CaseID>.spec.mjs）
// 用例：TC-UI-SYNC-001（示例）打开测试页 → 打开 popup → 点击同步 → 显示同步成功 → 后端已入库
// 写法要点（详见 references/ui-patterns.md）：
//   - 元素只用 getByTestId(…)，参数必须是 ui-contract 中登记的 testId；断言用会自动重试的 expect(locator).toHaveText / toContainText / toHaveCount
//   - 外部站点由夹具默认离线化，需要指定标题时用 ext.mockSites；后端数据用 api 构造和核对（真实 HTTP，不 route 后端）
//   - 关键步骤调用 ext.snap 截图（写入 evidence/<CaseID>/screenshots/，并合成 flow.gif）
import { test, expect } from '../fixtures/extension.mjs';

const PR = 'https://github.com/org/repo/pull/456';
const MDN = 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API';

test('TC-UI-SYNC-001 点击同步后显示同步成功，打开的页面已入库', async ({ ext, api }) => {
  await test.step('S1：打开两个测试页面', async () => {
    await ext.mockSites({ [PR]: 'Refactor auth middleware (#456)', [MDN]: 'Fetch API - Web APIs | MDN' });
    await ext.openTabs([PR, MDN]);
  });

  const popup = await test.step('S2：打开 popup，查看当前页面', async () => {
    const page = await ext.openPopup();
    await expect(page.getByTestId('current-page-url'), '[E1] 当前页面是最后访问的 http(s) 页面，不是 popup 自身').toHaveText(MDN);
    await expect(page.getByTestId('current-page-title'), '[E1] 显示当前页面标题').toHaveText('Fetch API - Web APIs | MDN');
    await ext.snap(page, '打开popup');
    return page;
  });

  await test.step('S3：点击「同步浏览器上下文」', async () => {
    await popup.getByTestId('sync-button').click();
    await expect(popup.getByTestId('sync-status'), '[E2] 显示同步成功').toContainText('同步成功');
    await ext.snap(popup, '同步成功');
  });

  await test.step('S4：通过后端接口核对入库结果', async () => {
    const r = await api.get('/api/pages/ranked');
    expect(r.body.pages.map((p) => p.url), '[E3] 两个打开的页面都已入库').toEqual(expect.arrayContaining([PR, MDN]));
  });
});
