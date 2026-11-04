import { el } from '../lib/dom.js';
import { MSG } from '../../shared/messages.js';

function addressForm() {
  const current = el('p', { 'data-testid': 'diag-api-base-url-current', class: 'muted' }, '读取中…');
  const input = el('input', { 'data-testid': 'diag-api-base-url-input', type: 'url', disabled: true,
    autocomplete: 'off', spellcheck: 'false' });
  const save = el('button', { 'data-testid': 'diag-api-base-url-save', type: 'submit', disabled: true }, '保存');
  const error = el('p', { 'data-testid': 'diag-api-base-url-error', hidden: true, role: 'alert' });
  const saved = el('p', { 'data-testid': 'diag-api-base-url-saved', hidden: true, role: 'status' });
  const form = el('form', { novalidate: true }, el('h2', {}, '后端地址'), current,
    el('label', { class: 'field' }, 'API Base URL', input), save, error, saved);
  return { current, input, save, error, saved, form };
}

// @code C-FE-DIAG-03
/** @param {HTMLElement} slotEl 地址设置插槽。 @param {Readonly<object>} ctx 消息上下文。 @returns {Function} 卸载函数。 */
export function mount(slotEl, ctx) {
  const { current, input, save, error, saved, form } = addressForm();
  let disposed = false;
  let saving = false;
  const showError = (message) => { error.textContent = message; error.hidden = false; };
  const onInput = () => { error.hidden = true; saved.hidden = true; };
  const onSubmit = async (event) => {
    event.preventDefault();
    if (saving) return;
    saving = true;
    save.disabled = true;
    onInput();
    const response = await ctx.send(MSG.SET_API_BASE_URL, { apiBaseUrl: input.value });
    saving = false;
    if (disposed) return;
    save.disabled = false;
    if (!response.ok) { showError(response.error.message); return; }
    current.textContent = response.data.apiBaseUrl;
    input.value = response.data.apiBaseUrl;
    saved.textContent = response.data.warning ? `地址已保存；${response.data.warning}` : '地址已保存';
    saved.hidden = false;
  };
  form.addEventListener('submit', onSubmit);
  input.addEventListener('input', onInput);
  slotEl.replaceChildren(form);
  ctx.send(MSG.GET_API_BASE_URL, {}).then((response) => {
    if (disposed) return;
    input.disabled = false;
    save.disabled = false;
    if (!response.ok) { current.textContent = '地址读取失败'; showError(response.error.message); return; }
    current.textContent = response.data.apiBaseUrl;
    input.value = response.data.apiBaseUrl;
  });
  return () => {
    disposed = true;
    form.removeEventListener('submit', onSubmit);
    input.removeEventListener('input', onInput);
    form.remove();
  };
}
