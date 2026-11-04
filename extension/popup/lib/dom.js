const BOOLEAN_ATTRIBUTES = new Set([
  'autofocus', 'checked', 'disabled', 'hidden', 'multiple', 'readonly', 'required', 'selected',
]);

function appendChild(node, child) {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) {
    for (const item of child) appendChild(node, item);
  } else if (child instanceof Node) {
    node.append(child);
  } else {
    const text = document.createTextNode('');
    text.textContent = String(child);
    node.append(text);
  }
}

// @code C-FE-CORE-07
/**
 * 安全创建节点；文本不会作为 HTML 解析，布尔属性遵循 HTML 语义。
 * @param {string} tag 元素标签。
 * @param {Record<string, unknown>} [attrs={}] 属性。
 * @param {...unknown} children 文本、节点或其数组。
 * @returns {HTMLElement} 新建元素。
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs || {})) {
    if (/^on/i.test(name) || name.toLowerCase() === 'srcdoc') {
      throw new TypeError('不允许在渲染属性中设置脚本。');
    }
    if (value === undefined || value === null) continue;
    if (BOOLEAN_ATTRIBUTES.has(name.toLowerCase())) {
      if (value !== false) node.setAttribute(name, '');
    } else {
      node.setAttribute(name === 'className' ? 'class' : name, String(value));
    }
  }
  for (const child of children) appendChild(node, child);
  return node;
}

// @code C-FE-CORE-07
/**
 * 将毫秒时间戳显示为本地 HH:mm，无有效时间时显示破折号。
 * @param {number|null} timestamp 毫秒时间戳。
 * @returns {string} 可展示时间。
 */
export function formatTime(timestamp) {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return '—';
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date);
}

// @code C-FE-CORE-07
/**
 * 将有效分数显示为两位小数。
 * @param {number} score 分数。
 * @returns {string} 可展示分数。
 */
export function formatScore(score) {
  return typeof score === 'number' && Number.isFinite(score) ? score.toFixed(2) : '—';
}
