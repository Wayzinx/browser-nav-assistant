// @code C-FE-CORE-04
// 顶层 key 以契约为准，诊断临时 key 也必须先登记。
export const SK = Object.freeze({
  API_BASE_URL: 'apiBaseUrl',
  SYNC_STATE: 'syncState',
  CACHE: 'cache',
  CONNECTION: 'connection',
  SETTINGS: 'settings',
  IMPORTANT_URLS: 'importantUrls',
  IGNORED_SUGGESTIONS: 'ignoredSuggestions',
  LAST_CLEANUP_ACTION: 'lastCleanupAction',
  LAST_DIAGNOSTICS: 'lastDiagnostics',
  DIAG_PROBE: '__diag__',
  LAST_MENU_ACTION: 'lastMenuAction',
});
