import { el } from '../lib/dom.js';
import { MSG } from '../../shared/messages.js';
import { SK } from '../../shared/storage-keys.js';

// @code C-FE-DIAG-02
/** @param {{status?:string,connected?:boolean}} [result={}] 连接状态。 @returns {HTMLButtonElement} 可进入诊断的状态按钮。 */
export function renderConnection(result = {}) {
  const state = result.connected === true || result.status === 'online' ? 'online'
    : result.connected === false || result.status === 'offline' ? 'offline' : 'checking';
  const text = { online: '后端已连接', offline: '后端未连接', checking: '检测中' }[state];
  return el('button', { 'data-testid': 'connection-status', type: 'button', 'data-state': state,
    'aria-label': text }, text);
}

// @code C-FE-DIAG-02
/** @param {HTMLElement} slotEl 顶栏插槽。 @param {Readonly<object>} ctx 外壳上下文。 @returns {Function} 注销订阅。 */
export function mount(slotEl, ctx) {
  let disposed = false;
  let requestSequence = 0;
  let checkingRequests = 0;
  let status = 'checking';
  let diagnosticFailure = false;
  let diagnosticsReceived = false;
  const render = () => {
    if (disposed) return;
    slotEl.replaceChildren(renderConnection({ status }));
    ctx.setTabBadge('diag', status === 'offline' || diagnosticFailure);
  };
  const check = async () => {
    if (disposed) return;
    const sequence = ++requestSequence;
    checkingRequests++;
    status = 'checking';
    render();
    try {
      const response = await ctx.send(MSG.CHECK_CONNECTION, {});
      // 地址保存会触发新检查，旧地址的慢响应不能覆盖新地址结果。
      if (disposed || sequence !== requestSequence) return;
      status = response.ok && response.data.connected ? 'online' : 'offline';
      render();
    } catch {
      if (!disposed && sequence === requestSequence) { status = 'offline'; render(); }
    } finally {
      checkingRequests--;
    }
  };
  const updateDiagnostics = (value) => {
    diagnosticFailure = Number(value?.summary?.fail) > 0;
    render();
  };
  const onClick = () => ctx.switchTab('diag', { focus: true });
  slotEl.addEventListener('click', onClick);
  const off = [
    ctx.bus.on('storage:connection', ({ newValue, oldValue }) => {
      if (newValue?.status === 'unknown') {
        // API 失败也可能保持 unknown；只有新的地址重置才重新检测。
        const reset = newValue.lastErrorCode == null && (oldValue?.status !== 'unknown'
          || newValue.since !== oldValue?.since || newValue.lastCheckedAt !== oldValue?.lastCheckedAt
          || oldValue?.lastErrorCode != null);
        if (reset) void check();
        return;
      }
      // 检测请求自行渲染结果；其 storage 写入可能来自尚未完成的旧地址。
      if (!checkingRequests && ['online', 'offline'].includes(newValue?.status)) { status = newValue.status; render(); }
    }),
    ctx.bus.on('storage:lastDiagnostics', ({ newValue }) => {
      diagnosticsReceived = true;
      updateDiagnostics(newValue);
    }),
  ];
  chrome.storage.local.get(SK.LAST_DIAGNOSTICS).then((data) => {
    if (!diagnosticsReceived) updateDiagnostics(data[SK.LAST_DIAGNOSTICS]);
  }).catch(() => {});
  void check();
  return () => {
    disposed = true;
    off.forEach((unsubscribe) => unsubscribe());
    slotEl.removeEventListener('click', onClick);
    slotEl.replaceChildren();
  };
}
