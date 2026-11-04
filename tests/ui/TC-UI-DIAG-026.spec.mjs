// 用例：TC-UI-DIAG-026（F-DIAG-11#AC2）从首页诊断入口进入诊断页签后「重新检测」：11 项重新执行、检测时间更新
import { test as baseTest, expect } from '../fixtures/extension.mjs';
import { DIAG_CHECK_IDS, checkState, listRules, rerunDiag, renderedCheckCount, watchServiceWorkerApiRequests } from './diag-testkit.mjs';
import { instrumentation, coverageSnapshot, fnCountByName, fnCountAfter, locateCheckMarkers, launchInstrumentedContext, closeInstrumentedContext } from './diag-instrumented-ext.mjs';

// 本条专属：context 夹具改为加载 Istanbul 插桩的临时扩展副本（不经全局 EXT_DIR，避免泄漏给其他用例）
const test = baseTest.extend({
  context: async ({ evidence }, use) => {
    const context = await launchInstrumentedContext(evidence);
    await use(context);
    await closeInstrumentedContext(context);
  },
});

const RULE_1 = { rawText: '把 7 天没访问过的 GitHub issue 建议归档', type: 'archive_candidate', domain: 'github.com', urlPattern: '/issues/', inactiveDays: 7, action: 'suggest_archive' };
const RULE_2 = { rawText: 'docs.internal.com 的页面永远不要归档', type: 'never_archive', domain: 'docs.internal.com', action: 'keep' };

// 契约里的检查项 id（diag-check-api-base-url 对应 id=apiBaseUrl）
const CHECK_IDS = ['backend', 'tabs', 'history', 'storage', 'apiBaseUrl', 'lastSync', 'ruleCount', 'activeTab', 'privacy', 'incognito', 'version'];
const CHECK_FN_NAMES = ['checkBackend', 'checkTabs', 'checkHistory', 'checkStorage', 'checkLastSync', 'checkRuleCount', 'checkActiveTab', 'checkPrivacy', 'checkIncognito', 'checkVersion'];

let popup;
test.afterEach(async () => {
  if (popup && !popup.isClosed()) await popup.close();
  popup = null;
});

test('TC-UI-DIAG-026 从首页诊断入口进入诊断页签后「重新检测」：11 项重新执行、检测时间更新', async ({ ext, api }) => {
  let before = {};
  let after = {};
  let checkedAtBefore = 0;
  let checkedAtAfter = 0;
  let requests = [];
  let coverageA = {};
  let coverageB = {};
  let coverageC = {};

  await test.step('S1：保存规则①、形成 1 条缓存，从首页诊断入口进入并记录 T1 与首次结果', async () => {
    if (instrumentation.error) throw new Error(`插桩不可用，本条不能宣称已验证重新执行：${instrumentation.error}`);
    const saved = await api.post('/api/rules', { rules: [RULE_1] });
    expect(saved.status, '规则① HTTP 201').toBe(201);
    popup = await ext.openPopup();
    await expect(popup.getByTestId('home-diag-entry'), '[E1] 首页诊断入口可见').toBeVisible();
    await expect(popup.getByTestId('home-diag-entry'), '[E1] 首页诊断入口可点击（不是禁用的占位按钮）').toBeEnabled();
    const network = await listRules(popup, 'network', 'diag-026-network');
    expect(network.rules.length, '缓存形成 1 条规则').toBe(1);
    await popup.getByTestId('home-diag-entry').click();
    await expect(popup.getByTestId('panel-diag'), '[E1] 点击后诊断面板可见').toBeVisible();
    await expect(popup.getByTestId('diag-checked-at')).toBeVisible();
    checkedAtBefore = Number(await popup.getByTestId('diag-checked-at').getAttribute('data-ts'));
    expect(Number.isInteger(checkedAtBefore), '[E1] T1 为毫秒时间戳').toBe(true);
    expect(await renderedCheckCount(popup), '[E1] 11 个登记检查项齐全').toBe(DIAG_CHECK_IDS.length);
    for (const id of DIAG_CHECK_IDS) before[id] = await checkState(popup, id);
    expect(before['diag-check-privacy'].status, '[E1] 首次「隐私过滤」为 ok').toBe('ok');
    expect(before['diag-check-rule-count'].value, '[E1] 首次规则数 value="1"').toBe('1');
    coverageA = await coverageSnapshot(ext.sw);
    await ext.snap(popup, 'S1-首次诊断');
  });

  await test.step('S2：制造真实输入变化（关闭隐私过滤、后端 2 条规则、失败同步记录），读取基线计数 B', async () => {
    const config = await api.put('/api/config', { enablePrivacyFilter: false });
    expect(config.body.enablePrivacyFilter, '隐私过滤已关闭').toBe(false);
    const saved = await api.post('/api/rules', { rules: [RULE_2] });
    expect(saved.body.ruleCount, '后端规则数为 2').toBe(2);
    const T = Date.now();
    await ext.setStorage({
      syncState: {
        status: 'error', startedAt: T, lastSyncAt: T, lastSuccessAt: T - 60_000,
        lastError: { code: 'VALIDATION_FAILED', message: '诊断重检输入已变化' },
        cursor: null, cursorBase: null, fullReason: null, mode: 'full', trigger: 'user',
        stats: { uploaded: 0, filtered: 0, received: 0, created: 0, updated: 0, rejected: 0 },
      },
      connection: { status: 'online', since: T, lastCheckedAt: T, lastErrorCode: null, recoverPending: false },
    });
    coverageB = await coverageSnapshot(ext.sw);
  });

  await test.step('S3：注册只读监听并点击 diag-rerun-button，记录 T2 与本轮结果 C', async () => {
    requests = watchServiceWorkerApiRequests(ext);
    await rerunDiag(popup);
    checkedAtAfter = Number(await popup.getByTestId('diag-checked-at').getAttribute('data-ts'));
    for (const id of DIAG_CHECK_IDS) after[id] = await checkState(popup, id);
    coverageC = await coverageSnapshot(ext.sw);
    await ext.snap(popup, 'S3-重新检测后');
  });

  await test.step('S4：比较计数增量与 lastDiagnostics，核对本轮真实输入变化', async () => {
    const delta = (name) => fnCountByName(coverageC, name) - fnCountByName(coverageB, name);
    const markers = locateCheckMarkers(CHECK_IDS);
    const checkDeltas = {};
    for (const label of CHECK_IDS) {
      const hit = markers[label];
      if (!hit) throw new Error(`找不到检查项 ${label} 的 safeCheck 回调位置：插桩或源码结构不符合预期，证据缺失`);
      checkDeltas[label] = fnCountAfter(coverageC, hit.rel, hit.source, hit.marker) - fnCountAfter(coverageB, hit.rel, hit.source, hit.marker);
    }

    expect(checkedAtAfter, '[E2] T2 > T1').toBeGreaterThan(checkedAtBefore);
    const diag = (await ext.getStorage('lastDiagnostics')).lastDiagnostics;
    expect(diag.checkedAt, '[E2] lastDiagnostics.checkedAt = T2').toBe(checkedAtAfter);
    expect(diag.items.length, '[E2] items.length=11').toBe(11);
    expect(diag.items.map((item) => item.id).sort(), '[E2] id 集合与契约 11 项完全相同').toEqual([...CHECK_IDS].sort());
    expect(Object.values(after).filter((state) => ['ok', 'warn', 'fail', 'info'].includes(state.status)).length, '[E2] 页面 11 项均有合法 data-status').toBe(11);

    expect(after['diag-check-privacy'].status, '[E3] 隐私过滤由 ok 变 warn').toBe('warn');
    expect(after['diag-check-last-sync'].status, '[E3] 最近一次同步变 fail').toBe('fail');
    expect(after['diag-check-last-sync'].detail, '[E3] 含「诊断重检输入已变化」').toContain('诊断重检输入已变化');
    expect(after['diag-check-rule-count'].detail, '[E3] 规则数不一致提示').toContain('规则数不一致');
    expect(after['diag-check-rule-count'].value, '[E3] 自动重拉后 value="2"').toBe('2');
    const cache = await listRules(popup, 'cache', 'diag-026-cache');
    expect(cache.rules.length, '[E3] cache 读回 2 条').toBe(2);

    expect(delta('runDiagnostics'), '[E4] runDiagnostics 计数增量 ≥ 1').toBeGreaterThanOrEqual(1);
    expect(delta('safeCheck'), '[E4] safeCheck 计数增量 ≥ 11').toBeGreaterThanOrEqual(11);
    expect(CHECK_FN_NAMES.filter((name) => delta(name) >= 1).length, `[E4] 10 个已登记 check 函数各 ≥1：${JSON.stringify(CHECK_FN_NAMES.map((name) => [name, delta(name)]))}`).toBe(10);
    expect(checkDeltas.apiBaseUrl, '[E4] apiBaseUrl 检查项回调计数增量 ≥ 1').toBeGreaterThanOrEqual(1);
    expect(coverageA && coverageB && coverageC ? Object.keys(coverageC).length : 0, '[E4] 三次快照都拿到了插桩计数').toBeGreaterThan(0);

    expect(requests.some((r) => r.method === 'GET' && r.path === '/api/health'), '[E5] 本轮真实 GET /api/health').toBe(true);
    expect(requests.some((r) => r.method === 'GET' && r.path === '/api/config'), '[E5] 本轮真实 GET /api/config').toBe(true);
    expect(requests.some((r) => r.method === 'GET' && r.path === '/api/rules'), '[E5] 不一致触发真实 GET /api/rules').toBe(true);
    expect(after['diag-check-api-base-url'].value, '[E5] API Base URL 项仍显示实际地址').toContain(ext.baseURL);
  });
});
