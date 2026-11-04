// 用例：TC-UI-DIAG-001（F-DIAG-01#AC1）后端可用时打开诊断页签：「后端服务连接」通过并显示 version 与本次耗时
import { test, expect } from '../fixtures/extension.mjs';
import { DIAG_CHECK_IDS, enterDiagTab, checkState, renderedCheckCount, summaryCounts } from './diag-testkit.mjs';

test('TC-UI-DIAG-001 后端可用时打开诊断页签：「后端服务连接」通过并显示 version=1.0.0 与本次耗时（毫秒）', async ({ ext }) => {
  let popup;

  await test.step('S1：以 tab 方式打开 popup，等待顶栏 connection-status 出现', async () => {
    popup = await ext.openPopup();
    await expect(popup.getByTestId('connection-status'), '[E1] 顶栏 data-state=online').toHaveAttribute('data-state', 'online');
    await expect(popup.getByTestId('connection-status'), '[E1] 顶栏文本「后端已连接」').toHaveText('后端已连接');
    await ext.snap(popup, 'S1-顶栏后端已连接');
  });

  await test.step('S2：点击 tab-diag 进入诊断页签，等待 diag-loading 消失、diag-checked-at 出现', async () => {
    await enterDiagTab(popup);
    await expect(popup.getByTestId('panel-diag'), '[E2] 诊断面板可见').toBeVisible();
    await expect(popup.getByTestId('diag-loading'), '[E2] diag-loading 不可见').toBeHidden();
    const ts = Number(await popup.getByTestId('diag-checked-at').getAttribute('data-ts'));
    expect(Number.isInteger(ts) && Math.abs(Date.now() - ts) < 60_000, `[E2] data-ts=${ts} 是毫秒时间戳且与当前时间相差 < 60s`).toBe(true);
    await ext.snap(popup, 'S2-诊断页签');
  });

  await test.step('S3：读取 diag-check-backend 的状态与子元素，并读取 diag-summary', async () => {
    const backend = await checkState(popup, 'diag-check-backend');
    expect(backend.status, '[E3] diag-check-backend data-status="ok"').toBe('ok');
    expect(backend.name, '[E3] 检查项名称为「后端服务连接」').toBe('后端服务连接');

    const valueAndDetail = `${backend.value} ${backend.detail}`;
    expect(backend.value, '[E4] 显示后端 version').toContain('1.0.0');
    expect(valueAndDetail, '[E4] 耗时明确以 ms 或「毫秒」标识').toMatch(/ms|毫秒/i);
    const latency = Number((/(\d+(?:\.\d+)?)\s*(?:ms|毫秒)/i.exec(valueAndDetail) || [])[1]);
    expect(Number.isFinite(latency) && latency >= 0, `[E4] 耗时 ${latency} 可解析为非负有限数`).toBe(true);

    const stored = (await ext.getStorage('lastDiagnostics')).lastDiagnostics;
    const summaryText = await popup.getByTestId('diag-summary').textContent();
    expect(summaryCounts(summaryText), '[E5] diag-summary 的通过/警告/失败计数与 storage.lastDiagnostics.summary 一致')
      .toEqual({ ok: stored.summary.ok, warn: stored.summary.warn, fail: stored.summary.fail });
    expect(await renderedCheckCount(popup), '11 项登记的检查项全部渲染').toBe(DIAG_CHECK_IDS.length);
    await ext.snap(popup, 'S3-后端服务连接通过');
  });
});
