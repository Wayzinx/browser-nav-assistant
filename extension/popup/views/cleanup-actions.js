import { MSG } from '../../shared/messages.js';
import { el } from '../lib/dom.js';

// @code C-FE-CLEAN-05
function actionButton(testId, label, type, payload, ctx) {
  const button = el('button', {
    'data-testid': testId, type: 'button', disabled: ctx.busy === true,
    'aria-disabled': String(ctx.busy === true),
  }, label);
  button.addEventListener('click', () => { void ctx.run(type, payload); });
  return button;
}

/**
 * 按后端建议生成操作按钮，实际发送与状态更新交给整理视图控制器。
 * @param {Object} item 后端建议，key 原样用于忽略。
 * @param {{busy?: boolean, run: Function}} ctx 操作状态与执行回调。
 * @returns {HTMLElement} 行内操作区。
 */
export function renderItemActions(item, ctx) {
  const actions = el('div', { class: 'cleanup-item-actions' });
  if (item.action === 'archive') {
    actions.append(actionButton('cleanup-archive-button', '归档', MSG.CLEANUP_ARCHIVE, { urls: [item.url] }, ctx));
  } else if (item.action === 'merge') {
    actions.append(actionButton('cleanup-merge-button', '合并', MSG.CLEANUP_MERGE, { urls: [...item.urls], keepUrl: item.keepUrl }, ctx));
  }
  actions.append(actionButton('cleanup-ignore-button', '忽略', MSG.CLEANUP_IGNORE, { key: item.key }, ctx));
  return actions;
}

/**
 * 全部归档只提交当前展示的 archive 项，不把重复或保留组加入请求。
 * @param {Object[]} suggestions 已过滤的后端建议。
 * @param {{busy?: boolean, run: Function}} ctx 操作状态与执行回调。
 * @returns {HTMLElement} 全部归档按钮。
 */
export function renderArchiveAllButton(suggestions, ctx) {
  const urls = suggestions.filter((item) => item.action === 'archive').map((item) => item.url);
  const button = actionButton('cleanup-archive-all-button', '全部归档', MSG.CLEANUP_ARCHIVE, { urls }, ctx);
  button.disabled = ctx.busy === true || urls.length === 0;
  button.setAttribute('aria-disabled', String(button.disabled));
  return button;
}

/**
 * 操作错误独立于列表状态，刷新为空时仍保留失效提示。
 * @param {{kind: string, urls: string[]}|null} action 最近成功的撤销记录。
 * @param {{busy?: boolean, error?: string|null, run: Function}} ctx 操作状态与执行回调。
 * @returns {HTMLElement} 撤销及错误区。
 */
export function renderUndoBar(action, ctx) {
  const canUndo = ['archive', 'merge'].includes(action?.kind)
    && Array.isArray(action?.urls) && action.urls.length > 0;
  const undo = actionButton('cleanup-undo-button', '撤销', MSG.CLEANUP_UNARCHIVE, { urls: canUndo ? [...action.urls] : [] }, ctx);
  undo.hidden = !canUndo;
  return el('div', { class: 'cleanup-action-status', 'aria-busy': String(ctx.busy === true) },
    el('div', { class: 'cleanup-undo', hidden: !canUndo },
      el('span', {}, action?.kind === 'merge' ? '已合并重复页面' : '已归档页面'), undo,
    ),
    el('p', { 'data-testid': 'cleanup-action-error', class: 'state error', hidden: !ctx.error, role: 'alert' }, ctx.error || ''),
  );
}
