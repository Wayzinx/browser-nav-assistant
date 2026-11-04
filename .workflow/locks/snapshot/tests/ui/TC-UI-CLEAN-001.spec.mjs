import { test, expect } from '../fixtures/extension.mjs';

// TDD 草稿：只观察真实插件请求；采集与清理均使用现有夹具，不拦截后端。
const observations = new WeakMap();

test.beforeEach(async ({ ext }) => {
  await ext.swEval(async (baseURL) => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({ apiBaseUrl: baseURL });
  }, ext.baseURL);
  const traffic = { requests: [], responses: [], failed: [] };
  const isBackend = (request) => [ext.baseURL, 'http://127.0.0.1:9']
    .some((base) => request.url().startsWith(`${base}/api/`));
  ext.context.on('request', (request) => { if (isBackend(request)) traffic.requests.push(request); });
  ext.context.on('response', (response) => { if (isBackend(response.request())) traffic.responses.push(response); });
  ext.context.on('requestfailed', (request) => { if (isBackend(request)) traffic.failed.push(request); });
  observations.set(ext.context, traffic);
});

test.afterEach(async ({ ext, api, evidence }) => {
  try {
    if (ext.popup && !ext.popup.isClosed()) await ext.snap(ext.popup, '结束状态');
    const traffic = observations.get(ext.context);
    for (const response of traffic.responses) {
      const request = response.request();
      const completionError = await response.finished();
      if (completionError) throw completionError;
      const responseHeaders = await response.allHeaders();
      const requestHeaders = await request.allHeaders();
      const responseBody = /json/i.test(responseHeaders['content-type'] || '')
        ? await response.json() : await response.text();
      evidence.recordApi({
        source: 'extension', method: request.method(), url: request.url(),
        reqId: responseHeaders['x-request-id'] || requestHeaders['x-request-id'] || null,
        requestHeaders, requestBody: request.postData(),
        status: response.status(), responseHeaders, responseBody,
        ms: request.timing().responseEnd, setup: false,
      });
    }
    for (const request of traffic.failed) {
      evidence.recordApi({
        source: 'extension', method: request.method(), url: request.url(),
        reqId: request.headers()['x-request-id'] || null,
        requestHeaders: await request.allHeaders(), requestBody: request.postData(),
        status: null, responseHeaders: null, responseBody: null,
        networkError: request.failure()?.errorText, setup: false,
      });
    }
  } finally {
    try {
      await ext.setApiBase(ext.baseURL);
    } finally {
      try {
        await ext.swEval(() => chrome.storage.local.clear());
      } finally {
        try {
          await api.reset();
        } finally {
          try {
            for (const page of ext.context.pages()) await page.close();
          } finally {
            await ext.context.close();
          }
        }
      }
    }
  }
});

async function waitForCleanup(ext, afterRequest) {
  const traffic = observations.get(ext.context);
  const matches = (response) => response.request().method() === 'GET'
    && new URL(response.url()).pathname === '/api/pages/cleanup-suggestions'
    && traffic.requests.indexOf(response.request()) >= afterRequest;
  await expect.poll(() => traffic.responses.filter(matches).map((response) => response.status()),
    { message: '等待插件真实拉取整理建议成功' }).toContain(200);
  const response = traffic.responses.findLast((item) => matches(item) && item.status() === 200);
  const completionError = await response.finished();
  if (completionError) throw completionError;
  // 等待网络结果写入缓存，再等待视图退出加载态，避免负向断言读到旧缓存。
  await expect.poll(async () => (await ext.getStorage('cache')).cache?.cleanup?.cachedAt,
    { message: '等待本次真实网络响应写入整理缓存' }).toBeGreaterThanOrEqual(response.request().timing().startTime);
  await expect(ext.popup.getByTestId('home-cleanup-loading'), '首页整理加载已结束').toBeHidden();
  await expect(ext.popup.getByTestId('cleanup-loading'), '整理页加载已结束').toBeHidden();
}

const RULES = [
  { rawText: '把 7 天没访问过的 GitHub issue 建议归档', type: 'archive_candidate', domain: 'github.com', urlPattern: '/issues/', inactiveDays: 7, action: 'suggest_archive', enabled: true },
  { rawText: 'docs.internal.com 的页面永远不要归档', type: 'never_archive', domain: 'docs.internal.com', action: 'keep', enabled: true },
];

const OLD = 'https://github.com/org/repo/issues/100';
const ISSUE = 'https://github.com/org/repo/issues/123';
const COMMENTS = `${ISSUE}?tab=comments`;
const PROTECTED = 'https://docs.internal.com/ai-agent-design';

test("TC-UI-CLEAN-001 样例与两条规则：摘要2/1/1，三组和命中规则原文完整展示", async ({ ext, api, evidence }) => {
  await test.step('S1：重置并按 D-01 导入样例', async () => {
    await api.reset();
    const { res } = await api.loadSample();
    expect(res.status, '样例导入返回 200').toBe(200);
    expect(res.body.pageCount, '样例包含 10 个页面').toBe(10);
  });
  const savedRules = await test.step('S2：保存题目两条规则并取得正式 ID', async () => {
    const saved = await api.post('/api/rules', { rules: RULES }, { setup: true });
    expect(saved.status, '规则保存返回 201').toBe(201);
    expect(saved.body.rules, '保存两条规则').toHaveLength(2);
    return saved.body.rules;
  });
  const popup = await test.step('S3：读取后端建议与规则，打开首页', async () => {
    const cleanup = await api.get('/api/pages/cleanup-suggestions');
    const listed = await api.get('/api/rules');
    expect(cleanup.status, '整理建议返回 200').toBe(200);
    expect(listed.status, '规则列表返回 200').toBe(200);
    expect(cleanup.body.suggestions.find((item) => item.url === OLD).ruleId, '归档规则 ID 来自本次保存响应').toBe(savedRules[0].id);
    expect(cleanup.body.suggestions.find((item) => item.url === PROTECTED).ruleId, '保护规则 ID 来自本次保存响应').toBe(savedRules[1].id);
    expect(listed.body.rules, '正式规则及原文可回读').toEqual(expect.arrayContaining(savedRules));
    evidence.note(JSON.stringify({ suggestions: cleanup.body.suggestions, savedRules }));
    const marker = observations.get(ext.context).requests.length;
    const page = await ext.openPopup();
    await waitForCleanup(ext, marker);
    await ext.snap(page, '首页摘要');
    return page;
  });
  await test.step('S4：核对三计数并点击首页摘要', async () => {
    await expect(popup.getByTestId('home-cleanup-archive-count'), '[E1] 归档计数').toHaveText('归档 2');
    await expect(popup.getByTestId('home-cleanup-merge-count'), '[E2] 重复计数').toHaveText('重复 1');
    await expect(popup.getByTestId('home-cleanup-keep-count'), '[E3] 保留计数').toHaveText('保留 1');
    await ext.snap(popup, '点击摘要前');
    await popup.getByTestId('home-cleanup-summary').click();
    await expect(popup.getByTestId('panel-cleanup'), '[E4] 点击后进入整理面板').toBeVisible();
    await expect(popup.getByTestId('tab-cleanup'), '[E4] 整理页签被选中').toHaveAttribute('aria-selected', 'true');
    await ext.snap(popup, '点击摘要后');
  });
  await test.step('S5：核对三组、完整 URL、理由与规则原文', async () => {
    const archive = popup.getByTestId('cleanup-group-archive').getByTestId('cleanup-item');
    const merge = popup.getByTestId('cleanup-group-merge').getByTestId('cleanup-item');
    const keep = popup.getByTestId('cleanup-group-keep').getByTestId('cleanup-item');
    await expect(archive, '[E5] 归档组两项').toHaveCount(2);
    await expect(merge, '[E5] 重复组一项').toHaveCount(1);
    await expect(keep, '[E5] 保留组一项').toHaveCount(1);
    const old = archive.filter({ has: popup.getByTestId('cleanup-item-url').filter({ hasText: OLD }) });
    await expect(old, '[E6] 目标父项唯一').toHaveCount(1);
    await expect(old.getByTestId('cleanup-item-title'), '[E6] 显示原始标题').toHaveText('Old bug report from last sprint');
    await expect(old.getByTestId('cleanup-item-url'), '[E6] 显示完整 URL').toHaveText(OLD);
    await expect(old.getByTestId('cleanup-item-rule-tag'), '[E7] 显示规则标签').toHaveText('规则');
    await expect(old.getByTestId('cleanup-item-rule-text'), '[E7] 显示归档规则原文').toHaveText(RULES[0].rawText);
    await expect(old.getByTestId('cleanup-item-reason'), '[E8] 完整显示阈值、天数及命中规则理由').toHaveText('超过 7 天未访问（已 24 天），且不在当前打开的 tab 中；命中规则「把 7 天没访问过的 GitHub issue 建议归档」');
    const escaped = [ISSUE, COMMENTS].map((url) => url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const lines = new RegExp(`^(?:${escaped.join('\\r?\\n')}|${escaped.toReversed().join('\\r?\\n')})$`);
    await expect(merge.getByTestId('cleanup-item-url'), '[E9] 重复组仅显示两个完整 URL，每个一行').toHaveText(lines, { useInnerText: true });
    await expect(keep.getByTestId('cleanup-item-url'), '[E10] 保留保护域页面').toHaveText(PROTECTED);
    await expect(keep.getByTestId('cleanup-item-rule-text'), '[E10] 显示保护规则原文').toHaveText(RULES[1].rawText);
    await expect(popup.getByTestId('tab-cleanup-count'), '[E11] 待处理数只含归档与重复').toHaveText('3');
    await ext.snap(popup, '三组和规则原文');
  });
});
