// @code C-BE-REC-04
/** D-22 全局兜底的关联度最低，不压过与当前上下文相关的召回。 */
const GLOBAL_REL = 0.3;

/** @param {object} entry RankedEntry @returns {object} 全局候选，不绕过最终过滤。 */
export function matchGlobalTop(entry) {
  return {
    ...entry, rel: GLOBAL_REL, strategy: 'global_top',
    reason: '近期综合评分较高的页面，可作为备选',
  };
}
