// @code C-BE-RULE-01
const STRONG_SEPARATOR = /[；;。\r\n]+|但是|另外|同时|而且|并且|但/u;
const CONDITION_START = /^(?:如果|若|当|要是)/u;
const RULE_ACTION = /推荐|建议\s*(?:看|打开|访问)|归档|关闭|清理|收起|优先|置顶|加权|提升/u;
const KEYWORD_START = /(?:包含|含有|带有|含)/u;
const KEYWORD_END = /的\s*(?:URL|网址|链接|页面|地址)/iu;

function keepComma(prefix, suffix) {
  // 条件与动作、关键词列表与宾语共用一个子句，保留原来的逗号及空格。
  if (CONDITION_START.test(prefix.trim()) && !RULE_ACTION.test(prefix)) return true;
  return KEYWORD_START.test(prefix) && !KEYWORD_END.test(prefix) && KEYWORD_END.test(suffix);
}

function splitCommas(segment) {
  const clauses = [];
  let start = 0;
  for (const comma of segment.matchAll(/[，,]/gu)) {
    const prefix = segment.slice(start, comma.index);
    const suffix = segment.slice(comma.index + 1);
    if (keepComma(prefix, suffix)) continue;
    if (prefix.trim()) clauses.push(prefix.trim());
    start = comma.index + 1;
  }
  const last = segment.slice(start).trim();
  if (last) clauses.push(last);
  return clauses;
}

/**
 * @param {string} text 已校验的自然语言文本
 * @returns {string[]} 按输入顺序返回非空子句，只去分隔符和外围空白，不改写子句原文
 */
export function splitClauses(text) {
  return text.split(STRONG_SEPARATOR).flatMap(splitCommas);
}
