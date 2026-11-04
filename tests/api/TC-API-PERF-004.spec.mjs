// 用例：TC-API-PERF-004；F-PERF-02 AC2：同步（数据版本 +1）或保存规则（规则版本 +1）使推荐缓存失效
import { test, expect, samplePayload } from '../fixtures/api.mjs';

const RULE = { rawText: 'example.org 优先显示', type: 'boost_domain', domain: 'example.org', action: 'boost' };

test('TC-API-PERF-004 同步或保存规则后推荐缓存失效并重新命中', async ({ api }) => {
  const T = Date.now();
  const payload = samplePayload({ now: T });
  const body = { currentPage: payload.activeTab, openTabs: payload.openTabs, recentHistory: payload.history };
  const rec = () => api.post('/api/recommendations/next', body, { params: { now: T } });

  await test.step('S1：POST /api/sync 导入平移后的样例', () => api.seed(payload));

  const r1 = await test.step('S2：POST /api/recommendations/next?now=T（R1）', () => rec());
  const r2 = await test.step('S3：POST /api/recommendations/next?now=T（R2）', () => rec());
  expect([r1.status, r2.status], '[E2] R1、R2 都返回 200').toEqual([200, 200]);
  expect(r1.body.cached, '[E2] R1 cached=false').toBe(false);
  expect(r2.body.cached, '[E2] R2 cached=true').toBe(true);
  expect(r2.body.recommendations, '[E2] R2 与 R1 推荐深相等').toEqual(r1.body.recommendations);

  await test.step('S4：POST /api/sync 再次导入同一批样例（失效事件①）', async () => {
    const r = await api.post('/api/sync', payload);
    expect(r.status, '[E1] 再次同步返回 200').toBe(200);
    expect(r.body, '[E1] created=0、updated=14').toMatchObject({ created: 0, updated: 14 });
  });

  await test.step('S5：POST /api/recommendations/next?now=T（R3）；紧接再请求一次（R4）', async () => {
    const r3 = await rec();
    const r4 = await rec();
    expect([r3.status, r4.status], '[E3] R3、R4 都返回 200').toEqual([200, 200]);
    expect(r3.body.cached, '[E3] R3 cached=false（数据版本变化）').toBe(false);
    expect(r4.body.cached, '[E3] R4 cached=true').toBe(true);
    expect(r3.body.recommendations, '[E3] R3 与 R1 推荐深相等').toEqual(r1.body.recommendations);
    expect(r4.body.recommendations, '[E3] R4 与 R1 推荐深相等').toEqual(r1.body.recommendations);
  });

  await test.step('S6：POST /api/rules 保存 boost_domain(example.org) 规则（失效事件②）', async () => {
    const r = await api.post('/api/rules', { rules: [RULE] });
    expect(r.status, '[E4] 保存规则返回 201').toBe(201);
    expect(r.body.ruleCount, '[E4] ruleCount=1').toBe(1);
    expect(r.body.rules[0].id, '[E4] 规则 id 为非空字符串').toMatch(/\S/);
  });

  await test.step('S7：POST /api/recommendations/next?now=T（R5）；紧接再请求一次（R6）', async () => {
    const r5 = await rec();
    const r6 = await rec();
    expect([r5.status, r6.status], '[E5] R5、R6 都返回 200').toEqual([200, 200]);
    expect(r5.body.cached, '[E5] R5 cached=false（规则版本变化）').toBe(false);
    expect(r6.body.cached, '[E5] R6 cached=true').toBe(true);
    expect(r5.body.recommendations, '[E5] R5 与 R1 推荐深相等').toEqual(r1.body.recommendations);
    expect(r6.body.recommendations, '[E5] R6 与 R1 推荐深相等').toEqual(r1.body.recommendations);
  });
});
