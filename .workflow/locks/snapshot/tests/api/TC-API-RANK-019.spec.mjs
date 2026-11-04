// 用例：TC-API-RANK-019；D-04 快照语义：本次同步不在打开列表即为 isOpen=false
// E1 已按仲裁修正：第 2 次同步只提交已存在的 10 条 history，按契约 received=10、created=0、updated=10。
import { test, expect, samplePayload } from '../fixtures/api.mjs';

const ISSUE = 'https://github.com/org/repo/issues/123';
const PR = 'https://github.com/org/repo/pull/456';
const WAS_OPEN = [PR, ISSUE, 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API', 'https://docs.internal.com/ai-agent-design'];

test('TC-API-RANK-019 关闭全部标签页后再次同步，isOpen 刷新为 false', async ({ api }) => {
  const T = Date.now();

  await test.step('S1：POST /api/sync 第 1 次导入样例（activeTab + 3 个 openTabs）', () => api.seed(samplePayload({ now: T })));

  const s = await test.step('S2：POST /api/sync 第 2 次导入，activeTab=null、openTabs=[]', () =>
    api.post('/api/sync', samplePayload({ now: T, transform: (p) => ({ ...p, activeTab: null, openTabs: [] }) })));
  expect(s.status, '[E1] 第 2 次同步返回 200').toBe(200);
  expect(s.body, '[E1] received=10、created=0、updated=10').toMatchObject({ received: 10, created: 0, updated: 10 });

  const r = await test.step('S3：GET /api/pages/ranked?limit=500&now=T', () =>
    api.get('/api/pages/ranked', { params: { limit: 500, now: T } }));
  const byUrl = Object.fromEntries(r.body.pages.map((p) => [p.url, p]));

  expect(WAS_OPEN.map((u) => byUrl[u].isOpen), '[E2] 原先打开的 4 个页面 isOpen=false').toEqual([false, false, false, false]);
  expect(byUrl[PR].isActive, '[E2] pull/456 isActive=false').toBe(false);

  expect(byUrl[ISSUE].reason, '[E3] issues/123 理由去掉打开状态句').toBe('最近 3 天内多次访问（8 次），常用域名 github.com');
  expect(byUrl[PR].reason, '[E3] pull/456 理由不再以「正在浏览」开头').not.toMatch(/^正在浏览/);

  expect(r.body.pages, '[E4] 仍为 10 个页面').toHaveLength(10);
  for (const p of r.body.pages) {
    expect(p.reason, `[E4] ${p.url} 理由不包含「当前仍处于打开状态」`).not.toContain('当前仍处于打开状态');
    expect(p.reason.split('，').length, `[E4] ${p.url} 理由不超过 3 句`).toBeLessThanOrEqual(3);
  }
});
