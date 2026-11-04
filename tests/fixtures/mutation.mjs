// 断言有效性检查：对「被测调用」的响应做变异，检查用例能否发现。
// 只有 run-cases.mjs --mutation 会设置 MUTATION_OPS；正常执行和门禁执行都不会触发，也不会拦截后端。
// 变异只作用于用例自己发起的调用；reset、样例导入等 setup 调用不受影响。
// 如果某个变异下用例仍然通过，说明它的断言没有约束到对应的属性（例如只断言了状态码）。

export const OPS = ['status', 'drop-item', 'reverse', 'num-shift', 'str-blank', 'drop-key'];

export const OP_DESC = {
  'status': '2xx 改成 500、4xx/5xx 改成 200：断言是否检查了状态码',
  'drop-item': '每个数组删掉第 1 个元素：断言是否检查了数量或具体元素',
  'reverse': '长度 ≥ 2 的数组倒序：断言是否检查了顺序',
  'num-shift': '每个数字 +1：断言是否检查了具体数值或取值范围',
  'str-blank': '每个非空字符串改成空串：断言是否检查了文本或标识',
  'drop-key': '每个对象删掉第 1 个字段：断言是否检查了字段存在',
};

/**
 * @param {string} op 变异算子
 * @param {number} status 原始状态码
 * @param {any} body 解析后的响应体
 * @returns {{ applied: boolean, status: number, body: any }}
 */
export function mutate(op, status, body) {
  if (op === 'status') {
    if (status >= 200 && status < 300) return { applied: true, status: 500, body };
    if (status >= 400) return { applied: true, status: 200, body };
    return { applied: false, status, body };
  }
  if (body === null || typeof body !== 'object') return { applied: false, status, body };
  const copy = structuredClone(body);
  let applied = false;

  const mapValue = (v) => {
    if (op === 'num-shift' && typeof v === 'number') { applied = true; return v + 1; }
    if (op === 'str-blank' && typeof v === 'string' && v !== '') { applied = true; return ''; }
    if (v && typeof v === 'object') visit(v);
    return v;
  };
  const visit = (node) => {
    if (Array.isArray(node)) {
      if (op === 'drop-item' && node.length >= 1) { node.shift(); applied = true; }
      if (op === 'reverse' && node.length >= 2 && new Set(node.map((x) => JSON.stringify(x))).size > 1) { node.reverse(); applied = true; }
      for (let i = 0; i < node.length; i++) node[i] = mapValue(node[i]);
      return;
    }
    const keys = Object.keys(node);
    if (op === 'drop-key' && keys.length >= 1) { delete node[keys[0]]; applied = true; }
    for (const k of Object.keys(node)) node[k] = mapValue(node[k]);
  };

  visit(copy);
  return { applied, status, body: copy };
}
