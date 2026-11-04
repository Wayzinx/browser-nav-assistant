// 用例：TC-API-RANK-022；F-RANK-04 AC3；PRD 6.6 boost_domain；公式 D-05
import { test, expect, samplePayload } from '../fixtures/api.mjs';

const RULE = { rawText: 'react.dev 优先显示', type: 'boost_domain', domain: 'react.dev', action: 'boost' };
const USESTATE = 'https://react.dev/reference/react/useState';
const LEARN = 'https://react.dev/learn';
const GOOGLE = 'https://www.google.com/search?q=chrome+extension+manifest+v3';

test('TC-API-RANK-022 boost_domain(react.dev) 提升两个 react 页面', async ({ api }) => {
  const T = Date.now();
  await test.step('S1：POST /api/sync 导入平移后的样例', () => api.seed(samplePayload({ now: T })));

  await test.step('S2：POST /api/rules 保存 boost_domain 规则', async () => {
    const r = await api.post('/api/rules', { rules: [RULE] });
    expect(r.status, '[E1] 保存规则返回 201').toBe(201);
    expect(r.body.ruleCount, '[E1] ruleCount=1').toBe(1);
    expect(r.body.rules[0], '[E1] type=boost_domain、enabled=true').toMatchObject({ type: 'boost_domain', enabled: true });
  });

  await test.step('S3：GET /api/pages/ranked?domain=react.dev&limit=500&now=T', async () => {
    const r = await api.get('/api/pages/ranked', { params: { domain: 'react.dev', limit: 500, now: T } });
    const byUrl = Object.fromEntries(r.body.pages.map((p) => [p.url, p]));
    for (const u of [USESTATE, LEARN]) {
      expect(byUrl[u].scoreDetail, `[E2] ${u} domain=1.00、domainSource=boost`).toMatchObject({ domain: 1, domainSource: 'boost' });
      expect(byUrl[u].reason, `[E3] ${u} 理由包含「命中优先域名规则」`).toContain('命中优先域名规则');
    }
    expect(byUrl[USESTATE].score, '[E2] useState score=0.75').toBe(0.75);
    expect(byUrl[LEARN].score, '[E2] learn score=0.63').toBe(0.63);
  });

  await test.step('S4：GET /api/pages/ranked?limit=500&now=T，取非 react.dev 页面', async () => {
    const r = await api.get('/api/pages/ranked', { params: { limit: 500, now: T } });
    const byUrl = Object.fromEntries(r.body.pages.map((p) => [p.url, p]));
    expect(byUrl['https://github.com/org/repo/issues/123'].score, '[E4] issues/123 仍为 1.00').toBe(1);
    expect(byUrl['https://github.com/org/repo/pull/456'].score, '[E4] pull/456 仍为 0.94').toBe(0.94);
    expect(byUrl['https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API'].score, '[E4] Fetch_API 仍为 0.83').toBe(0.83);
    expect(byUrl[GOOGLE].score, '[E4] Google 搜索页仍为 0.11').toBe(0.11);
    expect(byUrl[GOOGLE].scoreDetail.domainSource, '[E4] Google 项 domainSource=affinity').toBe('affinity');
  });
});
