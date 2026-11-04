// 用例：TC-UI-DIAG-024（F-DIAG-08#AC3）health.version 主版本为 2 时「版本兼容」失败，并提示升级插件或后端
import { test, expect } from '../fixtures/extension.mjs';
import { startFaultService } from './diag-fault-service.mjs';
import { DIAG_CHECK_IDS, enterDiagTab, checkState, renderedCheckCount } from './diag-testkit.mjs';

let fault;
test.afterEach(async () => {
  if (fault) await fault.stop();
  fault = null;
});

test('TC-UI-DIAG-024 health.version 主版本为 2 时「版本兼容」失败，并提示升级插件或后端', async ({ ext, api }) => {
  let popup;

  await test.step('S1：启动临时真实 HTTP 服务（health.version=2.3.1）并记录地址', async () => {
    fault = await startFaultService({ version: '2.3.1' });
    await expect.poll(async () => (await api.get(`${fault.baseURL}/api/health`)).body.version, { message: '依赖故障服务就绪', timeout: 10_000 }).toBe('2.3.1');
  });

  await test.step('S2：在 service worker 中把 apiBaseUrl 写成临时服务地址', async () => {
    await ext.swEval(() => chrome.storage.local.remove('syncState'));
    const now = Date.now();
    await ext.setStorage({
      apiBaseUrl: fault.baseURL,
      connection: { status: 'unknown', since: now, lastCheckedAt: now, lastErrorCode: null, recoverPending: false },
    });
    const stored = await ext.getStorage('apiBaseUrl');
    expect(stored.apiBaseUrl, 'apiBaseUrl 已指向依赖故障服务').toBe(fault.baseURL);
  });

  await test.step('S3：打开 popup → 诊断页签，等待 diag-loading 消失', async () => {
    popup = await ext.openPopup();
    await enterDiagTab(popup);
    await ext.snap(popup, 'S3-版本不兼容诊断');
  });

  await test.step('S4：读取「版本兼容」的状态、详情与排查步骤，并读取后端检查与检查项数量', async () => {
    const version = await checkState(popup, 'diag-check-version');
    expect(version.status, '[E1] diag-check-version data-status="fail"').toBe('fail');
    expect(version.detail, '[E2] 详情包含实际版本 2.3.1').toContain('2.3.1');
    expect(version.detail, '[E2] 详情包含期望主版本 1').toMatch(/期望[^0-9]{0,4}1|1[^0-9]{0,4}期望/);
    expect(version.hintSteps.some((s) => s.includes('升级插件') || s.includes('升级后端')), '[E3] 排查步骤提到升级插件或升级后端').toBe(true);
    await expect(popup.getByTestId('diag-check-backend'), '[E4] 依赖服务可连通：后端检查通过').toHaveAttribute('data-status', 'ok');
    expect(await renderedCheckCount(popup), '[E4] 登记的 11 个检查项全部渲染').toBe(DIAG_CHECK_IDS.length);
    await ext.snap(popup, 'S4-版本兼容失败');
  });
});
