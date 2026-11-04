// 用例：TC-UI-DIAG-027（F-DIAG-11 边界）同步样例后「复制诊断报告」：真实剪贴板与 diag-report-output 一致，含检查结果/版本/配置且不含浏览 URL
import { test, expect, readResource } from '../fixtures/extension.mjs';
import { enterDiagTab, checkState } from './diag-testkit.mjs';

// 隐私探针：先让它真的出现在诊断 detail 里，再断言报告把它清掉
const PROBE_URL = 'https://github.com/org/repo/issues/123';

/** 递归收集字符串；跳过 apiBaseUrl 字段（报告允许保留后端地址） */
const collectStrings = (node, key) =>
  typeof node === 'string' ? (key === 'apiBaseUrl' ? [] : [node])
    : Array.isArray(node) ? node.flatMap((item) => collectStrings(item, key))
      : node && typeof node === 'object' ? Object.entries(node).flatMap(([k, v]) => collectStrings(v, k))
        : [];

test('TC-UI-DIAG-027 同步样例后「复制诊断报告」：真实剪贴板与 diag-report-output 一致，含检查结果/版本/配置且不含浏览 URL', async ({ ext, api }) => {
  let popup;
  let sync;

  await test.step('S1：真实导入平移样例并授予剪贴板权限', async () => {
    const sample = await api.loadSample();
    sync = sample.res;
    expect(sync.status, '样例导入 HTTP 200').toBe(200);
    expect(sync.body.pageCount, '样例导入 pageCount=10').toBe(10);
    // Chromium 的 Browser.grantPermissions 把 chrome-extension:// 视为 opaque origin 而拒绝；
    // 本条 persistent context 只加载本扩展，退回到不带 origin 的整 context 授权，效果等同于只授予扩展 origin。
    try {
      await ext.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `chrome-extension://${ext.extensionId}` });
    } catch (error) { // lint-allow-catch: Chromium 拒绝向 chrome-extension:// opaque origin 授权，仅此错误回退为整 context 授权，其他错误原样抛出
      if (!/opaque origins/.test(String(error && error.message))) throw error;
      await ext.context.grantPermissions(['clipboard-read', 'clipboard-write']);
    }
  });

  await test.step('S2：写入带隐私探针 URL 的失败 syncState、apiBaseUrl 与 connection', async () => {
    const T = Date.now();
    await ext.setStorage({
      apiBaseUrl: ext.baseURL,
      syncState: {
        status: 'error', startedAt: T, lastSyncAt: T, lastSuccessAt: T - 5 * 60_000,
        lastError: { code: 'VALIDATION_FAILED', message: `诊断隐私探针：${PROBE_URL}` },
        cursor: null, cursorBase: null, fullReason: null, mode: 'full', trigger: 'user',
        stats: { uploaded: 14, filtered: 0, received: sync.body.received, created: sync.body.created, updated: sync.body.updated, rejected: sync.body.rejected },
      },
      connection: { status: 'online', since: T, lastCheckedAt: T, lastErrorCode: null, recoverPending: false },
    });
  });

  await test.step('S3：打开 popup → 诊断页签，确认探针在 detail 中，然后点击 diag-copy-report-button', async () => {
    popup = await ext.openPopup();
    await enterDiagTab(popup);
    const lastSync = await checkState(popup, 'diag-check-last-sync');
    expect(lastSync.status, '[E1] 复制前「最近一次同步」失败').toBe('fail');
    expect(lastSync.detail, '[E1] 复制前 detail 确实包含完整探针 URL').toContain(PROBE_URL);
    await popup.getByTestId('diag-copy-report-button').click();
    await expect(popup.getByTestId('diag-report-output'), '报告输出可见').toBeVisible();
    await ext.snap(popup, 'S3-复制诊断报告');
  });

  await test.step('S4：读取真实剪贴板与页面输出，逐字段核对报告内容与 URL 清除', async () => {
    const reportText = ((await popup.getByTestId('diag-report-output').textContent()) || '').trim();
    const clipboardText = String(await popup.evaluate(() => navigator.clipboard.readText())).trim();
    const report = JSON.parse(reportText);
    const clipboard = JSON.parse(clipboardText);

    expect(typeof report.generatedAt, '[E2] 页面输出可 JSON.parse 且有 generatedAt').toBe('number');
    expect(typeof clipboard.extensionVersion, '[E2] 剪贴板内容可 JSON.parse').toBe('string');
    expect(clipboardText, '[E2] 真实剪贴板与页面输出逐字一致').toBe(reportText);

    expect(report.extensionVersion, '[E3] extensionVersion="1.0.0"').toBe('1.0.0');
    expect(report.apiBaseUrl, '[E3] apiBaseUrl 等于实际后端地址').toBe(ext.baseURL);
    expect(report.checks.length, '[E3] 报告含 11 项检查结果').toBe(11);
    expect(report.checks.filter((check) => typeof check.id === 'string' && typeof check.status === 'string' && typeof check.detail === 'string').length, '[E3] 每项都有 id / status / detail').toBe(11);
    expect(report.config.cleanupThresholdDays, '[E3] config.cleanupThresholdDays=14').toBe(14);

    const sampleUrls = readResource().history.map((item) => item.url);
    expect(reportText.includes(PROBE_URL), '[E4] 报告全文不含隐私探针 URL').toBe(false);
    expect(reportText.includes('github.com/org/repo'), '[E4] 报告不含 github.com/org/repo').toBe(false);
    expect(sampleUrls.filter((url) => reportText.includes(url)).length, '[E4] 报告不含 resource.json 任何页面 URL').toBe(0);
    expect(collectStrings(report, '').filter((text) => /https?:\/\//.test(text)), '[E4] 除 apiBaseUrl 外不存在 http(s) URL').toEqual([]);
  });
});
