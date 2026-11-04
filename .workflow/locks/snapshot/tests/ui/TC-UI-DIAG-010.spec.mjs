// 用例：TC-UI-DIAG-010（F-DIAG-03#AC2）加载删掉 tabs 权限的扩展副本时「tabs 权限」失败，并给出两条排查建议
import { test as base, expect } from '../fixtures/extension.mjs';
import { DIAG_CHECK_IDS, enterDiagTab, checkState, renderedCheckCount } from './diag-testkit.mjs';
import { useExtensionWithoutPermission } from './diag-ext-variants.mjs';

// 前置（固化）：只在本用例的 context 中加载「删掉 tabs 权限」的扩展副本。
// 旧写法在模块顶层改 process.env.EXT_DIR：夹具在 worker 内只求值一次，
// 本用例不是 worker 中第一个文件时副本不会生效；是第一个文件时又会把缺权限副本泄漏给后续所有 UI 用例。
const EXTERNAL_SITES = new RegExp('^https?://(?!127\\.0\\.0\\.1[:/]|localhost[:/])[^/]+');
const stubHtml = (title) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body></body></html>`;

const test = base.extend({
  context: async ({ evidence, playwright }, use) => {
    const saved = process.env.EXT_DIR;
    const dir = useExtensionWithoutPermission('tabs');
    if (saved === undefined) delete process.env.EXT_DIR; else process.env.EXT_DIR = saved; // 不把副本泄漏给同 worker 的其他用例
    evidence.note(`本用例加载删掉 tabs 权限的扩展副本：${dir}`);
    const context = await playwright.chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      viewport: { width: 420, height: 760 },
      args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
    });
    await context.route(EXTERNAL_SITES, (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: stubHtml(new URL(r.request().url()).hostname) }));
    const watchWorker = (w) => w.on('console', (m) => evidence.extLog('service-worker', m));
    context.serviceWorkers().forEach(watchWorker);
    context.on('serviceworker', watchWorker);
    context.on('page', (p) => {
      p.on('console', (m) => evidence.extLog(p.url().startsWith('chrome-extension://') ? 'popup' : 'page', m));
      p.on('pageerror', (e) => evidence.extLog('pageerror', e));
    });
    await use(context);
    await context.close();
  },
});

test('TC-UI-DIAG-010 加载删掉 tabs 权限的扩展副本时「tabs 权限」失败，并给出两条排查建议', async ({ ext }) => {
  let popup;

  await test.step('S1：临时副本打开 popup → 诊断页签，等待 diag-loading 消失', async () => {
    const manifest = await ext.swEval(() => chrome.runtime.getManifest().permissions);
    expect(manifest, '前置：本用例加载的扩展副本 manifest 不含 tabs').not.toContain('tabs');
    expect(manifest, '前置：副本仍保留 history 权限').toContain('history');
    popup = await ext.openPopup();
    await enterDiagTab(popup);
    await ext.snap(popup, 'S1-缺失 tabs 权限的诊断');
  });

  await test.step('S2：读取 diag-check-tabs 的状态、详情与全部排查步骤', async () => {
    const tabs = await checkState(popup, 'diag-check-tabs');
    expect(tabs.status, '[E1] diag-check-tabs data-status="fail"').toBe('fail');
    expect(tabs.detail.length, '[E2] 详情非空，说明权限缺失的原因').toBeGreaterThan(0);
    expect(tabs.name, '[E2] 检查项名称为「tabs 权限」').toBe('tabs 权限');
    expect(tabs.hintSteps.length, '[E3] 至少 2 条排查建议').toBeGreaterThanOrEqual(2);
    expect(tabs.hintSteps.some((s) => s.includes('检查 manifest 的 permissions')), '[E3] 一条包含「检查 manifest 的 permissions」').toBe(true);
    expect(tabs.hintSteps.some((s) => s.includes('在 chrome://extensions 中重新加载')), '[E3] 另一条包含「在 chrome://extensions 中重新加载」').toBe(true);
    await ext.snap(popup, 'S2-tabs 权限失败');
  });

  await test.step('S3：读取 diag-check-history 的状态与登记检查项数量', async () => {
    const history = await checkState(popup, 'diag-check-history');
    expect(history.status, '[E4] 只删了 tabs，history 权限不受影响').toBe('ok');
    expect(await renderedCheckCount(popup), '[E4] 登记的 11 个检查项全部渲染').toBe(DIAG_CHECK_IDS.length);
  });
});
