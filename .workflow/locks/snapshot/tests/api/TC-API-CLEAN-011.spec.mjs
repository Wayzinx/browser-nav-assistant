import { test, expect, samplePayload } from '../fixtures/api.mjs';

const DOC = 'https://docs.internal.com/ai-agent-design';
const RULE = { rawText: 'docs.internal.com 的页面永远不要归档', type: 'never_archive', domain: 'docs.internal.com', action: 'keep' };

test('TC-API-CLEAN-011 保护规则使打开中的样例文档进入 keep', async ({ api }) => {
  const now = Date.now();
  await test.step('S1：同步平移后的样例', () => api.seed(samplePayload({ now })));
  const ruleId = await test.step('S2：保存 docs.internal.com 保护规则并取得 id', async () => {
    const r = await api.post('/api/rules', { rules: [RULE] });
    expect(r.status, '[E1] 保存返回 201').toBe(201);
    expect(r.body.ruleCount, '[E1] 保存一条规则').toBe(1);
    expect(r.body.rules, '[E1] 返回一条已保存规则').toHaveLength(1);
    expect(r.body.rules[0].id, '[E1] 后端分配非空 id').toMatch(/\S/);
    return r.body.rules[0].id;
  });
  await test.step('S3：读取保护后的整理建议', async () => {
    const r = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
    expect(r.status, '[E2] 返回 200').toBe(200);
    expect(r.body.summary, '[E2] 汇总变为 2/1/1').toEqual({ archive: 2, merge: 1, keep: 1 });
    const keeps = r.body.suggestions.filter(s => s.action === 'keep');
    expect(keeps, '[E3] 恰好一条 keep').toHaveLength(1);
    expect(keeps[0], '[E3] keep 引用刚保存的规则 id').toMatchObject({ url: DOC, ruleId });
    expect(keeps[0].reason, '[E3] 理由标明保护域名').toContain('被保护域名配置（docs.internal.com）');
    expect(r.body.suggestions.filter(s => s.action === 'archive').map(s => s.url), '[E4] 受保护文档不归档').not.toContain(DOC);
  });
});
