// 用例：TC-UI-DIAG-022（F-DIAG-08#AC1）默认配置下附加三项：activeTab 通过、隐私过滤通过、无痕模式为提示
import { test, expect } from '../fixtures/extension.mjs';
import { DIAG_CHECK_IDS, enterDiagTab, checkState, renderedCheckCount } from './diag-testkit.mjs';

test('TC-UI-DIAG-022 默认配置下附加三项：activeTab 通过、隐私过滤通过、无痕模式为提示且说明无痕数据不被采集', async ({ ext }) => {
  let popup;

  await test.step('S1：打开 popup → 诊断页签，等待 diag-loading 消失', async () => {
    popup = await ext.openPopup();
    await enterDiagTab(popup);
    await ext.snap(popup, 'S1-默认配置诊断');
  });

  await test.step('S2：读取 activeTab / 隐私过滤 / 无痕模式三项的状态与文本', async () => {
    const activeTab = await checkState(popup, 'diag-check-active-tab');
    expect(activeTab.status, '[E1] diag-check-active-tab data-status="ok"').toBe('ok');
    expect(activeTab.statusText, '[E1] 状态文本为「通过」').toBe('通过');

    const privacy = await checkState(popup, 'diag-check-privacy');
    expect(privacy.status, '[E2] diag-check-privacy data-status="ok"').toBe('ok');
    expect(privacy.statusText, '[E2] 状态文本为「通过」').toBe('通过');
    expect(privacy.detail, '[E2] 详情包含关键词数 4').toContain('4');

    const incognito = await checkState(popup, 'diag-check-incognito');
    expect(incognito.status, '[E3] diag-check-incognito data-status="info"').toBe('info');
    expect(incognito.statusText, '[E3] 状态文本为「提示」').toBe('提示');
    expect(incognito.detail, '[E3] 说明无痕窗口的数据不会被采集').toContain('无痕窗口的数据不会被采集');

    expect(await renderedCheckCount(popup), '[E4] 三项在同一页面渲染，登记检查项共 11 个').toBe(DIAG_CHECK_IDS.length);
    await ext.snap(popup, 'S2-附加检查三项');
  });
});
