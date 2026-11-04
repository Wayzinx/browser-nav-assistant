// 用例：TC-UI-DIAG-005（F-DIAG-02#AC2）保存地址后重新打开：地址持久化，真实后端请求全部使用新地址
import { test, expect } from '../fixtures/extension.mjs';
import { checkState, watchServiceWorkerApiRequests } from './diag-testkit.mjs';

test('TC-UI-DIAG-005 把地址保存为 http://127.0.0.1:4100 后重新打开：地址持久化，真实后端请求全部使用新地址', async ({ ext }) => {
  const target = ext.baseURL;
  let popup;
  let requests = [];

  await test.step('S1：把 apiBaseUrl 写成没有服务的端口，打开 popup → 诊断页签，记录后端连接失败', async () => {
    await ext.useUnreachableBackend();
    popup = await ext.openPopup();
    await popup.getByTestId('tab-diag').click();
    await expect(popup.getByTestId('diag-check-backend'), '[E1] 旧地址下「后端服务连接」失败').toHaveAttribute('data-status', 'fail');
    await ext.snap(popup, 'S1-旧地址后端失败');
  });

  await test.step('S2：注册只读请求监听，在输入框填入测试后端地址并保存', async () => {
    requests = watchServiceWorkerApiRequests(ext);
    await popup.getByTestId('diag-api-base-url-input').fill(target);
    await popup.getByTestId('diag-api-base-url-save').click();
    await expect(popup.getByTestId('diag-api-base-url-saved'), '[E2] 保存成功提示可见').toBeVisible();
    await expect(popup.getByTestId('diag-api-base-url-error'), '[E2] 校验错误不可见').toBeHidden();
    await ext.snap(popup, 'S2-保存新地址');
  });

  await test.step('S3：重新打开 popup → 诊断页签 → 重新检测', async () => {
    popup = await ext.reopenPopup();
    await popup.getByTestId('tab-diag').click();
    await popup.getByTestId('diag-rerun-button').click();
    await expect(popup.getByTestId('diag-check-backend'), '[E4] 新地址下「后端服务连接」通过').toHaveAttribute('data-status', 'ok');
    await expect(popup.getByTestId('diag-checked-at')).toBeVisible();
    await ext.snap(popup, 'S3-新地址重检');
  });

  await test.step('S4：核对地址持久化与扩展 SW 真实请求的 origin', async () => {
    await expect(popup.getByTestId('diag-api-base-url-current'), '[E3] 当前地址为新地址').toHaveText(target);
    await expect(popup.getByTestId('diag-api-base-url-input'), '[E3] 输入框为新地址').toHaveValue(target);
    const stored = await ext.getStorage('apiBaseUrl');
    expect(stored.apiBaseUrl, '[E3] storage.apiBaseUrl 为新地址').toBe(target);

    const backend = await checkState(popup, 'diag-check-backend');
    expect(backend.status, '[E4] diag-check-backend data-status="ok"').toBe('ok');
    expect(backend.value, '[E4] version 显示 1.0.0').toContain('1.0.0');
    await expect(popup.getByTestId('connection-status'), '[E4] 顶栏 data-state="online"').toHaveAttribute('data-state', 'online');

    const health = requests.filter((r) => r.method === 'GET' && r.path === '/api/health');
    const config = requests.filter((r) => r.method === 'GET' && r.path === '/api/config');
    expect(health.length, '[E5] 观察到真实 GET /api/health').toBeGreaterThanOrEqual(1);
    expect(config.length, '[E5] 观察到真实 GET /api/config').toBeGreaterThanOrEqual(1);
    expect([...new Set(requests.map((r) => r.origin))], '[E5] 保存后的全部 /api/ 请求 origin 都等于新地址').toEqual([target]);
    await ext.snap(popup, 'S4-请求 origin 核对');
  });
});
