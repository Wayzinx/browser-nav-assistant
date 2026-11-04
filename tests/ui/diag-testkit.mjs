// DIAG UI 用例的公共工具：11 项检查的登记 testId、进入诊断页签 / 重新检测的等待、检查项读取。
// 只使用 docs/trace/ui-contract.json 中登记的 testId；断言辅助，不做任何 mock。
import { expect } from '../fixtures/extension.mjs';

/** ui-contract 登记的 11 个检查项 testId（顺序与前端方案 §9 一致） */
export const DIAG_CHECK_IDS = [
  'diag-check-backend',
  'diag-check-tabs',
  'diag-check-history',
  'diag-check-storage',
  'diag-check-api-base-url',
  'diag-check-last-sync',
  'diag-check-rule-count',
  'diag-check-active-tab',
  'diag-check-privacy',
  'diag-check-incognito',
  'diag-check-version',
];

/** FE-API-02 / D-11：storage 没有 apiBaseUrl 时的默认地址 */
export const DEFAULT_API_BASE = 'http://127.0.0.1:3000';

/** 「后端服务连接」失败项排查步骤里必须出现的可执行线索（前端方案 §9 第 1 行） */
export const BACKEND_HINT_FRAGMENTS = ['./scripts/start.sh', 'API Base URL', 'host_permissions', '/api/health'];

/** 点击「诊断」页签，等本轮检测结束（面板可见、loading 消失、检测时间出现） */
export async function enterDiagTab(page) {
  await page.getByTestId('tab-diag').click();
  await expect(page.getByTestId('panel-diag')).toBeVisible();
  await expect(page.getByTestId('diag-checked-at')).toBeVisible();
  await expect(page.getByTestId('diag-loading')).toBeHidden();
}

/** 点击「重新检测」，等到检测时间向前推进（本轮检测结束） */
export async function rerunDiag(page) {
  const before = Number(await page.getByTestId('diag-checked-at').getAttribute('data-ts'));
  await page.getByTestId('diag-rerun-button').click();
  await expect(page.getByTestId('diag-loading')).toBeHidden();
  await expect.poll(async () => Number(await page.getByTestId('diag-checked-at').getAttribute('data-ts'))).toBeGreaterThan(before);
}

/** 读取一个检查项的 data-status 与子元素文本（子元素一律在所属检查项容器内查找） */
export async function checkState(page, testId) {
  const check = page.getByTestId(testId);
  return {
    status: await check.getAttribute('data-status'),
    name: ((await check.getByTestId('diag-item-name').textContent()) || '').trim(),
    statusText: ((await check.getByTestId('diag-item-status').textContent()) || '').trim(),
    detail: ((await check.getByTestId('diag-item-detail').textContent()) || '').trim(),
    value: ((await check.getByTestId('diag-item-value').textContent()) || '').trim(),
    hintSteps: (await check.getByTestId('diag-item-hint-step').allTextContents()).map((s) => s.trim()).filter((s) => s.length > 0),
  };
}

/** 统计页面上渲染出来的登记检查项数量（每个 testId 恰好一个元素才算渲染） */
export async function renderedCheckCount(page) {
  const counts = await Promise.all(DIAG_CHECK_IDS.map((id) => page.getByTestId(id).count()));
  return counts.filter((n) => n === 1).length;
}

/** 解析 diag-summary 文本里的通过 / 警告 / 失败计数（不依赖数字与名称的排列顺序） */
export function summaryCounts(text) {
  const pick = (label) => {
    const m = new RegExp(`${label}\\s*[:：]?\\s*(\\d+)`).exec(text || '');
    return m ? Number(m[1]) : Number.NaN;
  };
  return { ok: pick('通过'), warn: pick('警告'), fail: pick('失败') };
}

/** 从「已用字节数」文案里解析数值（单位：字节 / bytes / B）；解析不到返回 NaN */
export function parseByteCount(text) {
  const m = /(\d+)\s*(字节|bytes|B)(?![A-Za-z])/i.exec(text || '');
  return m ? Number(m[1]) : Number.NaN;
}

/** 只读监听扩展 service worker 发出的 /api/ 请求（不拦截、不改写），返回收集数组 */
export function watchServiceWorkerApiRequests(ext) {
  const calls = [];
  ext.context.on('request', (request) => {
    const sw = request.serviceWorker();
    const url = new URL(request.url());
    if (sw && url.pathname.startsWith('/api/')) calls.push({ method: request.method(), origin: url.origin, path: url.pathname });
  });
  return calls;
}

/** 在 popup 页面里发 LIST_RULES 消息，按 { ok, data } 信封返回 data（不猜 cache 内部形状） */
export async function listRules(page, source, requestId) {
  const response = await page.evaluate(({ source: s, requestId: id }) => new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'LIST_RULES', payload: { source: s }, requestId: id }, resolve);
  }), { source, requestId });
  if (!response || response.ok !== true) throw new Error(`LIST_RULES(${source}) 未返回成功信封：${JSON.stringify(response)}`);
  return response.data;
}
