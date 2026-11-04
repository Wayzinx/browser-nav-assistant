import { el } from '../lib/dom.js';
import { SK } from '../../shared/storage-keys.js';

// @code C-FE-RULE-05
/**
 * 首页快捷输入只传递原文，解析仍由规则页完成。
 * @param {HTMLElement} slotEl 首页规则插槽。
 * @param {Readonly<object>} ctx 外壳上下文。
 * @returns {Function} 卸载监听和视图。
 */
export function mount(slotEl, ctx) {
  const input = el('input', { 'data-testid': 'home-rule-input', type: 'text', maxlength: '500', placeholder: '输入一句话配置规则' });
  const button = el('button', { 'data-testid': 'home-rule-parse-button', type: 'button' }, '解析');
  const block = el('section', { class: 'view-block' }, el('h2', {}, '用一句话配置规则'),
    el('label', { class: 'field' }, '规则内容', input), button);
  const updateConnection = (connection) => {
    button.disabled = connection?.status === 'offline';
    button.setAttribute('aria-disabled', String(button.disabled));
  };
  const parse = () => {
    if (button.disabled) return;
    ctx.switchTab('rules');
    ctx.bus.emit('rule:parse', { text: input.value });
  };
  button.addEventListener('click', parse);
  updateConnection(ctx.getState().connection);
  const off = ctx.bus.on(`storage:${SK.CONNECTION}`, ({ newValue }) => updateConnection(newValue));
  slotEl.replaceChildren(block);
  return () => { off(); button.removeEventListener('click', parse); block.remove(); };
}
