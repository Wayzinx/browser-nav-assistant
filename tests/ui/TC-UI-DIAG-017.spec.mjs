// 用例：TC-UI-DIAG-017（F-DIAG-06#AC3）最近一次同步失败时显示失败与失败原因，并建议先处理「后端服务连接」
import { test, expect } from '../fixtures/extension.mjs';
import { DIAG_CHECK_IDS, enterDiagTab, checkState, renderedCheckCount, watchServiceWorkerApiRequests } from './diag-testkit.mjs';

test('TC-UI-DIAG-017 最近一次同步失败时显示失败与失败原因，并建议先处理「后端服务连接」', async ({ ext, api }) => {
  let popup;
  let requests = [];

  await test.step('S1：真实导入样例，写入非网络失败的 syncState 与 connection', async () => {
    const { res } = await api.loadSample();
    expect(res.status, '样例导入 HTTP 200').toBe(200);
    const T = Date.now();
    await ext.setStorage({
      apiBaseUrl: ext.baseURL,
      syncState: {
        status: 'error', startedAt: T, lastSyncAt: T, lastSuccessAt: T - 5 * 60_000,
        lastError: { code: 'VALIDATION_FAILED', message: 'openTabs 必须为数组' },
        cursor: null, cursorBase: null, fullReason: null, mode: 'full', trigger: 'user',
        stats: { uploaded: 0, filtered: 0, received: 0, created: 0, updated: 0, rejected: 0 },
      },
      connection: { status: 'online', since: T, lastCheckedAt: T, lastErrorCode: null, recoverPending: false },
    });
  });

  await test.step('S2：注册只读请求监听，打开 popup → 诊断页签，完成检测', async () => {
    requests = watchServiceWorkerApiRequests(ext);
    popup = await ext.openPopup();
    await enterDiagTab(popup);
    await ext.snap(popup, 'S2-同步失败诊断');
  });

  await test.step('S3：读取 diag-check-last-sync 的状态、详情、排查步骤并读回 syncState', async () => {
    const lastSync = await checkState(popup, 'diag-check-last-sync');
    expect(lastSync.status, '[E1] data-status="fail"').toBe('fail');
    expect(lastSync.statusText, '[E1] 状态文本为「失败」').toBe('失败');
    expect(lastSync.detail, '[E2] 详情包含固定失败原因').toContain('openTabs 必须为数组');
    expect(lastSync.hintSteps.join(' '), '[E3] 排查步骤提到「后端服务连接」').toContain('后端服务连接');

    expect(await renderedCheckCount(popup), '[E4] 11 项登记检查项均渲染').toBe(DIAG_CHECK_IDS.length);
    await expect(popup.getByTestId('diag-check-backend'), '[E4] 后端连接通过').toHaveAttribute('data-status', 'ok');
    const stored = (await ext.getStorage('syncState')).syncState;
    expect(stored.status, '[E4] syncState 仍为 error').toBe('error');
    expect(stored.lastError.code, '[E4] 错误码仍为 VALIDATION_FAILED').toBe('VALIDATION_FAILED');
    const syncPosts = requests.filter((r) => r.method === 'POST' && r.path === '/api/sync');
    expect(syncPosts.length, '[E4] 打开 popup 后没有自动 POST /api/sync 覆盖失败记录').toBe(0);
  });
});
