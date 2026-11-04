// 用例：TC-API-RANK-024；规则域名匹配口径：等于规则域名或以「.规则域名」结尾
import { test, expect, HOUR } from '../fixtures/api.mjs';

const RULE = { rawText: 'react.dev 优先显示', type: 'boost_domain', domain: 'react.dev', action: 'boost' };
const SMALL = ['https://react.dev/a', 'https://sub.react.dev/b', 'https://notreact.dev/c'];
const EXAMPLE = ['https://example.com/p1', 'https://example.com/p2', 'https://example.com/p3'];

test('TC-API-RANK-024 规则域名匹配子域但不匹配后缀相同的域名', async ({ api }) => {
  const T = Date.now();
  const ranked = async () => {
    const r = await api.get('/api/pages/ranked', { params: { limit: 500, now: T } });
    return Object.fromEntries(r.body.pages.map((p) => [p.url, p]));
  };

  const s = await test.step('S1：POST /api/sync 导入 6 条 history', () =>
    api.post('/api/sync', { activeTab: null, openTabs: [], history: [...SMALL, ...EXAMPLE].map((url) => ({ url, title: url, lastVisitTime: T - HOUR, visitCount: 1 })) }));
  expect(s.status, '[E1] 同步返回 200').toBe(200);
  expect(s.body.created, '[E1] created=6').toBe(6);

  await test.step('S2：GET /api/pages/ranked?limit=500&now=T，记录规则前域名分', async () => {
    const byUrl = await ranked();
    for (const u of SMALL) expect(byUrl[u].scoreDetail, `[E2] ${u} domain=0.33、affinity`).toMatchObject({ domain: 0.33, domainSource: 'affinity' });
    for (const u of EXAMPLE) expect(byUrl[u].scoreDetail.domain, `[E2] ${u} domain=1.00`).toBe(1);
  });

  await test.step('S3：POST /api/rules 保存 boost_domain(react.dev) 规则', () => api.post('/api/rules', { rules: [RULE] }));

  await test.step('S4：GET /api/pages/ranked?limit=500&now=T', async () => {
    const byUrl = await ranked();
    for (const u of ['https://react.dev/a', 'https://sub.react.dev/b']) {
      expect(byUrl[u].scoreDetail, `[E3] ${u} domain=1.00、boost`).toMatchObject({ domain: 1, domainSource: 'boost' });
      expect(byUrl[u].reason, `[E3] ${u} 理由包含「命中优先域名规则」`).toContain('命中优先域名规则');
    }
    const c = byUrl['https://notreact.dev/c'];
    expect(c.scoreDetail, '[E4] notreact.dev/c 仍为 0.33、affinity').toMatchObject({ domain: 0.33, domainSource: 'affinity' });
    expect(c.reason, '[E4] notreact.dev/c 理由不包含「命中优先域名规则」').not.toContain('命中优先域名规则');
    expect(EXAMPLE.map((u) => byUrl[u].scoreDetail.domainSource), '[E4] example.com 三项仍为 affinity').toEqual(['affinity', 'affinity', 'affinity']);
  });
});
