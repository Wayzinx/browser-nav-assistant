import { parseGithubRepo } from './url.js';

// @code C-BE-REC-02
/** PR 之后检查构建最相关，Issue 之后查对应修复；其它同仓库页面保留弱关联。 */
const REPO_REL = { actions: 1, issues: 0.8, pull: 0.9, other: 0.7 };

/** @param {object} entry RankedEntry @param {{currentPage:object|null}} options 请求上下文 @returns {object|null} 同仓库候选，rel 取值 0–1。 */
export function matchSameRepo(entry, { currentPage }) {
  const current = parseGithubRepo(currentPage?.url);
  const target = parseGithubRepo(entry.page.normalizedUrl || entry.page.url);
  if (!current || !target || current.repo !== target.repo) return null;
  let rel = REPO_REL.other;
  let reason = `与当前页面属于同一仓库 ${current.repo}`;
  if (current.kind === 'pull' && target.kind === 'actions') {
    rel = REPO_REL.actions;
    reason = '你正在查看 PR，同仓库 CI 页面最近访问频率较高，可能需要检查构建状态';
  } else if (current.kind === 'pull' && target.kind === 'issues') {
    rel = REPO_REL.issues;
    reason = '你正在查看 PR，同仓库的 Issue 可能与本次改动相关';
  } else if (current.kind === 'issues' && target.kind === 'pull') {
    rel = REPO_REL.pull;
    reason = '你正在查看 Issue，同仓库的 PR 可能是对应修复';
  }
  return { ...entry, rel, reason, strategy: 'same_repo' };
}
