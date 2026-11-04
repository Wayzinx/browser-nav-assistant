import { test, expect, samplePayload, DAY, SAMPLE_LAG_MS } from '../fixtures/api.mjs';

const ISSUE = 'https://github.com/org/repo/issues/87';
const RULE = { rawText: '把 7 天没访问过的 GitHub issue 建议归档', type: 'archive_candidate', domain: 'github.com', urlPattern: '/issues/', inactiveDays: 7, action: 'suggest_archive' };

test('TC-API-CLEAN-016 保存和删除规则改变 10 天 issue 的归档状态', async ({ api }) => {
  const now = Date.now();
  // samplePayload 的 transform 收到的时间已经平移，追加项直接使用 T − 5 分钟 − 10 天。
  const payload = samplePayload({ now, transform: p => ({ ...p, history: [...p.history, {
    url: ISSUE, title: 'Issue 87', lastVisitTime: now - SAMPLE_LAG_MS - 10 * DAY, visitCount: 1,
  }] }) });
  await test.step('S1：同步追加了 issues/87 的完整样例', async () => {
    const r = await api.post('/api/sync', payload);
    expect(r.status, '[E1] 返回 200').toBe(200);
    expect(r.body, '[E1] 共新建 11 个页面').toMatchObject({ created: 11, pageCount: 11 });
  });
  await test.step('S2：读取无规则时的整理建议', async () => {
    const r = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
    expect(r.status, '[E2] 返回 200').toBe(200);
    expect(r.body.suggestions.filter(s => s.action === 'archive').map(s => s.url), '[E2] 10 天未超过默认阈值').not.toContain(ISSUE);
  });
  const ruleId = await test.step('S3：保存 7 天规则并取得 id', async () => {
    const r = await api.post('/api/rules', { rules: [RULE] });
    expect(r.status, '[E3] 规则保存成功').toBe(201);
    expect(r.body.rules[0].id, '[E3] 规则 id 非空').toMatch(/\S/);
    return r.body.rules[0].id;
  });
  await test.step('S4：读取规则生效后的整理建议', async () => {
    const r = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
    expect(r.status, '[E3] 返回 200').toBe(200);
    const item = r.body.suggestions.find(s => s.action === 'archive' && s.url === ISSUE);
    expect(item, '[E3] 10 天 issue 命中刚保存的规则').toMatchObject({ ageDays: 10, ruleId });
    expect(item.reason, '[E3] 理由以 7 天阈值及 10 天年龄开头').toMatch(/^超过 7 天未访问（已 10 天）/);
    expect(r.body.summary.archive, '[E4] 归档建议增加到三条').toBe(3);
  });
  await test.step('S5：使用保存响应中的 id 删除规则', async () => {
    const r = await api.del(`/api/rules/${ruleId}`);
    expect(r.status, '[E5] 删除规则返回 200').toBe(200);
  });
  await test.step('S6：读取删除规则后的整理建议', async () => {
    const r = await api.get('/api/pages/cleanup-suggestions', { params: { now } });
    expect(r.status, '[E5] 返回 200').toBe(200);
    expect(r.body.suggestions.filter(s => s.action === 'archive').map(s => s.url), '[E5] issues/87 再次退出归档建议').not.toContain(ISSUE);
    expect(r.body.summary.archive, '[E5] 归档建议恢复为两条').toBe(2);
  });
});
