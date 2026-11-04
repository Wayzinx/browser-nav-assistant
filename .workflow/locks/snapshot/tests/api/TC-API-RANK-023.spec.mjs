// 用例：TC-API-RANK-023；停用规则（enabled=false）不参与排序加权
import { test, expect, samplePayload } from '../fixtures/api.mjs';

const DOCS = 'https://docs.internal.com/ai-agent-design';
const RULE = { rawText: 'docs.internal.com 的页面永远不要归档', type: 'never_archive', domain: 'docs.internal.com', action: 'keep', enabled: false };

test('TC-API-RANK-023 enabled=false 的 never_archive 规则不影响排序', async ({ api }) => {
  const T = Date.now();
  await test.step('S1：POST /api/sync 导入平移后的样例', () => api.seed(samplePayload({ now: T })));

  await test.step('S2：POST /api/rules 保存 enabled=false 的规则', async () => {
    const r = await api.post('/api/rules', { rules: [RULE] });
    expect(r.status, '[E1] 保存规则返回 201').toBe(201);
    expect(r.body.rules[0].enabled, '[E1] 规则 enabled=false').toBe(false);
    expect(r.body.ruleCount, '[E1] ruleCount=1').toBe(1);
  });

  await test.step('S3：GET /api/pages/ranked?limit=500&now=T，取 docs.internal 页面', async () => {
    const r = await api.get('/api/pages/ranked', { params: { limit: 500, now: T } });
    const idx = r.body.pages.findIndex((p) => p.url === DOCS);
    const page = r.body.pages[idx];
    expect(page.score, '[E2] score 仍为 0.56').toBe(0.56);
    expect(page.scoreDetail, '[E2] domain=0.10、domainSource=affinity').toMatchObject({ domain: 0.1, domainSource: 'affinity' });
    expect(idx, '[E2] 仍排第 8（下标 7）').toBe(7);
    expect(page.reason, '[E3] 理由为两句').toBe('6 天前访问，当前仍处于打开状态');
    expect(page.reason, '[E3] 理由不包含受保护域名').not.toContain('属于受保护域名');
  });
});
