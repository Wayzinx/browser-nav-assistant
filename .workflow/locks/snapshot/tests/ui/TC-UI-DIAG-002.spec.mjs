// 用例：TC-UI-DIAG-002（F-DIAG-01#AC2）后端不可达时「后端服务连接」失败，给出「连接被拒绝」与 4 条排查步骤
import { test, expect } from '../fixtures/extension.mjs';
import { DIAG_CHECK_IDS, enterDiagTab, checkState, renderedCheckCount, summaryCounts } from './diag-testkit.mjs';

test('TC-UI-DIAG-002 后端不可达时「后端服务连接」失败，显示「连接被拒绝」并给出 4 条排查步骤（第 1 条含 ./scripts/start.sh）', async ({ ext }) => {
  let popup;

  await test.step('S1：调用 useUnreachableBackend()，把 apiBaseUrl 写成没有服务的端口', async () => {
    await ext.useUnreachableBackend();
  });

  await test.step('S2：打开 popup 并点击 tab-diag 进入诊断页签，等待 diag-loading 消失', async () => {
    popup = await ext.openPopup();
    await enterDiagTab(popup);
    await ext.snap(popup, 'S2-后端不可达诊断');
  });

  await test.step('S3：读取后端项状态、详情、全部排查步骤与登记检查项数量', async () => {
    const backend = await checkState(popup, 'diag-check-backend');
    expect(backend.status, '[E1] diag-check-backend data-status="fail"').toBe('fail');
    expect(backend.detail, '[E2] 详情包含错误类型「连接被拒绝」').toContain('连接被拒绝');

    expect(backend.hintSteps.length, '[E3] diag-item-hint 内共 4 条排查步骤').toBe(4);
    expect(backend.hintSteps[0], '[E3] 第 1 条包含 ./scripts/start.sh').toContain('./scripts/start.sh');
    expect(backend.hintSteps[1], '[E4] 第 2 条包含 API Base URL').toContain('API Base URL');
    expect(backend.hintSteps[2], '[E4] 第 3 条包含 host_permissions').toContain('host_permissions');
    expect(backend.hintSteps[3], '[E4] 第 4 条包含 /api/health').toContain('/api/health');

    expect(await renderedCheckCount(popup), '[E5] 诊断未被中断：11 项登记检查项全部渲染').toBe(DIAG_CHECK_IDS.length);
    const summaryText = await popup.getByTestId('diag-summary').textContent();
    expect(summaryCounts(summaryText).fail, '[E5] diag-summary 的失败计数 ≥ 1').toBeGreaterThanOrEqual(1);
    await ext.snap(popup, 'S3-后端不可达失败项');
  });
});
