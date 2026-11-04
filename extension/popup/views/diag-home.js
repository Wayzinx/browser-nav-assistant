import { el } from '../lib/dom.js';
import { SK } from '../../shared/storage-keys.js';

function summaryText(result) {
  if (!result?.summary) return '启动诊断 · 尚未检测 ›';
  const { ok = 0, warn = 0, fail = 0, info = 0 } = result.summary;
  return warn + fail > 0 ? `启动诊断 · ${warn + fail} 项异常 ›`
    : `启动诊断 · ${ok + info} 项检查全部正常 ›`;
}

// @code C-FE-DIAG-12
/** @param {HTMLElement} slotEl 首页入口插槽。 @param {Readonly<object>} ctx 导航与事件上下文。 @returns {Function} 卸载函数。 */
export function mount(slotEl, ctx) {
  const button = el('button', { 'data-testid': 'home-diag-entry', type: 'button' }, '启动诊断 · 读取中… ›');
  let disposed = false;
  let received = false;
  const render = (value) => { if (!disposed) button.textContent = summaryText(value); };
  const onClick = () => ctx.switchTab('diag', { focus: true });
  button.addEventListener('click', onClick);
  const off = ctx.bus.on('storage:lastDiagnostics', ({ newValue }) => { received = true; render(newValue); });
  slotEl.replaceChildren(button);
  chrome.storage.local.get(SK.LAST_DIAGNOSTICS).then((data) => {
    if (!received) render(data[SK.LAST_DIAGNOSTICS]);
  }).catch(() => { if (!disposed) button.textContent = '启动诊断 · 无法读取上次结果，点击重新检测 ›'; });
  return () => { disposed = true; off(); button.removeEventListener('click', onClick); button.remove(); };
}
