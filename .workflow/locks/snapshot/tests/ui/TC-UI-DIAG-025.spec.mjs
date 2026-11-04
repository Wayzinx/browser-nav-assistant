// 用例：TC-UI-DIAG-025（F-DIAG-11 质量约束）失败项不只显示错误码：每个失败项都有原因说明与至少 1 条可直接执行的排查步骤
import { test, expect } from '../fixtures/extension.mjs';
import { DIAG_CHECK_IDS, enterDiagTab, checkState } from './diag-testkit.mjs';

// 「可直接执行」的判定：命令 / 路径 / 配置键
const EXECUTABLE_HINTS = ['./scripts/start.sh', '/api/health', 'host_permissions', 'API Base URL'];

test('TC-UI-DIAG-025 失败项不只显示错误码：每个失败项都有原因说明与至少 1 条可直接执行的排查步骤', async ({ ext }) => {
  let popup;
  let failed = [];

  await test.step('S1：useUnreachableBackend() 后打开 popup → 诊断页签，等待 diag-loading 消失', async () => {
    await ext.useUnreachableBackend();
    popup = await ext.openPopup();
    await enterDiagTab(popup);
    await ext.snap(popup, 'S1-失败场景诊断');
  });

  await test.step('S2：枚举 11 个登记检查项，筛出 data-status="fail" 的项并读取详情与排查步骤', async () => {
    const states = [];
    for (const id of DIAG_CHECK_IDS) states.push({ id, ...(await checkState(popup, id)) });
    failed = states.filter((state) => state.status === 'fail');
    expect(failed.length, '[E1] 至少筛出 1 个失败项').toBeGreaterThanOrEqual(1);
    const backend = failed.find((state) => state.id === 'diag-check-backend') || { detail: '' };
    expect(backend.detail, '[E1] 本场景「后端服务连接」失败，详情包含「连接被拒绝」').toContain('连接被拒绝');
  });

  await test.step('S3：检查每个失败项的排查步骤是否可直接执行', async () => {
    expect(Math.min(...failed.map((state) => state.hintSteps.length)), '[E2] 每个失败项的排查步骤数量 ≥ 1').toBeGreaterThanOrEqual(1);
    const executable = failed.map((state) => state.hintSteps.some((step) => EXECUTABLE_HINTS.some((fragment) => step.includes(fragment))));
    expect(executable, '[E3] 每个失败项都有一条 hint 命中命令 / 路径 / 配置键').toEqual(failed.map(() => true));
    expect(failed.filter((state) => /^[A-Z_]+$/.test(state.detail.trim())).length, '[E4] 失败项详情不是裸错误码').toBe(0);
    await ext.snap(popup, 'S3-失败项排查步骤');
  });
});
