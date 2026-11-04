// 用例：TC-UI-DIAG-013（F-DIAG-05#AC1）插件已加载时「storage 可用」通过，并显示已使用字节数
import { test, expect } from '../fixtures/extension.mjs';
import { enterDiagTab, checkState, parseByteCount } from './diag-testkit.mjs';

test('TC-UI-DIAG-013 插件已加载时「storage 可用」通过，并显示已使用字节数', async ({ ext }) => {
  let popup;

  await test.step('S1：打开 popup → 诊断页签，等待 diag-loading 消失', async () => {
    popup = await ext.openPopup();
    await enterDiagTab(popup);
    await ext.snap(popup, 'S1-诊断页签');
  });

  await test.step('S2：读取 diag-check-storage 的状态与数值 / 详情文本', async () => {
    const storage = await checkState(popup, 'diag-check-storage');
    expect(storage.status, '[E1] diag-check-storage data-status="ok"').toBe('ok');
    expect(storage.statusText, '[E1] diag-item-status 文本为「通过」').toBe('通过');
    const text = `${storage.value} ${storage.detail}`;
    expect(text, '[E2] 用「字节」/ bytes / B 标明单位').toMatch(/字节|bytes|B(?![A-Za-z])/);
    expect(Number.isInteger(parseByteCount(text)), `[E2] 已用字节数可解析为非负整数（实际文本：${text.trim()}）`).toBe(true);
    await ext.snap(popup, 'S2-storage 可用');
  });

  await test.step('S3：在 service worker 中读取 chrome.storage.local.getBytesInUse(null)', async () => {
    const bytes = await ext.swEval(() => chrome.storage.local.getBytesInUse(null));
    expect(Number.isInteger(bytes) && bytes >= 0, '后测 getBytesInUse 为非负整数（仅观测，不与检测时快照做固定误差比较）').toBe(true);
  });
});
