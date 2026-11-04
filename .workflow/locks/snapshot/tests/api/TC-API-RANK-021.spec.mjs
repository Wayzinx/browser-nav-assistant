// 用例：TC-API-RANK-021；F-RANK-04 AC1/AC2；PRD 13.3：never_archive 规则使域名分 0.10→1.00
import { test, expect, samplePayload } from '../fixtures/api.mjs';

const DOCS = 'https://docs.internal.com/ai-agent-design';
const RULE = { rawText: 'docs.internal.com 的页面永远不要归档', type: 'never_archive', domain: 'docs.internal.com', action: 'keep' };

test('TC-API-RANK-021 保存 never_archive 后 docs 页加权，删除规则后恢复', async ({ api }) => {
  const T = Date.now();
  const ranked = () => api.get('/api/pages/ranked', { params: { limit: 500, now: T } });
  const pick = (r) => ({ idx: r.body.pages.findIndex((p) => p.url === DOCS), page: r.body.pages.find((p) => p.url === DOCS) });

  await test.step('S1：POST /api/sync 导入平移后的样例', () => api.seed(samplePayload({ now: T })));

  await test.step('S2：GET /api/pages/ranked?limit=500&now=T，记录 docs.internal 基线', async () => {
    const { idx, page } = pick(await ranked());
    expect(page.score, '[E1] 基线 score=0.56').toBe(0.56);
    expect(page.scoreDetail, '[E1] 基线 domain=0.10、domainSource=affinity').toMatchObject({ domain: 0.1, domainSource: 'affinity' });
    expect(idx, '[E1] 基线排第 8（下标 7）').toBe(7);
  });

  const id = await test.step('S3：POST /api/rules 保存 never_archive 规则，记录 id', async () => {
    const r = await api.post('/api/rules', { rules: [RULE] });
    expect(r.status, '[E2] 保存规则返回 201').toBe(201);
    expect(r.body.ruleCount, '[E2] ruleCount=1').toBe(1);
    expect(r.body.rules[0].id, '[E2] 规则 id 为非空字符串').toMatch(/\S/);
    expect(r.body.rules[0].enabled, '[E2] 规则 enabled=true').toBe(true);
    return r.body.rules[0].id;
  });

  await test.step('S4：GET /api/pages/ranked?limit=500&now=T', async () => {
    const r = await ranked();
    const { idx, page } = pick(r);
    expect(page.scoreDetail, '[E3] domain=1.00、domainSource=protected').toMatchObject({ domain: 1, domainSource: 'protected' });
    expect(page.score, '[E3] score=0.65').toBe(0.65);
    expect(idx, '[E3] 升到第 7（下标 6）').toBe(6);
    expect(r.body.pages[7], '[E3] 第 8 名为 react.dev/learn（0.57）').toMatchObject({ url: 'https://react.dev/learn', score: 0.57 });
    expect(page.reason, '[E4] 理由追加受保护域名句').toBe('6 天前访问，当前仍处于打开状态，属于受保护域名');
  });

  await test.step('S5：DELETE /api/rules/<ID>', async () => {
    const r = await api.del(`/api/rules/${encodeURIComponent(id)}`);
    expect(r.status, '[E5] 删除返回 200').toBe(200);
    expect(r.body, '[E5] deleted=ID、ruleCount=0').toMatchObject({ deleted: id, ruleCount: 0 });
  });

  await test.step('S6：GET /api/pages/ranked?limit=500&now=T', async () => {
    const { idx, page } = pick(await ranked());
    expect(page.score, '[E6] score 恢复为 0.56').toBe(0.56);
    expect(page.scoreDetail, '[E6] domain=0.10、domainSource=affinity').toMatchObject({ domain: 0.1, domainSource: 'affinity' });
    expect(idx, '[E6] 回到第 8（下标 7）').toBe(7);
    expect(page.reason, '[E6] 理由恢复为两句').toBe('6 天前访问，当前仍处于打开状态');
    expect(page.reason, '[E6] 理由不包含受保护域名').not.toContain('属于受保护域名');
  });
});
