// 模板：API 用例（一个文件 = 一个 Case ID，文件名 tests/api/<CaseID>.spec.mjs）
// 用例：TC-API-SYNC-001（示例，实际内容以 docs/trace/cases-api.json 为准）
//   features: F-SYNC-01, F-SYNC-03    codePoints: C-BE-SYNC-01
//   S1：导入平移后的 resource.json      E1：POST /api/sync 返回 200，received 为 14、pageCount 为 10
//   S2：GET /api/pages/ranked           E2：返回 10 个页面，URL 互不重复
//                                       E3：issues/123 的 visitCount 为 8，lastVisitedAt 等于平移后的时间
// 写法要点：
//   - 每条 expected 都有断言，断言消息以 [En] 开头（lint L06 检查；失败时可以直接对应到用例 expected）
//   - 被测调用用 api.post / api.get（会留痕，也会参与变异检查）；纯准备数据用 api.seed / api.loadSample
//   - 期望值从样例数据推算（shiftedTime），不要手写时间戳；字段名以 api-contract.json 为准
import { test, expect, samplePayload, shiftedTime } from '../fixtures/api.mjs';

const ISSUE = 'https://github.com/org/repo/issues/123';
// 变异检查中 reverse（数组倒序）不影响本用例的结论，豁免时必须写明理由：
// mutation-ignore: reverse —— 本用例只验证去重和字段取值，排序由 RANK 模块的用例负责

test('TC-API-SYNC-001 同步样例数据后按 URL 去重入库', async ({ api }) => {
  const now = Date.now();
  const payload = samplePayload({ now });

  await test.step('S1：POST /api/sync 提交样例数据', async () => {
    const r = await api.post('/api/sync', payload);
    expect(r.status, '[E1] 同步接口返回 200').toBe(200);
    expect(r.body, '[E1] 返回接收条数和去重后的页面数').toMatchObject({ received: 14, pageCount: 10 });
  });

  await test.step('S2：GET /api/pages/ranked 核对入库结果', async () => {
    const r = await api.get('/api/pages/ranked');
    expect(r.status, '[E2] 排序接口返回 200').toBe(200);
    const urls = r.body.pages.map((p) => p.url);
    expect(urls, '[E2] 去重后共 10 个页面').toHaveLength(10);
    expect(new Set(urls).size, '[E2] URL 互不重复').toBe(10);

    const issue = r.body.pages.find((p) => p.url === ISSUE);
    expect(issue, '[E3] issues/123 已入库').toMatchObject({ url: ISSUE, domain: 'github.com' });
    expect(issue.visitCount, '[E3] visitCount 取浏览器历史中的值 8').toBe(8);
    expect(issue.lastVisitedAt, '[E3] lastVisitedAt 等于平移后的访问时间').toBe(shiftedTime(ISSUE, now));
  });
});
