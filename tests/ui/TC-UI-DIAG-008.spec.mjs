// 用例：TC-UI-DIAG-008（F-DIAG-02#AC2 边界）保存未授权的本机 HTTPS 地址显示授权警告，改回测试后端后地址与真实请求恢复
import { test, expect } from '../fixtures/extension.mjs';
import { DIAG_CHECK_IDS, checkState, renderedCheckCount, watchServiceWorkerApiRequests } from './diag-testkit.mjs';

// manifest 只授权 http://127.0.0.1/* 与 http://localhost/*：https 协议的本机地址未授权
const UNAUTHORIZED_BASE = 'https://127.0.0.1:4100';

test('TC-UI-DIAG-008 保存未授权的本机 HTTPS 地址显示授权警告，改回 4100 后地址与真实请求恢复', async ({ ext }) => {
  const target = ext.baseURL;
  let popup;
  let requests = [];

  await test.step('S1：打开 popup → 诊断页签，在输入框填入未授权的本机 HTTPS 地址并保存', async () => {
    popup = await ext.openPopup();
    await popup.getByTestId('tab-diag').click();
    await popup.getByTestId('diag-api-base-url-input').fill(UNAUTHORIZED_BASE);
    await popup.getByTestId('diag-api-base-url-save').click();
    await ext.snap(popup, 'S1-保存未授权地址');
  });

  await test.step('S2：读取保存提示、storage 与「API Base URL」检查项的排查步骤', async () => {
    await expect(popup.getByTestId('diag-api-base-url-saved'), '[E1] 保存提示可见').toBeVisible();
    await expect(popup.getByTestId('diag-api-base-url-saved'), '[E1] 提示包含「未授权」或「未授予」').toContainText(/未授权|未授予/);
    const stored = await ext.getStorage('apiBaseUrl');
    expect(stored.apiBaseUrl, '[E1] storage.apiBaseUrl 为未授权地址').toBe(UNAUTHORIZED_BASE);
    await popup.getByTestId('diag-rerun-button').click();
    await expect(popup.getByTestId('diag-check-api-base-url'), '[E2] 检查项为警告').toHaveAttribute('data-status', 'warn');
    const apiBase = await checkState(popup, 'diag-check-api-base-url');
    expect(apiBase.hintSteps.some((s) => s.includes('host_permissions')), '[E2] 排查步骤提到 host_permissions').toBe(true);
    expect(await renderedCheckCount(popup), '[E2] 登记的检查项共 11 个').toBe(DIAG_CHECK_IDS.length);
    await ext.snap(popup, 'S2-未授权警告');
  });

  await test.step('S3：注册只读请求监听，把地址改成测试后端并重新打开 popup 完成一轮检测', async () => {
    requests = watchServiceWorkerApiRequests(ext);
    await popup.getByTestId('diag-api-base-url-input').fill(target);
    await popup.getByTestId('diag-api-base-url-save').click();
    await expect(popup.getByTestId('diag-api-base-url-saved')).toBeVisible();
    popup = await ext.reopenPopup();
    await popup.getByTestId('tab-diag').click();
    await popup.getByTestId('diag-rerun-button').click();
    await expect(popup.getByTestId('diag-check-backend'), '[E4] 后端连接恢复').toHaveAttribute('data-status', 'ok');
    await expect(popup.getByTestId('diag-checked-at')).toBeVisible();
    await ext.snap(popup, 'S3-改回测试后端');
  });

  await test.step('S4：核对当前地址、输入框、storage 与扩展 SW 真实请求的 origin', async () => {
    await expect(popup.getByTestId('diag-api-base-url-current'), '[E3] 当前地址为测试后端').toHaveText(target);
    await expect(popup.getByTestId('diag-api-base-url-input'), '[E3] 输入框为测试后端').toHaveValue(target);
    const stored = await ext.getStorage('apiBaseUrl');
    expect(stored.apiBaseUrl, '[E3] storage.apiBaseUrl 为测试后端').toBe(target);
    await expect(popup.getByTestId('diag-check-api-base-url'), '[E3] 检查项恢复为通过').toHaveAttribute('data-status', 'ok');

    const backend = await checkState(popup, 'diag-check-backend');
    expect(backend.status, '[E4] diag-check-backend data-status="ok"').toBe('ok');
    const health = requests.filter((r) => r.method === 'GET' && r.path === '/api/health');
    const config = requests.filter((r) => r.method === 'GET' && r.path === '/api/config');
    expect(health.length, '[E4] 观察到真实 GET /api/health').toBeGreaterThanOrEqual(1);
    expect(config.length, '[E4] 观察到真实 GET /api/config').toBeGreaterThanOrEqual(1);
    expect([...new Set(requests.map((r) => r.origin))], '[E4] 新请求的 origin 全部为测试后端').toEqual([target]);
  });
});
